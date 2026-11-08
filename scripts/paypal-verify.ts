/**
 * Re-reads the latest COMPLETED payment's order and capture directly from the
 * PayPal sandbox API and compares them with what PromiseTrace stored.
 *
 *   npm run paypal:verify
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { SandboxPayPalGateway } from "../src/lib/paypal/gateway";
import { formatMoney, sameAmount } from "../src/lib/money";

async function main() {
  const p = await prisma.payment.findFirst({ where: { status: "COMPLETED", mode: "SANDBOX" }, orderBy: { completedAt: "desc" } });
  if (!p || !p.captureId || !p.paypalOrderId) {
    console.log("No completed sandbox payment in this database.");
    return;
  }
  const gw = new SandboxPayPalGateway(process.env.PAYPAL_CLIENT_ID!.trim(), process.env.PAYPAL_CLIENT_SECRET!.trim());
  const [order, cap] = await Promise.all([gw.getOrder(p.paypalOrderId), gw.getCapture(p.captureId)]);
  const b = cap.seller_receivable_breakdown;
  console.log(`Stored : order ${p.paypalOrderId} capture ${p.captureId} ${p.status} ${formatMoney(p.amountMinor, p.currency)} invoice ${p.invoiceId} custom ${p.customId}`);
  console.log(`PayPal : order ${order.id} ${order.status}; capture ${cap.id} ${cap.status} ${cap.amount?.value} ${cap.amount?.currency_code} invoice ${cap.invoice_id} custom ${cap.custom_id}`);
  console.log(`         gross ${b?.gross_amount?.value} fee ${b?.paypal_fee?.value} net ${b?.net_amount?.value} · created ${cap.create_time}`);
  const ok = cap.status === "COMPLETED" && sameAmount(p.amountMinor, p.currency, cap.amount) && cap.invoice_id === p.invoiceId && cap.custom_id === p.customId;
  console.log(ok ? "MATCH: PayPal confirms this capture exactly as recorded." : "MISMATCH: check the fields above.");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
