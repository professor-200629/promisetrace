/**
 * Minimal PayPal Orders v2 + Payments v2 client (sandbox only).
 * Docs checked 8 Nov 2026:
 *  - https://developer.paypal.com/docs/api/orders/v2/ (schema v2.36)
 *  - https://developer.paypal.com/api/rest/reference/idempotency/
 * Every POST carries a PayPal-Request-Id so a retried create/capture returns
 * the original result instead of creating a second order or capture.
 */

export type PayPalAmount = { currency_code: string; value: string };

export type PayPalCapture = {
  id: string;
  status: string; // COMPLETED | DECLINED | PARTIALLY_REFUNDED | PENDING | REFUNDED | FAILED
  status_details?: { reason?: string };
  amount?: PayPalAmount;
  custom_id?: string;
  invoice_id?: string;
  final_capture?: boolean;
  seller_receivable_breakdown?: {
    gross_amount?: PayPalAmount;
    paypal_fee?: PayPalAmount;
    net_amount?: PayPalAmount;
  };
  supplementary_data?: { related_ids?: { order_id?: string } };
  create_time?: string;
  update_time?: string;
};

/** A hold on the buyer's funds (Payments v2 authorization). Valid 29 days; capture is most likely to succeed in the first 3 (PayPal's honor period). */
export type PayPalAuthorization = {
  id: string;
  status: string; // CREATED | CAPTURED | DENIED | PARTIALLY_CAPTURED | VOIDED | PENDING | EXPIRED
  status_details?: { reason?: string };
  amount?: PayPalAmount;
  custom_id?: string;
  invoice_id?: string;
  expiration_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
  create_time?: string;
  update_time?: string;
};

export type PayPalOrder = {
  id: string;
  status: string; // CREATED | SAVED | APPROVED | VOIDED | COMPLETED | PAYER_ACTION_REQUIRED
  intent?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    description?: string;
    amount?: PayPalAmount;
    payee?: { merchant_id?: string; email_address?: string };
    payments?: { captures?: PayPalCapture[]; authorizations?: PayPalAuthorization[] };
  }>;
  payer?: { payer_id?: string; email_address?: string };
  links?: Array<{ href: string; rel: string; method?: string }>;
};

export type OrderIntent = "CAPTURE" | "AUTHORIZE";

export type CreateOrderInput = {
  requestId: string;
  intent?: OrderIntent; // default CAPTURE
  amountValue: string;
  currency: string;
  invoiceId: string;
  customId: string;
  referenceId: string;
  description: string;
};

export type CaptureAuthorizationInput = {
  requestId: string;
  amountValue: string;
  currency: string;
  finalCapture: boolean;
};

export class PayPalApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorName: string,
    readonly issues: string[],
    readonly debugId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
  hasIssue(issue: string) {
    return this.issues.includes(issue);
  }
}

export interface PayPalGateway {
  readonly mode: "SANDBOX" | "FIXTURE";
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  getCapture(captureId: string): Promise<PayPalCapture>;
  /** Places the hold for an APPROVED order created with intent AUTHORIZE. */
  authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  getAuthorization(authorizationId: string): Promise<PayPalAuthorization>;
  captureAuthorization(authorizationId: string, input: CaptureAuthorizationInput): Promise<PayPalCapture>;
  /** Releases the hold. Returns the authorization as PayPal reports it afterwards. */
  voidAuthorization(authorizationId: string, requestId: string): Promise<PayPalAuthorization>;
}

export const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";

export function buildCreateOrderBody(input: CreateOrderInput) {
  return {
    intent: input.intent ?? "CAPTURE",
    purchase_units: [
      {
        reference_id: input.referenceId,
        custom_id: input.customId,
        invoice_id: input.invoiceId,
        description: input.description.slice(0, 127),
        amount: { currency_code: input.currency, value: input.amountValue },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          brand_name: "PromiseTrace demo",
        },
      },
    },
  };
}

type TokenCache = { token: string; expiresAt: number };

export class SandboxPayPalGateway implements PayPalGateway {
  readonly mode = "SANDBOX" as const;
  private tokenCache: TokenCache | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly baseUrl: string = SANDBOX_API_BASE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!baseUrl.startsWith("https://api-m.sandbox.paypal.com") && !baseUrl.startsWith("http://127.0.0.1")) {
      throw new Error("PromiseTrace only talks to the PayPal sandbox");
    }
  }

  async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) return this.tokenCache.token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      throw new PayPalApiError(res.status, body.error ?? "AUTHENTICATION_FAILURE", [], res.headers.get("paypal-debug-id") ?? undefined,
        `PayPal sandbox authentication failed (HTTP ${res.status}). Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.`);
    }
    this.tokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 };
    return body.access_token;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const details = Array.isArray(json.details) ? (json.details as Array<{ issue?: string }>) : [];
      const issues = details.map((d) => d.issue ?? "").filter(Boolean);
      const name = typeof json.name === "string" ? json.name : "PAYPAL_ERROR";
      throw new PayPalApiError(res.status, name, issues, debugId,
        `PayPal ${method} ${path.replace(/[A-Z0-9]{10,}/g, ":id")} failed: HTTP ${res.status} ${name}${issues.length ? ` (${issues.join(", ")})` : ""}`);
    }
    return json as T;
  }

  createOrder(input: CreateOrderInput) {
    return this.call<PayPalOrder>("POST", "/v2/checkout/orders", buildCreateOrderBody(input), input.requestId);
  }
  getOrder(orderId: string) {
    return this.call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }
  captureOrder(orderId: string, requestId: string) {
    return this.call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, requestId);
  }
  getCapture(captureId: string) {
    return this.call<PayPalCapture>("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
  }
  authorizeOrder(orderId: string, requestId: string) {
    return this.call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, requestId);
  }
  getAuthorization(authorizationId: string) {
    return this.call<PayPalAuthorization>("GET", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
  }
  captureAuthorization(authorizationId: string, input: CaptureAuthorizationInput) {
    // invoice_id is left out on purpose: the order already carries it, and PayPal may reject a repeated invoice id.
    return this.call<PayPalCapture>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      { amount: { currency_code: input.currency, value: input.amountValue }, final_capture: input.finalCapture }, input.requestId);
  }
  async voidAuthorization(authorizationId: string, requestId: string) {
    const r = await this.call<PayPalAuthorization | Record<string, never>>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, requestId);
    // PayPal answers 204 No Content (empty body) or 200 with the authorization, depending on the Prefer header.
    if ("id" in r && typeof r.id === "string") return r as PayPalAuthorization;
    return this.getAuthorization(authorizationId);
  }
}

/**
 * Offline fixture: never contacts PayPal. Orders are "approved" instantly and
 * captures complete. Everything it produces is stored with mode FIXTURE and
 * shown with a FIXTURE label. Tests use `ScriptedGateway` for edge cases.
 */
export class FixturePayPalGateway implements PayPalGateway {
  readonly mode = "FIXTURE" as const;
  private orders = new Map<string, PayPalOrder>();
  private byRequest = new Map<string, string>();
  private captures = new Map<string, PayPalCapture>();
  private authorizations = new Map<string, PayPalAuthorization>();
  private seq = 0;

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const existing = this.byRequest.get(input.requestId);
    if (existing) return structuredClone(this.orders.get(existing)!);
    const id = `FIXTURE-ORDER-${Date.now().toString(36).toUpperCase()}-${++this.seq}`;
    const order: PayPalOrder = {
      id,
      status: "APPROVED",
      intent: input.intent ?? "CAPTURE",
      purchase_units: [{
        reference_id: input.referenceId,
        custom_id: input.customId,
        invoice_id: input.invoiceId,
        description: input.description,
        amount: { currency_code: input.currency, value: input.amountValue },
      }],
    };
    this.orders.set(id, order);
    this.byRequest.set(input.requestId, id);
    return structuredClone(order);
  }

  async getOrder(orderId: string) {
    const o = this.orders.get(orderId);
    if (!o) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture order not found");
    return structuredClone(o);
  }

  async captureOrder(orderId: string, requestId: string) {
    const o = this.orders.get(orderId);
    if (!o) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture order not found");
    const prior = this.byRequest.get(`capture:${requestId}`);
    if (prior) return structuredClone(o);
    if (o.status === "COMPLETED") {
      throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["ORDER_ALREADY_CAPTURED"], undefined, "Fixture order already captured");
    }
    const pu = o.purchase_units![0]!;
    const capture: PayPalCapture = {
      id: `FIXTURE-CAPTURE-${++this.seq}`,
      status: "COMPLETED",
      amount: pu.amount,
      custom_id: pu.custom_id,
      invoice_id: pu.invoice_id,
      final_capture: true,
      seller_receivable_breakdown: { gross_amount: pu.amount },
      supplementary_data: { related_ids: { order_id: orderId } },
    };
    pu.payments = { captures: [capture] };
    o.status = "COMPLETED";
    o.payer = { payer_id: "FIXTUREPAYER" };
    this.captures.set(capture.id, capture);
    this.byRequest.set(`capture:${requestId}`, orderId);
    return structuredClone(o);
  }

  async getCapture(captureId: string) {
    const c = this.captures.get(captureId);
    if (!c) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture capture not found");
    return structuredClone(c);
  }

  async authorizeOrder(orderId: string, requestId: string) {
    const o = this.orders.get(orderId);
    if (!o) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture order not found");
    if (this.byRequest.get(`authorize:${requestId}`)) return structuredClone(o);
    if (o.status === "COMPLETED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["ORDER_ALREADY_AUTHORIZED"], undefined, "Fixture order already authorized");
    const pu = o.purchase_units![0]!;
    const auth: PayPalAuthorization = {
      id: `FIXTURE-AUTH-${++this.seq}`, status: "CREATED", amount: pu.amount, custom_id: pu.custom_id, invoice_id: pu.invoice_id,
      expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString(), supplementary_data: { related_ids: { order_id: orderId } },
    };
    pu.payments = { authorizations: [auth] };
    o.status = "COMPLETED";
    o.payer = { payer_id: "FIXTUREPAYER" };
    this.authorizations.set(auth.id, auth);
    this.byRequest.set(`authorize:${requestId}`, orderId);
    return structuredClone(o);
  }

  async getAuthorization(authorizationId: string) {
    const a = this.authorizations.get(authorizationId);
    if (!a) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture authorization not found");
    return structuredClone(a);
  }

  async captureAuthorization(authorizationId: string, input: CaptureAuthorizationInput) {
    const a = this.authorizations.get(authorizationId);
    if (!a) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture authorization not found");
    const prior = this.byRequest.get(`capauth:${input.requestId}`);
    if (prior) return structuredClone(this.captures.get(prior)!);
    if (a.status === "VOIDED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_VOIDED"], undefined, "Fixture authorization voided");
    if (a.status === "CAPTURED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_ALREADY_CAPTURED"], undefined, "Fixture authorization already captured");
    const amount = { currency_code: input.currency, value: input.amountValue };
    const capture: PayPalCapture = {
      id: `FIXTURE-CAPTURE-${++this.seq}`, status: "COMPLETED", amount, custom_id: a.custom_id, invoice_id: a.invoice_id, final_capture: input.finalCapture,
      seller_receivable_breakdown: { gross_amount: amount }, supplementary_data: { related_ids: { order_id: a.supplementary_data?.related_ids?.order_id } },
    };
    a.status = input.finalCapture ? "CAPTURED" : "PARTIALLY_CAPTURED";
    this.captures.set(capture.id, capture);
    this.byRequest.set(`capauth:${input.requestId}`, capture.id);
    return structuredClone(capture);
  }

  async voidAuthorization(authorizationId: string) {
    const a = this.authorizations.get(authorizationId);
    if (!a) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", ["INVALID_RESOURCE_ID"], undefined, "Fixture authorization not found");
    if (a.status === "CAPTURED") throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_ALREADY_CAPTURED"], undefined, "Fixture authorization already captured");
    a.status = "VOIDED";
    return structuredClone(a);
  }
}
