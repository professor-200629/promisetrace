import type { Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { PayPalGateway } from "@/lib/paypal/gateway";
import { appendEvent } from "@/lib/services/events";
import { loadDealForUser, requireRole } from "@/lib/services/access";
import { buildView } from "@/lib/services/evidence";
import { captureHold, voidHold, type CaptureOutcome } from "@/lib/services/payments";
import { formatMoney } from "@/lib/money";

/**
 * Actions on a payment PayPal holds for an agreement. Each one re-checks the
 * rules in lib/hold-rules.ts on the server; the buttons in the UI are only a
 * convenience.
 */

/** Buyer accepted the latest delivery: capture the held payment for the seller. */
export async function captureOnAcceptance(db: Db, gateway: PayPalGateway, dealId: string, userId: string): Promise<CaptureOutcome | null> {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "BUYER", "accept deliveries");
  const view = await buildView(db, dealId, role);
  const p = view.payment.latest;
  if (!p || p.intent !== "AUTHORIZE") return null; // nothing is held: paid at checkout, or never paid
  if (p.status === "COMPLETED") return { kind: "COMPLETED", paymentId: p.id };
  if (!view.hold.held) return null;
  if (!view.hold.buyerAccepted) throw new AppError("INVALID", "Accept the latest delivery first.");
  return captureHold(db, gateway, p.id, { trigger: "BUYER_ACCEPTED", actorId: userId });
}

/** Seller captures a held payment: after the buyer accepted (retry), or after the review window with every check met. */
export async function sellerCapture(db: Db, gateway: PayPalGateway, dealId: string, userId: string): Promise<CaptureOutcome> {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "SELLER", "capture the held payment");
  const view = await buildView(db, dealId, role);
  const p = view.payment.latest;
  if (p?.status === "COMPLETED") return { kind: "COMPLETED", paymentId: p.id };
  if (!view.hold.sellerCapture.allowed || !p) throw new AppError("NOT_ALLOWED_YET", view.hold.sellerCapture.reason);
  const trigger = view.hold.buyerAccepted ? "BUYER_ACCEPTED" : "SELLER_AFTER_REVIEW_WINDOW";
  if (trigger === "SELLER_AFTER_REVIEW_WINDOW") {
    await db.$transaction((tx) => appendEvent(tx, { dealId, type: "SELLER_REQUESTED_CAPTURE", kind: "USER_DECLARATION", actorId: userId, actorRole: "SELLER",
      summary: `Seller asked PromiseTrace to capture the held ${formatMoney(p.amountMinor, p.currency)}. Basis checked by code: ${view.hold.sellerCapture.reason}`,
      data: { reviewEndsAt: view.hold.reviewEndsAt?.toISOString() ?? null } }));
  }
  return captureHold(db, gateway, p.id, { trigger, actorId: userId });
}

/** Release the hold to the buyer: the seller cancels the job, or the buyer after a missed deadline with nothing delivered. */
export async function releaseHoldToBuyer(db: Db, gateway: PayPalGateway, dealId: string, userId: string, reason: string) {
  const { role } = await loadDealForUser(db, dealId, userId);
  const view = await buildView(db, dealId, role);
  const p = view.payment.latest;
  if (!p) throw new AppError("INVALID", "No payment is held for this agreement.");
  if (p.status === "VOIDED") return { kind: "VOIDED" as const };
  const permission = role === "SELLER" ? view.hold.sellerVoid : view.hold.buyerVoid;
  if (!permission.allowed) throw new AppError("NOT_ALLOWED_YET", permission.reason);
  const text = reason.trim().slice(0, 500);
  if (role === "SELLER" && text.length < 5) throw new AppError("INVALID", "Say briefly why the job is cancelled; it is recorded in the history.");
  // The person's statement first, then PayPal's confirmation (or nothing, if PayPal refuses).
  await db.$transaction((tx) => appendEvent(tx, {
    dealId, type: role === "SELLER" ? "SELLER_CANCELLED_JOB" : "BUYER_RELEASED_HOLD", kind: "USER_DECLARATION", actorId: userId, actorRole: role,
    summary: role === "SELLER"
      ? `Seller cancelled the job and asked PayPal to release the hold to the buyer${text ? `: "${text}"` : "."}`
      : `Buyer asked PayPal to release the hold after the missed deadline. Basis checked by code: ${permission.reason}${text ? ` Buyer's note: "${text}"` : ""}`,
    data: { paymentId: p.id },
  }));
  await voidHold(db, gateway, p.id, { actorId: userId });
  return { kind: "VOIDED" as const };
}
