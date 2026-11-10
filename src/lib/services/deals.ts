import type { Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { loadDealForUser, requireRole } from "@/lib/services/access";

/**
 * Once PayPal has held or taken money for an agreement, its record belongs to
 * both participants: one side cannot delete it. Only checkouts that never
 * reached PayPal's money states can be deleted.
 */
export const DELETABLE_PAYMENT_STATUSES = ["INITIATED", "ORDER_CREATED", "ABANDONED", "MISMATCH"];

export async function deletionBlocker(db: Db, dealId: string): Promise<string | null> {
  const blocking = await db.payment.findFirst({ where: { dealId, status: { notIn: DELETABLE_PAYMENT_STATUSES } }, orderBy: { createdAt: "desc" } });
  if (!blocking) return null;
  return `PayPal has ${blocking.status === "COMPLETED" ? "captured" : ["AUTHORIZED", "AUTHORIZATION_PENDING"].includes(blocking.status) ? "a hold on" : "processed"} a payment for this agreement (status ${blocking.status}), so its record is kept for both participants and cannot be deleted by one of them.`;
}

/** Seller deletes PromiseTrace's copy of an agreement that never moved or held money. PayPal's records are unaffected. */
export async function deleteDeal(db: Db, dealId: string, userId: string) {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "SELLER", "delete this agreement");
  const blocker = await deletionBlocker(db, dealId);
  if (blocker) throw new AppError("LOCKED", blocker);
  await db.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { dealId } });
    await tx.deal.delete({ where: { id: dealId } });
  });
}
