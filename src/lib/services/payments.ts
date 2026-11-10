import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sha256Hex } from "@/lib/hash";
import { formatMoney, minorToValue, sameAmount } from "@/lib/money";
import { paypalSetup, env } from "@/lib/env";
import { appendEvent } from "@/lib/services/events";
import { loadDealForUser, requireRole } from "@/lib/services/access";
import { parseContent, versionState } from "@/lib/services/briefs";
import {
  FixturePayPalGateway,
  PayPalApiError,
  SandboxPayPalGateway,
  type OrderIntent,
  type PayPalAuthorization,
  type PayPalCapture,
  type PayPalGateway,
  type PayPalOrder,
} from "@/lib/paypal/gateway";

const g = globalThis as unknown as { __ptFixtureGateway?: FixturePayPalGateway; __ptSandboxGateway?: SandboxPayPalGateway };

/** Gateway for the current configuration, or a SETUP_REQUIRED error. */
export function getGateway(): PayPalGateway {
  const s = paypalSetup();
  if (s.state === "fixture") return (g.__ptFixtureGateway ??= new FixturePayPalGateway());
  if (s.state === "missing_credentials") {
    throw new AppError("SETUP_REQUIRED", `PayPal sandbox is not configured: set ${s.missing.join(" and ")} in .env.`);
  }
  const e = env();
  return (g.__ptSandboxGateway ??= new SandboxPayPalGateway(e.PAYPAL_CLIENT_ID!, e.PAYPAL_CLIENT_SECRET!));
}

/** Statuses that mean money is confirmed received right now. */
export const PAID_STATUSES = new Set(["COMPLETED"]);
/** A held payment: PayPal authorized the buyer's funds; nothing is captured yet. */
export const HELD_STATUSES = new Set(["AUTHORIZED"]);
/** Statuses reached only after a capture was attempted. A late authorization event must not overwrite them. */
const AFTER_CAPTURE = new Set(["CAPTURE_PENDING", "COMPLETED", "DECLINED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"]);

type PaymentRow = NonNullable<Awaited<ReturnType<Db["payment"]["findUnique"]>>>;

async function assertCheckoutAllowed(tx: Tx, dealId: string) {
  const st = await versionState(tx, dealId);
  const v = st.working;
  if (!st.deal.buyerId) throw new AppError("NOT_APPROVED", "The buyer has not joined this agreement yet.");
  if (!v || v.kind !== "ORIGINAL") throw new AppError("NOT_APPROVED", "There is no unpaid brief to pay for.");
  if (v.lockedAt) throw new AppError("ALREADY_PAID", "This agreement is already paid.");
  if (!st.workingApproved) throw new AppError("NOT_APPROVED", `Both participants must approve version ${v.number} before checkout.`);
  const content = parseContent(v);
  if (content.price.amountMinor === null || !content.price.currency) throw new AppError("INVALID", "The approved brief has no price.");
  return { st, version: v, amountMinor: content.price.amountMinor, currency: content.price.currency, title: content.title };
}

/**
 * Buyer starts PayPal checkout. Price, currency, merchant and version all come
 * from the database; nothing from the browser is trusted. A repeated click
 * returns the same PayPal order (same row, same PayPal-Request-Id).
 */
export async function createCheckout(db: Db, gateway: PayPalGateway, dealId: string, userId: string, opts: { intent?: OrderIntent } = {}) {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "BUYER", "pay for this agreement");
  const intent: OrderIntent = opts.intent ?? env().CHECKOUT_INTENT;

  const payment = await db.$transaction(async (tx) => {
    const { version, amountMinor, currency } = await assertCheckoutAllowed(tx, dealId);
    const blocking = await tx.payment.findFirst({ where: { dealId, status: { in: ["COMPLETED", "CAPTURE_PENDING", "AUTHORIZED", "AUTHORIZATION_PENDING"] } } });
    if (blocking?.status === "COMPLETED" || blocking?.status === "AUTHORIZED") throw new AppError("ALREADY_PAID", blocking.status === "AUTHORIZED" ? "PayPal already holds the payment for this agreement." : "This agreement is already paid.");
    if (blocking) throw new AppError("PAYMENT_PENDING", "A payment is pending at PayPal. Wait for PayPal to complete or deny it.");
    await tx.payment.updateMany({ where: { dealId, versionId: { not: version.id }, status: { in: ["INITIATED", "ORDER_CREATED"] } }, data: { status: "ABANDONED", statusReason: "Superseded by a newer brief version" } });
    await tx.payment.updateMany({ where: { dealId, intent: { not: intent }, status: { in: ["INITIATED", "ORDER_CREATED"] } }, data: { status: "ABANDONED", statusReason: "Superseded by a checkout with a different payment flow" } });
    const reusable = await tx.payment.findFirst({ where: { dealId, versionId: version.id, versionHash: version.contentHash, intent, status: { in: ["INITIATED", "ORDER_CREATED"] } }, orderBy: { createdAt: "desc" } });
    if (reusable) return reusable;
    const id = randomUUID();
    return tx.payment.create({
      data: {
        dealId, versionId: version.id, versionHash: version.contentHash, mode: gateway.mode, intent, amountMinor, currency,
        invoiceId: `PT-${id.slice(0, 8)}-${Date.now().toString(36)}`, customId: `pt:${dealId}:v${version.number}`,
        createRequestId: randomUUID(), captureRequestId: randomUUID(),
        authorizeRequestId: intent === "AUTHORIZE" ? randomUUID() : null, voidRequestId: intent === "AUTHORIZE" ? randomUUID() : null,
        status: "INITIATED",
      },
    });
  });

  if (payment.paypalOrderId && payment.status === "ORDER_CREATED") return { orderId: payment.paypalOrderId, paymentId: payment.id, mode: payment.mode, intent };

  const version = await db.briefVersion.findUniqueOrThrow({ where: { id: payment.versionId } });
  let order: PayPalOrder;
  try {
    order = await gateway.createOrder({
      requestId: payment.createRequestId,
      intent,
      amountValue: minorToValue(payment.amountMinor, payment.currency),
      currency: payment.currency,
      invoiceId: payment.invoiceId,
      customId: payment.customId,
      referenceId: version.id,
      description: `PromiseTrace v${version.number}: ${parseContent(version).title}`,
    });
  } catch (e) {
    if (e instanceof PayPalApiError) {
      await db.payment.update({ where: { id: payment.id }, data: { lastPaypalDebugId: e.debugId ?? null, statusReason: e.message.slice(0, 300) } });
      throw new AppError("PAYPAL_ERROR", `PayPal could not create the order. ${e.issues.join(", ")}`.trim());
    }
    throw e;
  }
  const pu = order.purchase_units?.[0];
  if (pu?.amount && !sameAmount(payment.amountMinor, payment.currency, pu.amount)) {
    await db.payment.update({ where: { id: payment.id }, data: { status: "MISMATCH", statusReason: "PayPal order amount differs from the approved brief" } });
    throw new AppError("AMOUNT_MISMATCH", "PayPal returned a different amount than the approved brief. Checkout stopped.");
  }
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { paypalOrderId: order.id, orderStatus: order.status, status: "ORDER_CREATED" } });
    await appendEvent(tx, { dealId, type: "PAYPAL_ORDER_CREATED", kind: payment.mode === "FIXTURE" ? "SYSTEM_CONFIRMED" : "PAYPAL_CONFIRMED", actorId: userId, actorRole: "BUYER",
      summary: `${payment.mode === "FIXTURE" ? "FIXTURE (no PayPal call): " : ""}PayPal order ${order.id} created for ${formatMoney(payment.amountMinor, payment.currency)} against version ${version.number}${intent === "AUTHORIZE" ? " (intent AUTHORIZE: hold now, capture when the buyer accepts)" : ""}.`,
      data: { orderId: order.id, intent, invoiceId: payment.invoiceId, customId: payment.customId, versionHash: payment.versionHash, mode: payment.mode } });
  });
  return { orderId: order.id, paymentId: payment.id, mode: payment.mode, intent };
}

export type CaptureOutcome =
  | { kind: "COMPLETED"; paymentId: string }
  | { kind: "PENDING"; reason: string | null }
  | { kind: "DECLINED"; reason: string | null }
  | { kind: "INSTRUMENT_DECLINED" }
  | { kind: "NOT_APPROVED" };

/**
 * Buyer approval in the PayPal popup is NOT payment. Only a capture whose
 * status is COMPLETED, with the exact expected amount, currency, custom_id
 * and invoice_id, marks the agreement paid.
 */
export async function capturePayment(db: Db, gateway: PayPalGateway, dealId: string, userId: string, orderId: string): Promise<CaptureOutcome> {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "BUYER", "confirm this payment");
  const payment = await db.payment.findUnique({ where: { paypalOrderId: orderId } });
  if (!payment || payment.dealId !== dealId) throw new AppError("NOT_FOUND", "No checkout with that order exists for this agreement.");
  if (payment.intent === "AUTHORIZE") throw new AppError("INVALID", "This checkout holds the payment. It is captured when the buyer accepts the delivery, not at checkout.");
  if (payment.status === "COMPLETED") return { kind: "COMPLETED", paymentId: payment.id };
  if (payment.status === "CAPTURE_PENDING") return { kind: "PENDING", reason: payment.statusReason };
  if (payment.status === "ABANDONED" || payment.status === "MISMATCH") throw new AppError("STALE_VERSION", `This checkout can no longer be completed (${payment.statusReason ?? payment.status}). Start checkout again.`);

  // The brief must still be exactly what both sides approved.
  const st = await versionState(db, dealId);
  if (!st.working || st.working.id !== payment.versionId || st.working.contentHash !== payment.versionHash || !st.workingApproved) {
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "ABANDONED", statusReason: "Brief changed after checkout started" } });
      await appendEvent(tx, { dealId, type: "CHECKOUT_REJECTED_STALE", kind: "SYSTEM_CONFIRMED", actorRole: "SYSTEM",
        summary: `Capture of order ${orderId} refused: the brief changed after checkout started. No capture was attempted.`, data: { orderId } });
    });
    throw new AppError("STALE_VERSION", "The brief changed after checkout started. Review and approve the current version, then pay again.");
  }

  // Re-read the order from PayPal and confirm it is the one we created.
  let order = await gateway.getOrder(orderId);
  const problem = orderMismatch(payment, order);
  if (problem) return markMismatch(db, payment, problem);
  if (order.status === "COMPLETED") return applyCapturedOrder(db, payment, order, userId);
  if (order.status !== "APPROVED") return { kind: "NOT_APPROVED" };

  try {
    order = await gateway.captureOrder(orderId, payment.captureRequestId);
  } catch (e) {
    if (e instanceof PayPalApiError) {
      if (e.hasIssue("ORDER_ALREADY_CAPTURED")) {
        order = await gateway.getOrder(orderId);
      } else if (e.hasIssue("INSTRUMENT_DECLINED")) {
        await recordCaptureEvent(db, dealId, "PAYMENT_INSTRUMENT_DECLINED", `PayPal declined the buyer's funding source for order ${orderId}; the buyer can choose another.`, { orderId, debugId: e.debugId });
        return { kind: "INSTRUMENT_DECLINED" };
      } else {
        await db.payment.update({ where: { id: payment.id }, data: { lastPaypalDebugId: e.debugId ?? null, statusReason: e.message.slice(0, 300) } });
        throw new AppError("PAYPAL_ERROR", "PayPal did not capture the payment. Nothing was marked paid; you can retry safely.");
      }
    } else throw e;
  }
  return applyCapturedOrder(db, payment, order, userId);
}

function orderMismatch(payment: PaymentRow, order: PayPalOrder): string | null {
  const pu = order.purchase_units?.[0];
  if (!pu) return "Order has no purchase unit";
  if (!sameAmount(payment.amountMinor, payment.currency, pu.amount)) return `Order amount ${pu.amount?.value ?? "?"} ${pu.amount?.currency_code ?? "?"} differs from approved ${formatMoney(payment.amountMinor, payment.currency)}`;
  if (pu.custom_id !== undefined && pu.custom_id !== payment.customId) return "Order custom_id does not belong to this agreement";
  if (pu.invoice_id !== undefined && pu.invoice_id !== payment.invoiceId) return "Order invoice_id does not match";
  return null;
}

async function markMismatch(db: Db, payment: PaymentRow, problem: string): Promise<never> {
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "MISMATCH", statusReason: problem } });
    await appendEvent(tx, { dealId: payment.dealId, type: "PAYMENT_MISMATCH", kind: "SYSTEM_CONFIRMED", actorRole: "SYSTEM",
      summary: `Payment not accepted: ${problem}.`, data: { orderId: payment.paypalOrderId } });
  });
  throw new AppError("AMOUNT_MISMATCH", `Payment not accepted: ${problem}.`);
}

async function recordCaptureEvent(db: Db, dealId: string, type: string, summary: string, data: Record<string, unknown>) {
  await db.$transaction((tx) => appendEvent(tx, { dealId, type, kind: "PAYPAL_CONFIRMED", actorRole: "PAYPAL", summary, data }));
}

const CAPTURE_TO_PAYMENT: Record<string, string> = {
  COMPLETED: "COMPLETED", PENDING: "CAPTURE_PENDING", DECLINED: "DECLINED", FAILED: "FAILED",
  REFUNDED: "REFUNDED", PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
};

async function applyCapturedOrder(db: Db, payment: PaymentRow, order: PayPalOrder, actorId: string | null): Promise<CaptureOutcome> {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) {
    await db.payment.update({ where: { id: payment.id }, data: { orderStatus: order.status, statusReason: "Order has no capture yet" } });
    return { kind: "NOT_APPROVED" };
  }
  const res = await applyCaptureState(db, payment, capture, { orderStatus: order.status, payerId: order.payer?.payer_id, actorId, source: "capture API response" });
  return res;
}

/** Shared by the capture call and by verified webhooks. Idempotent. */
export async function applyCaptureState(
  db: Db,
  payment: PaymentRow,
  capture: PayPalCapture,
  ctx: { orderStatus?: string; payerId?: string; actorId: string | null; source: string; forcedStatus?: string; trigger?: string },
): Promise<CaptureOutcome> {
  const amountOk = capture.amount ? sameAmount(payment.amountMinor, payment.currency, capture.amount) : true;
  const idsOk = (capture.custom_id === undefined || capture.custom_id === payment.customId) && (capture.invoice_id === undefined || capture.invoice_id === payment.invoiceId);
  if (!amountOk || !idsOk) {
    return markMismatch(db, payment, !amountOk ? `Captured amount ${capture.amount?.value} ${capture.amount?.currency_code} differs from approved ${formatMoney(payment.amountMinor, payment.currency)}` : "Capture reconciliation fields do not match this agreement");
  }
  const newStatus = ctx.forcedStatus ?? CAPTURE_TO_PAYMENT[capture.status] ?? "FAILED";
  const reason = capture.status_details?.reason ?? null;
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  const unchanged = fresh.status === newStatus && fresh.captureId === capture.id;

  if (!unchanged) {
    await db.$transaction(async (tx) => {
      const b = capture.seller_receivable_breakdown;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus, statusReason: reason, captureId: capture.id, captureStatus: capture.status,
          orderStatus: ctx.orderStatus ?? fresh.orderStatus,
          grossValue: b?.gross_amount?.value ?? capture.amount?.value ?? null,
          feeValue: b?.paypal_fee?.value ?? null, netValue: b?.net_amount?.value ?? null,
          payerIdHash: ctx.payerId ? sha256Hex(`payer:${ctx.payerId}`).slice(0, 16) : fresh.payerIdHash,
          completedAt: newStatus === "COMPLETED" ? fresh.completedAt ?? new Date() : fresh.completedAt,
          captureTrigger: ctx.trigger ?? fresh.captureTrigger,
        },
      });
      if (newStatus === "COMPLETED") {
        await tx.briefVersion.updateMany({ where: { id: payment.versionId, lockedAt: null }, data: { lockedAt: new Date() } });
      }
      const fixture = payment.mode === "FIXTURE";
      const label = fixture ? "FIXTURE (not a PayPal transaction): " : "";
      const money = formatMoney(payment.amountMinor, payment.currency);
      const trig = ctx.trigger ?? fresh.captureTrigger;
      const why = trig === "SELLER_AFTER_REVIEW_WINDOW" ? "after the review window passed with all checks met and no open objections"
        : trig === "BUYER_ACCEPTED" ? "after the buyer accepted the delivery"
        : "(PromiseTrace did not request this capture; it was made outside the app)";
      const summaries: Record<string, string> = {
        COMPLETED: payment.intent === "AUTHORIZE"
          ? `${label}PayPal capture ${capture.id} COMPLETED for ${money}: the held payment was captured ${why}. The seller is now paid.`
          : `${label}PayPal capture ${capture.id} COMPLETED for ${money}. Version locked as the paid agreement.`,
        CAPTURE_PENDING: `${label}PayPal capture ${capture.id} is PENDING${reason ? ` (${reason})` : ""}. Not treated as paid.`,
        DECLINED: `${label}PayPal capture ${capture.id} was DECLINED${reason ? ` (${reason})` : ""}. Not paid.`,
        FAILED: `${label}PayPal capture ${capture.id} FAILED. Not paid.`,
        REFUNDED: `${label}PayPal reports capture ${capture.id} REFUNDED. The agreement is no longer shown as paid.`,
        PARTIALLY_REFUNDED: `${label}PayPal reports capture ${capture.id} PARTIALLY REFUNDED.`,
        REVERSED: `${label}PayPal reports capture ${capture.id} REVERSED. The agreement is no longer shown as paid.`,
      };
      await appendEvent(tx, {
        dealId: payment.dealId, type: `PAYMENT_${newStatus}`, kind: fixture ? "SYSTEM_CONFIRMED" : "PAYPAL_CONFIRMED", actorId: ctx.actorId, actorRole: "PAYPAL",
        summary: summaries[newStatus] ?? `${label}PayPal capture ${capture.id} status ${capture.status}.`,
        data: { captureId: capture.id, captureStatus: capture.status, reason, orderId: payment.paypalOrderId, gross: capture.amount, source: ctx.source, mode: payment.mode },
      });
    });
  }
  if (newStatus === "COMPLETED") return { kind: "COMPLETED", paymentId: payment.id };
  if (newStatus === "CAPTURE_PENDING") return { kind: "PENDING", reason };
  return { kind: "DECLINED", reason: reason ?? newStatus };
}

// ---------- Hold at checkout, capture on acceptance (intent AUTHORIZE) ----------

export type AuthorizeOutcome =
  | { kind: "AUTHORIZED"; paymentId: string }
  | { kind: "PENDING"; reason: string | null }
  | { kind: "DECLINED"; reason: string | null }
  | { kind: "INSTRUMENT_DECLINED" }
  | { kind: "NOT_APPROVED" };

/**
 * After the buyer approves in the PayPal window, ask PayPal to authorize the
 * order: the buyer's funds are held, nothing is captured. Only an
 * authorization PayPal returns as CREATED, with the exact amount, marks the
 * agreement funded (and locks the version).
 */
export async function authorizePayment(db: Db, gateway: PayPalGateway, dealId: string, userId: string, orderId: string): Promise<AuthorizeOutcome> {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "BUYER", "confirm this payment");
  const payment = await db.payment.findUnique({ where: { paypalOrderId: orderId } });
  if (!payment || payment.dealId !== dealId) throw new AppError("NOT_FOUND", "No checkout with that order exists for this agreement.");
  if (payment.intent !== "AUTHORIZE") throw new AppError("INVALID", "This checkout is captured at checkout, not held.");
  if (payment.status === "AUTHORIZED" || AFTER_CAPTURE.has(payment.status)) return { kind: "AUTHORIZED", paymentId: payment.id };
  if (payment.status === "AUTHORIZATION_PENDING") return { kind: "PENDING", reason: payment.statusReason };
  if (payment.status === "ABANDONED" || payment.status === "MISMATCH") throw new AppError("STALE_VERSION", `This checkout can no longer be completed (${payment.statusReason ?? payment.status}). Start checkout again.`);
  if (payment.status === "VOIDED" || payment.status === "EXPIRED" || payment.status === "AUTHORIZATION_DENIED") throw new AppError("HOLD_ENDED", `This hold has ended (${payment.status}).`);

  const st = await versionState(db, dealId);
  if (!st.working || st.working.id !== payment.versionId || st.working.contentHash !== payment.versionHash || !st.workingApproved) {
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "ABANDONED", statusReason: "Brief changed after checkout started" } });
      await appendEvent(tx, { dealId, type: "CHECKOUT_REJECTED_STALE", kind: "SYSTEM_CONFIRMED", actorRole: "SYSTEM",
        summary: `Authorization of order ${orderId} refused: the brief changed after checkout started. No hold was placed.`, data: { orderId } });
    });
    throw new AppError("STALE_VERSION", "The brief changed after checkout started. Review and approve the current version, then pay again.");
  }

  let order = await gateway.getOrder(orderId);
  const problem = orderMismatch(payment, order);
  if (problem) return markMismatch(db, payment, problem);
  if (order.status === "COMPLETED") return applyAuthorizedOrder(db, payment, order, userId);
  if (order.status !== "APPROVED") return { kind: "NOT_APPROVED" };

  try {
    order = await gateway.authorizeOrder(orderId, payment.authorizeRequestId ?? payment.captureRequestId);
  } catch (e) {
    if (!(e instanceof PayPalApiError)) throw e;
    if (e.hasIssue("ORDER_ALREADY_AUTHORIZED")) {
      order = await gateway.getOrder(orderId);
    } else if (e.hasIssue("INSTRUMENT_DECLINED")) {
      await recordCaptureEvent(db, dealId, "PAYMENT_INSTRUMENT_DECLINED", `PayPal declined the buyer's funding source for order ${orderId}; the buyer can choose another.`, { orderId, debugId: e.debugId });
      return { kind: "INSTRUMENT_DECLINED" };
    } else {
      await db.payment.update({ where: { id: payment.id }, data: { lastPaypalDebugId: e.debugId ?? null, statusReason: e.message.slice(0, 300) } });
      throw new AppError("PAYPAL_ERROR", "PayPal did not place the hold. Nothing was marked funded; you can retry safely.");
    }
  }
  return applyAuthorizedOrder(db, payment, order, userId);
}

async function applyAuthorizedOrder(db: Db, payment: PaymentRow, order: PayPalOrder, actorId: string | null): Promise<AuthorizeOutcome> {
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) {
    await db.payment.update({ where: { id: payment.id }, data: { orderStatus: order.status, statusReason: "Order has no authorization yet" } });
    return { kind: "NOT_APPROVED" };
  }
  return applyAuthorizationState(db, payment, auth, { orderStatus: order.status, payerId: order.payer?.payer_id, actorId, source: "authorize API response" });
}

const AUTH_TO_PAYMENT: Record<string, string> = {
  CREATED: "AUTHORIZED", PENDING: "AUTHORIZATION_PENDING", DENIED: "AUTHORIZATION_DENIED", VOIDED: "VOIDED", EXPIRED: "EXPIRED",
};

/** Shared by the authorize call, the void call and verified webhooks. Idempotent; never overwrites a captured state. */
export async function applyAuthorizationState(
  db: Db,
  payment: PaymentRow,
  auth: PayPalAuthorization,
  ctx: { orderStatus?: string; payerId?: string; actorId: string | null; source: string },
): Promise<AuthorizeOutcome> {
  const amountOk = auth.amount ? sameAmount(payment.amountMinor, payment.currency, auth.amount) : true;
  const idsOk = (auth.custom_id === undefined || auth.custom_id === payment.customId) && (auth.invoice_id === undefined || auth.invoice_id === payment.invoiceId);
  if (!amountOk || !idsOk) {
    return markMismatch(db, payment, !amountOk ? `Authorized amount ${auth.amount?.value} ${auth.amount?.currency_code} differs from approved ${formatMoney(payment.amountMinor, payment.currency)}` : "Authorization reconciliation fields do not match this agreement");
  }
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  const mapped = AUTH_TO_PAYMENT[auth.status];
  const reason = auth.status_details?.reason ?? null;
  const expiresAt = auth.expiration_time ? new Date(auth.expiration_time) : fresh.authorizationExpiresAt;
  // CAPTURED / PARTIALLY_CAPTURED, or a late event after capture or void: record what PayPal says, change nothing else.
  const terminal = AFTER_CAPTURE.has(fresh.status) || (fresh.status === "VOIDED" && mapped !== "VOIDED") || (fresh.status === "EXPIRED" && mapped !== "EXPIRED");
  if (!mapped || terminal) {
    // Only record a status that moves forward (CAPTURED / PARTIALLY_CAPTURED); ignore a stale snapshot.
    if (!mapped && (fresh.authorizationStatus !== auth.status || fresh.authorizationId !== auth.id)) {
      await db.payment.update({ where: { id: payment.id }, data: { authorizationId: fresh.authorizationId ?? auth.id, authorizationStatus: auth.status } });
    }
    return outcomeFor(fresh.status, fresh.id, fresh.statusReason);
  }
  if (fresh.status === mapped && fresh.authorizationId === auth.id) return outcomeFor(mapped, fresh.id, reason);

  const fixture = payment.mode === "FIXTURE";
  const label = fixture ? "FIXTURE (not a PayPal transaction): " : "";
  const money = formatMoney(payment.amountMinor, payment.currency);
  const version = await db.briefVersion.findUniqueOrThrow({ where: { id: payment.versionId } });
  const until = expiresAt ? expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z") : "PayPal's expiry time";
  const summaries: Record<string, string> = {
    AUTHORIZED: `${label}PayPal authorization ${auth.id} CREATED: ${money} is held on the buyer's payment method until ${until}. Nothing is captured yet; the seller is paid when the buyer accepts the delivery. Version ${version.number} locked as the funded agreement.`,
    AUTHORIZATION_PENDING: `${label}PayPal authorization ${auth.id} is PENDING${reason ? ` (${reason})` : ""}. Not treated as funded.`,
    AUTHORIZATION_DENIED: `${label}PayPal DENIED authorization ${auth.id}${reason ? ` (${reason})` : ""}. Not funded.`,
    VOIDED: `${label}PayPal authorization ${auth.id} VOIDED: the hold on ${money} is released to the buyer. Nothing was captured.`,
    EXPIRED: `${label}PayPal reports authorization ${auth.id} EXPIRED: the hold lapsed and nothing was captured.`,
  };
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: mapped, statusReason: reason, authorizationId: auth.id, authorizationStatus: auth.status,
        authorizationExpiresAt: expiresAt, orderStatus: ctx.orderStatus ?? fresh.orderStatus,
        authorizedAt: mapped === "AUTHORIZED" ? fresh.authorizedAt ?? new Date() : fresh.authorizedAt,
        voidedAt: mapped === "VOIDED" ? fresh.voidedAt ?? new Date() : fresh.voidedAt,
        payerIdHash: ctx.payerId ? sha256Hex(`payer:${ctx.payerId}`).slice(0, 16) : fresh.payerIdHash,
      },
    });
    if (mapped === "AUTHORIZED") await tx.briefVersion.updateMany({ where: { id: payment.versionId, lockedAt: null }, data: { lockedAt: new Date() } });
    await appendEvent(tx, {
      dealId: payment.dealId, type: `PAYMENT_${mapped}`, kind: fixture ? "SYSTEM_CONFIRMED" : "PAYPAL_CONFIRMED", actorId: ctx.actorId, actorRole: "PAYPAL",
      summary: summaries[mapped]!,
      data: { authorizationId: auth.id, authorizationStatus: auth.status, reason, expiresAt: expiresAt?.toISOString() ?? null, orderId: payment.paypalOrderId, amount: auth.amount, source: ctx.source, mode: payment.mode },
    });
  });
  return outcomeFor(mapped, payment.id, reason);
}

function outcomeFor(status: string, paymentId: string, reason: string | null): AuthorizeOutcome {
  if (status === "AUTHORIZED" || AFTER_CAPTURE.has(status)) return { kind: "AUTHORIZED", paymentId };
  if (status === "AUTHORIZATION_PENDING") return { kind: "PENDING", reason };
  return { kind: "DECLINED", reason: reason ?? status };
}

/**
 * Capture a held payment (full amount, final capture). Callers decide whether
 * it is allowed (see services/hold.ts). The same PayPal-Request-Id is used on
 * every attempt, so a buyer acceptance and a seller release racing each
 * other produce one capture.
 */
export async function captureHold(db: Db, gateway: PayPalGateway, paymentId: string, ctx: { trigger: "BUYER_ACCEPTED" | "SELLER_AFTER_REVIEW_WINDOW"; actorId: string }): Promise<CaptureOutcome> {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status === "COMPLETED") return { kind: "COMPLETED", paymentId: payment.id };
  if (payment.intent !== "AUTHORIZE" || payment.status !== "AUTHORIZED" || !payment.authorizationId) {
    throw new AppError("INVALID", `There is no held payment to capture (payment status ${payment.status}).`);
  }
  // Record why before calling PayPal, so a capture webhook that wins the race is described correctly.
  await db.payment.update({ where: { id: payment.id }, data: { captureTrigger: ctx.trigger } });
  let capture: PayPalCapture;
  try {
    capture = await gateway.captureAuthorization(payment.authorizationId, {
      requestId: payment.captureRequestId, amountValue: minorToValue(payment.amountMinor, payment.currency), currency: payment.currency, finalCapture: true,
    });
  } catch (e) {
    if (!(e instanceof PayPalApiError)) throw e;
    await db.payment.update({ where: { id: payment.id }, data: { lastPaypalDebugId: e.debugId ?? null } });
    if (e.hasIssue("AUTHORIZATION_EXPIRED") || e.hasIssue("AUTHORIZATION_VOIDED")) {
      const status = e.hasIssue("AUTHORIZATION_EXPIRED") ? "EXPIRED" : "VOIDED";
      await applyAuthorizationState(db, payment, { id: payment.authorizationId, status }, { actorId: null, source: `capture refused by PayPal (${e.issues.join(", ")})` });
      throw new AppError("HOLD_ENDED", `PayPal refused the capture: the hold is ${status.toLowerCase()}. Nothing was captured.`);
    }
    if (e.hasIssue("AUTHORIZATION_ALREADY_CAPTURED")) {
      await db.payment.update({ where: { id: payment.id }, data: { authorizationStatus: "CAPTURED", statusReason: "PayPal reports the hold was already captured; waiting for the capture record" } });
      throw new AppError("PAYPAL_ERROR", "PayPal says this hold was already captured. PromiseTrace records the capture when PayPal's signed webhook arrives.");
    }
    await db.payment.update({ where: { id: payment.id }, data: { statusReason: e.message.slice(0, 300) } });
    throw new AppError("PAYPAL_ERROR", "PayPal did not capture the held payment. It is still held; you can retry safely.");
  }
  const outcome = await applyCaptureState(db, payment, capture, { actorId: ctx.actorId, source: `capture of authorization ${payment.authorizationId}`, trigger: ctx.trigger });
  // Record the hold's status as PayPal now reports it (CAPTURED after a final capture). Best effort only.
  try {
    const auth = await gateway.getAuthorization(payment.authorizationId);
    await db.payment.update({ where: { id: payment.id }, data: { authorizationStatus: auth.status } });
  } catch {
    /* the capture itself is already recorded */
  }
  return outcome;
}

/** Release a hold back to the buyer (PayPal void). Callers decide whether it is allowed. */
export async function voidHold(db: Db, gateway: PayPalGateway, paymentId: string, ctx: { actorId: string }): Promise<AuthorizeOutcome> {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status === "VOIDED") return { kind: "DECLINED", reason: "VOIDED" };
  if (payment.intent !== "AUTHORIZE" || !["AUTHORIZED", "AUTHORIZATION_PENDING"].includes(payment.status) || !payment.authorizationId) {
    throw new AppError("INVALID", `There is no held payment to release (payment status ${payment.status}).`);
  }
  let auth: PayPalAuthorization;
  try {
    auth = await gateway.voidAuthorization(payment.authorizationId, payment.voidRequestId ?? payment.captureRequestId);
  } catch (e) {
    if (!(e instanceof PayPalApiError)) throw e;
    await db.payment.update({ where: { id: payment.id }, data: { lastPaypalDebugId: e.debugId ?? null, statusReason: e.message.slice(0, 300) } });
    if (e.hasIssue("AUTHORIZATION_ALREADY_CAPTURED")) throw new AppError("INVALID", "PayPal says this hold was already captured, so it cannot be released.");
    throw new AppError("PAYPAL_ERROR", "PayPal did not release the hold. It is unchanged; you can retry.");
  }
  return applyAuthorizationState(db, payment, auth, { actorId: ctx.actorId, source: "void API response" });
}

export async function paymentSummary(db: Db | Tx, dealId: string) {
  const payments = await db.payment.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } });
  const relevant = payments.filter((p) => !["INITIATED", "ABANDONED"].includes(p.status));
  const latest = relevant.at(-1) ?? null;
  const isPaid = !!latest && PAID_STATUSES.has(latest.status);
  const isHeld = !!latest && HELD_STATUSES.has(latest.status);
  // Funded = the seller may deliver: money captured, or held by PayPal for this agreement
  // (a hold whose capture is pending at PayPal still counts, since the work was already funded).
  const isFunded = isPaid || isHeld || (!!latest && latest.intent === "AUTHORIZE" && latest.status === "CAPTURE_PENDING");
  return { payments, latest, isPaid, isHeld, isFunded };
}
