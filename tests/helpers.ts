import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { PayPalApiError, type CaptureAuthorizationInput, type CreateOrderInput, type PayPalAuthorization, type PayPalCapture, type PayPalGateway, type PayPalOrder } from "@/lib/paypal/gateway";
import type { BriefContent } from "@/lib/brief";

export const db = prisma;

export async function makeUser(name: string) {
  const id = randomUUID();
  return db.user.create({ data: { id, name, email: `${name.toLowerCase().replace(/\s+/g, ".")}.${id.slice(0, 6)}@example.test` } });
}

export const LOGO_BRIEF = `Hi Priya, thanks for the call today.

To confirm what we agreed: the price is $300 USD for the full logo package.
You will send two logo concepts as PNG images by November 12, 2026.
After I pick one, you deliver the final logo files in PNG and SVG formats.
The package includes two revision rounds.
Final files are due by November 20, 2026 at 5 PM New York time.

Thanks, Alex (Northwind Coffee)`;

/** Hand-written brief equivalent to what a correct extraction should produce (used to isolate payment/delivery tests from AI). */
export function logoBrief(text = LOGO_BRIEF): BriefContent {
  const ref = (q: string) => {
    const start = text.indexOf(q);
    if (start < 0) throw new Error(`fixture quote not found: ${q}`);
    return { source: "S1", start, end: start + q.length, quote: q };
  };
  return {
    title: "Northwind Coffee logo package",
    price: { amountMinor: 30000, currency: "USD", refs: [ref("the price is $300 USD for the full logo package")], status: "sourced" },
    deadline: { date: "2026-11-20", time: "17:00", timezone: "America/New_York", refs: [ref("Final files are due by November 20, 2026 at 5 PM New York time")], status: "sourced" },
    revisionRounds: { count: 2, refs: [ref("The package includes two revision rounds")], status: "sourced" },
    deliverables: [
      { key: "D1", label: "Logo concepts", quantity: 2, formats: ["png"], refs: [ref("You will send two logo concepts as PNG images")], status: "sourced" },
      { key: "D2", label: "Final logo files", quantity: null, formats: ["png", "svg"], refs: [ref("you deliver the final logo files in PNG and SVG formats")], status: "sourced" },
    ],
    openQuestions: [],
  };
}

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 2, 0, 8, 6, 0, 0, 0, 0, 0, 0, 0,
]);
export const SVG_BYTES = new TextEncoder().encode(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="200" fill="#5a3"/></svg>`);
export const EVIL_SVG_BYTES = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>fetch('https://evil.test')</script></svg>`);

type Behavior = "COMPLETED" | "PENDING" | "DECLINED" | "INSTRUMENT_DECLINED" | "ALREADY_CAPTURED_AFTER" | "TAMPER_CAPTURE_AMOUNT";
type AuthBehavior = "CREATED" | "PENDING" | "DENIED" | "TAMPER_AUTH_AMOUNT" | "ALREADY_AUTHORIZED_AFTER";
type CaptureAuthBehavior = "COMPLETED" | "PENDING" | "EXPIRED";

/**
 * MOCK PayPal used only by automated tests. It mimics documented Orders v2
 * behaviour (idempotency by PayPal-Request-Id, APPROVED before capture,
 * ORDER_ALREADY_CAPTURED) and records every call so tests can assert that a
 * capture was or was not attempted.
 */
export class ScriptedGateway implements PayPalGateway {
  readonly mode = "SANDBOX" as const;
  orders = new Map<string, PayPalOrder>();
  createRequests = new Map<string, string>();
  captureRequests = new Map<string, PayPalOrder>();
  calls: string[] = [];
  behavior: Behavior = "COMPLETED";
  authBehavior: AuthBehavior = "CREATED";
  captureAuthBehavior: CaptureAuthBehavior = "COMPLETED";
  orderAmountOverride: { currency_code: string; value: string } | null = null;
  authorizations = new Map<string, PayPalAuthorization>();
  authorizeRequests = new Map<string, PayPalOrder>();
  captureAuthRequests = new Map<string, PayPalCapture>();
  holdCaptures = new Map<string, PayPalCapture>();
  private n = 0;

  async createOrder(input: CreateOrderInput) {
    this.calls.push(`create:${input.requestId}`);
    const prior = this.createRequests.get(input.requestId);
    if (prior) return structuredClone(this.orders.get(prior)!);
    const id = `TESTORDER${randomUUID().slice(0, 8).toUpperCase()}${++this.n}`;
    const order: PayPalOrder = { id, status: "CREATED", intent: input.intent ?? "CAPTURE", purchase_units: [{ reference_id: input.referenceId, custom_id: input.customId, invoice_id: input.invoiceId, amount: this.orderAmountOverride ?? { currency_code: input.currency, value: input.amountValue } }] };
    this.orders.set(id, order);
    this.createRequests.set(input.requestId, id);
    return structuredClone(order);
  }
  approve(orderId: string) {
    this.orders.get(orderId)!.status = "APPROVED";
  }
  async getOrder(orderId: string) {
    this.calls.push(`get:${orderId}`);
    const o = this.orders.get(orderId);
    if (!o) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], "dbg", "not found");
    return structuredClone(o);
  }
  async captureOrder(orderId: string, requestId: string) {
    this.calls.push(`capture:${orderId}:${requestId}`);
    const prior = this.captureRequests.get(requestId);
    if (prior) return structuredClone(prior);
    const o = this.orders.get(orderId)!;
    if (o.status === "COMPLETED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["ORDER_ALREADY_CAPTURED"], "dbg", "already captured");
    if (o.status !== "APPROVED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["ORDER_NOT_APPROVED"], "dbg", "not approved");
    if (this.behavior === "INSTRUMENT_DECLINED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["INSTRUMENT_DECLINED"], "dbg", "declined");
    const pu = o.purchase_units![0]!;
    const status = this.behavior === "PENDING" ? "PENDING" : this.behavior === "DECLINED" ? "DECLINED" : "COMPLETED";
    const amount = this.behavior === "TAMPER_CAPTURE_AMOUNT" ? { currency_code: pu.amount!.currency_code, value: "1.00" } : pu.amount;
    const capture: PayPalCapture = {
      id: `TESTCAPTURE${randomUUID().slice(0, 8).toUpperCase()}${this.n}`, status, amount, custom_id: pu.custom_id, invoice_id: pu.invoice_id,
      status_details: status === "PENDING" ? { reason: "PENDING_REVIEW" } : undefined,
      seller_receivable_breakdown: { gross_amount: amount, paypal_fee: { currency_code: "USD", value: "10.77" }, net_amount: { currency_code: "USD", value: "289.23" } },
      supplementary_data: { related_ids: { order_id: orderId } },
    };
    pu.payments = { captures: [capture] };
    o.status = "COMPLETED";
    o.payer = { payer_id: "TESTPAYER123" };
    if (this.behavior === "ALREADY_CAPTURED_AFTER") {
      // Simulate a timeout: PayPal captured but our process never saw the response.
      throw new PayPalApiError(500, "INTERNAL_SERVER_ERROR", [], "dbg", "timeout");
    }
    this.captureRequests.set(requestId, structuredClone(o));
    return structuredClone(o);
  }
  async getCapture(captureId: string) {
    const held = this.holdCaptures.get(captureId);
    if (held) return structuredClone(held);
    for (const o of this.orders.values()) {
      const c = o.purchase_units?.[0]?.payments?.captures?.find((x) => x.id === captureId);
      if (c) return structuredClone(c);
    }
    throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", [], "dbg", "no capture");
  }
  captureCalls() {
    return this.calls.filter((c) => c.startsWith("capture:"));
  }

  // ----- authorize-then-capture (holds) -----
  async authorizeOrder(orderId: string, requestId: string) {
    this.calls.push(`authorize:${orderId}:${requestId}`);
    const prior = this.authorizeRequests.get(requestId);
    if (prior) return structuredClone(prior);
    const o = this.orders.get(orderId)!;
    if (o.status === "COMPLETED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["ORDER_ALREADY_AUTHORIZED"], "dbg", "already authorized");
    if (o.status !== "APPROVED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["ORDER_NOT_APPROVED"], "dbg", "not approved");
    if (this.behavior === "INSTRUMENT_DECLINED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["INSTRUMENT_DECLINED"], "dbg", "declined");
    const pu = o.purchase_units![0]!;
    const status = this.authBehavior === "PENDING" ? "PENDING" : this.authBehavior === "DENIED" ? "DENIED" : "CREATED";
    const amount = this.authBehavior === "TAMPER_AUTH_AMOUNT" ? { currency_code: pu.amount!.currency_code, value: "1.00" } : pu.amount;
    const auth: PayPalAuthorization = {
      id: `TESTAUTH${randomUUID().slice(0, 8).toUpperCase()}${++this.n}`, status, amount, custom_id: pu.custom_id, invoice_id: pu.invoice_id,
      status_details: status === "PENDING" ? { reason: "PENDING_REVIEW" } : undefined,
      expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString(), supplementary_data: { related_ids: { order_id: orderId } },
    };
    pu.payments = { authorizations: [auth] };
    o.status = "COMPLETED";
    o.payer = { payer_id: "TESTPAYER123" };
    this.authorizations.set(auth.id, auth);
    if (this.authBehavior === "ALREADY_AUTHORIZED_AFTER") throw new PayPalApiError(500, "INTERNAL_SERVER_ERROR", [], "dbg", "timeout after authorizing");
    this.authorizeRequests.set(requestId, structuredClone(o));
    return structuredClone(o);
  }
  async getAuthorization(authorizationId: string) {
    this.calls.push(`getauth:${authorizationId}`);
    const a = this.authorizations.get(authorizationId);
    if (!a) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], "dbg", "no authorization");
    return structuredClone(a);
  }
  async captureAuthorization(authorizationId: string, input: CaptureAuthorizationInput) {
    this.calls.push(`capauth:${authorizationId}:${input.requestId}`);
    const prior = this.captureAuthRequests.get(input.requestId);
    if (prior) return structuredClone(prior);
    const a = this.authorizations.get(authorizationId)!;
    if (a.status === "VOIDED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_VOIDED"], "dbg", "voided");
    if (a.status === "CAPTURED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_ALREADY_CAPTURED"], "dbg", "already captured");
    if (this.captureAuthBehavior === "EXPIRED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_EXPIRED"], "dbg", "expired");
    const amount = { currency_code: input.currency, value: input.amountValue };
    const status = this.captureAuthBehavior === "PENDING" ? "PENDING" : "COMPLETED";
    const capture: PayPalCapture = {
      id: `TESTHOLDCAP${randomUUID().slice(0, 8).toUpperCase()}${++this.n}`, status, amount, final_capture: input.finalCapture,
      status_details: status === "PENDING" ? { reason: "PENDING_REVIEW" } : undefined,
      seller_receivable_breakdown: { gross_amount: amount, paypal_fee: { currency_code: "USD", value: "10.77" }, net_amount: { currency_code: "USD", value: "289.23" } },
      supplementary_data: { related_ids: { order_id: a.supplementary_data?.related_ids?.order_id } },
    };
    a.status = "CAPTURED";
    this.holdCaptures.set(capture.id, capture);
    this.captureAuthRequests.set(input.requestId, structuredClone(capture));
    return structuredClone(capture);
  }
  async voidAuthorization(authorizationId: string, requestId: string) {
    this.calls.push(`void:${authorizationId}:${requestId}`);
    const a = this.authorizations.get(authorizationId)!;
    if (a.status === "CAPTURED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_ALREADY_CAPTURED"], "dbg", "already captured");
    a.status = "VOIDED";
    return structuredClone(a);
  }
  holdCaptureCalls() {
    return this.calls.filter((c) => c.startsWith("capauth:"));
  }
  authorizeCalls() {
    return this.calls.filter((c) => c.startsWith("authorize:"));
  }
}
