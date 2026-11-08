import type { Db, Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type Role = "SELLER" | "BUYER";

/**
 * Every read or write of a deal goes through here. A user who is neither the
 * seller nor the joined buyer gets NOT_FOUND (not FORBIDDEN) so deal IDs
 * cannot be probed.
 */
export async function loadDealForUser(db: Db | Tx, dealId: string, userId: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId } });
  if (!deal || deal.deletedAt) throw new AppError("NOT_FOUND", "Agreement not found.");
  const role: Role | null = deal.sellerId === userId ? "SELLER" : deal.buyerId === userId ? "BUYER" : null;
  if (!role) throw new AppError("NOT_FOUND", "Agreement not found.");
  return { deal, role };
}

export function requireRole(role: Role, needed: Role, action: string) {
  if (role !== needed) throw new AppError("FORBIDDEN", `Only the ${needed.toLowerCase()} can ${action}.`);
}
