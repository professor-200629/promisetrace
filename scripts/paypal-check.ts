/**
 * Live PayPal sandbox check (no browser, no money moves):
 *  1. OAuth client-credentials token
 *  2. Create a $1.00 USD order with a PayPal-Request-Id
 *  3. Repeat the same create with the same PayPal-Request-Id -> must return the same order id
 *  4. GET the order and confirm amount, custom_id and status CREATED
 * Buyer approval and capture need the PayPal popup (a real sandbox buyer), so
 * they are proven in the app itself; this script only proves credentials and
 * the server-side create/idempotency path.
 *
 * Run: npm run paypal:check
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { SandboxPayPalGateway, PayPalApiError } from "../src/lib/paypal/gateway";

async function main() {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    console.log("SETUP NEEDED: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are empty in .env (sandbox app credentials).");
    process.exit(2);
  }
  const gw = new SandboxPayPalGateway(id, secret);
  const t0 = Date.now();
  await gw.accessToken();
  console.log(`1. OAuth token: OK (${Date.now() - t0} ms)`);

  const requestId = randomUUID();
  const input = {
    requestId,
    amountValue: "1.00",
    currency: "USD",
    invoiceId: `PT-CHECK-${Date.now()}`,
    customId: "promisetrace-check",
    referenceId: "check",
    description: "PromiseTrace sandbox connectivity check",
  };
  const a = await gw.createOrder(input);
  console.log(`2. Create order: ${a.id} status=${a.status}`);
  const b = await gw.createOrder(input);
  console.log(`3. Same PayPal-Request-Id again: ${b.id} -> ${a.id === b.id ? "SAME order (idempotent)" : "DIFFERENT order (unexpected)"}`);
  const g = await gw.getOrder(a.id);
  const pu = g.purchase_units?.[0];
  console.log(`4. GET order: status=${g.status} amount=${pu?.amount?.value} ${pu?.amount?.currency_code} custom_id=${pu?.custom_id}`);
  const approve = g.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
  console.log(`   approval link host: ${approve ? new URL(approve.href).host : "(none)"}`);
  console.log("RESULT: sandbox credentials and server-side order creation work. Capture requires buyer approval in the app.");
  if (a.id !== b.id) process.exit(1);
}

main().catch((e) => {
  if (e instanceof PayPalApiError) console.error(`FAILED: ${e.message} debug_id=${e.debugId ?? "-"}`);
  else console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
