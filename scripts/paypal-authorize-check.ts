/**
 * Live sandbox check: does authorize-then-capture work for this merchant?
 *
 *   npx tsx scripts/paypal-authorize-check.ts create          # prints an approval link (approve it in a browser)
 *   npx tsx scripts/paypal-authorize-check.ts authorize <orderId>
 *   npx tsx scripts/paypal-authorize-check.ts capture <authorizationId> <value> [final]
 *   npx tsx scripts/paypal-authorize-check.ts void <authorizationId>
 *   npx tsx scripts/paypal-authorize-check.ts show <authorizationId>
 *
 * Approve an order created with `create authorize sdk` on the local page: node scripts/paypal-authorize-page.mjs
 *
 * Sandbox only; no real money.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

const BASE = "https://api-m.sandbox.paypal.com";

async function token() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID!.trim()}:${process.env.PAYPAL_CLIENT_SECRET!.trim()}`).toString("base64");
  const r = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  return ((await r.json()) as { access_token: string }).access_token;
}

async function call(method: string, path: string, body?: unknown) {
  const t = await token();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Prefer: "return=representation", ...(method === "POST" ? { "PayPal-Request-Id": randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* empty */ }
  return { status: r.status, json, debugId: r.headers.get("paypal-debug-id") };
}

function issues(j: Record<string, unknown>) {
  const d = (j.details as Array<{ issue?: string; description?: string }> | undefined) ?? [];
  return d.map((x) => `${x.issue}: ${x.description}`).join(" | ") || String(j.message ?? j.name ?? "");
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "create") {
    // `create capture` makes a CAPTURE-intent control order; `... sdk` omits payment_source so the
    // order can be approved through the PayPal JS SDK Buttons (the path the app uses).
    const r = await call("POST", "/v2/checkout/orders", {
      intent: a === "capture" ? "CAPTURE" : "AUTHORIZE",
      purchase_units: [{ custom_id: "promisetrace-authorize-check", invoice_id: `PT-AUTHCHK-${Date.now()}`, description: "PromiseTrace authorize check (sandbox)", amount: { currency_code: "USD", value: "10.00" } }],
      ...(b === "sdk" ? {} : { payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: "https://promisetrace-sandbox.vercel.app/about?authorize_check=return", cancel_url: "https://promisetrace-sandbox.vercel.app/about?authorize_check=cancel" } } } }),
    });
    const links = (r.json.links as Array<{ rel: string; href: string }> | undefined) ?? [];
    console.log(`create: HTTP ${r.status} order ${r.json.id ?? "-"} status ${r.json.status ?? issues(r.json)} debug ${r.debugId}`);
    console.log(`approve at: ${links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? "(none)"}`);
  } else if (cmd === "authorize") {
    const r = await call("POST", `/v2/checkout/orders/${a}/authorize`, {});
    const auth = ((r.json.purchase_units as Array<{ payments?: { authorizations?: Array<Record<string, unknown>> } }> | undefined)?.[0]?.payments?.authorizations ?? [])[0];
    console.log(`authorize: HTTP ${r.status} order status ${r.json.status ?? issues(r.json)} debug ${r.debugId}`);
    if (auth) console.log(`authorization ${auth.id} status ${auth.status} amount ${JSON.stringify(auth.amount)} expires ${auth.expiration_time} reason ${JSON.stringify(auth.status_details ?? null)}`);
  } else if (cmd === "capture") {
    const r = await call("POST", `/v2/payments/authorizations/${a}/capture`, { amount: { currency_code: "USD", value: b ?? "10.00" }, final_capture: c === "final", invoice_id: `PT-AUTHCAP-${Date.now()}` });
    console.log(`capture: HTTP ${r.status} capture ${r.json.id ?? "-"} status ${r.json.status ?? issues(r.json)} amount ${JSON.stringify(r.json.amount ?? null)} final ${r.json.final_capture ?? "-"} debug ${r.debugId}`);
  } else if (cmd === "void") {
    const r = await call("POST", `/v2/payments/authorizations/${a}/void`);
    console.log(`void: HTTP ${r.status} status ${r.json.status ?? (r.status === 204 ? "VOIDED (204 No Content)" : issues(r.json))} debug ${r.debugId}`);
  } else if (cmd === "order") {
    const r = await call("GET", `/v2/checkout/orders/${a}`);
    console.log(`order: HTTP ${r.status} intent ${r.json.intent} status ${r.json.status ?? issues(r.json)} debug ${r.debugId}`);
  } else if (cmd === "show") {
    const r = await call("GET", `/v2/payments/authorizations/${a}`);
    console.log(`show: HTTP ${r.status} status ${r.json.status} amount ${JSON.stringify(r.json.amount ?? null)} expires ${r.json.expiration_time} details ${JSON.stringify(r.json.status_details ?? null)}`);
  } else {
    console.log("usage: create | authorize <orderId> | capture <authId> <value> [final] | void <authId> | show <authId>");
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
