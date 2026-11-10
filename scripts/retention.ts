/**
 * Retention clean-up (run on a schedule in hosting, or by hand):
 *  - agreements never paid and untouched for RETENTION_UNPAID_DAYS (default 30) are deleted
 *  - soft-deleted agreements are purged
 * Agreements for which PayPal held or moved money (holds included) are never purged.
 *
 *   npm run retention            # dry run
 *   npm run retention -- --apply # actually delete
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { DELETABLE_PAYMENT_STATUSES } from "../src/lib/services/deals";

async function main() {
  const apply = process.argv.includes("--apply");
  const days = Number(process.env.RETENTION_UNPAID_DAYS ?? 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const candidates = await prisma.deal.findMany({
    where: {
      // Never purge an agreement for which PayPal held or moved money (holds included).
      payments: { none: { status: { notIn: DELETABLE_PAYMENT_STATUSES } } },
      OR: [{ deletedAt: { not: null } }, { updatedAt: { lt: cutoff } }],
    },
    select: { id: true, title: true, updatedAt: true },
  });
  console.log(`${candidates.length} agreement(s) eligible for deletion (unpaid and older than ${days} days, or soft-deleted).`);
  for (const d of candidates) console.log(`  ${d.id}  ${d.updatedAt.toISOString().slice(0, 10)}  ${d.title}`);
  if (!apply) return console.log("Dry run. Re-run with --apply to delete.");
  for (const d of candidates) {
    await prisma.$transaction([prisma.payment.deleteMany({ where: { dealId: d.id } }), prisma.deal.delete({ where: { id: d.id } })]);
  }
  console.log("Deleted.");
}

main().finally(() => prisma.$disconnect());
