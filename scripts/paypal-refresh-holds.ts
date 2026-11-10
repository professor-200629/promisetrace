/**
 * Re-reads every held (intent AUTHORIZE) payment's authorization from the
 * PayPal sandbox and records what PayPal reports now: CAPTURED, VOIDED,
 * EXPIRED or still CREATED. Uses the same state logic as the app and the
 * webhooks, so a late status never undoes a capture. Safe to run repeatedly.
 *
 *   npx tsx scripts/paypal-refresh-holds.ts            # dry run: prints what PayPal says
 *   npx tsx scripts/paypal-refresh-holds.ts --apply    # records it
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { SandboxPayPalGateway } from "../src/lib/paypal/gateway";
import { applyAuthorizationState } from "../src/lib/services/payments";

async function main() {
  const apply = process.argv.includes("--apply");
  const gw = new SandboxPayPalGateway(process.env.PAYPAL_CLIENT_ID!.trim(), process.env.PAYPAL_CLIENT_SECRET!.trim());
  const rows = await prisma.payment.findMany({ where: { intent: "AUTHORIZE", mode: "SANDBOX", authorizationId: { not: null } }, orderBy: { createdAt: "asc" } });
  console.log(`${rows.length} held payment(s) with an authorization.`);
  for (const p of rows) {
    const auth = await gw.getAuthorization(p.authorizationId!);
    console.log(`  ${p.authorizationId}  stored ${p.status}/${p.authorizationStatus ?? "-"}  PayPal ${auth.status}`);
    if (apply) await applyAuthorizationState(prisma, p, auth, { actorId: null, source: "refresh from PayPal (scripts/paypal-refresh-holds.ts)" });
  }
  if (!apply) console.log("Dry run. Re-run with --apply to record PayPal's current status.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
