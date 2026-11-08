import type { Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendEvent } from "@/lib/services/events";
import { loadDealForUser, requireRole } from "@/lib/services/access";
import { parseContent, versionState } from "@/lib/services/briefs";

export const BUYER_ACTIONS = ["ACKNOWLEDGE_RECEIPT", "ACCEPT", "REQUEST_REVISION", "REPORT_PROBLEM", "WITHDRAW_OBJECTION"] as const;
export type BuyerActionType = (typeof BUYER_ACTIONS)[number];

const LABEL: Record<BuyerActionType, string> = {
  ACKNOWLEDGE_RECEIPT: "acknowledged receipt (not acceptance)",
  ACCEPT: "accepted the delivery",
  REQUEST_REVISION: "requested a revision",
  REPORT_PROBLEM: "reported a problem",
  WITHDRAW_OBJECTION: "withdrew an earlier objection",
};

/**
 * Buyer statements are recorded as separate, explicit declarations. They are
 * never inferred from downloads or silence. Objections stay visible until the
 * buyer withdraws them; a later acceptance does not erase them.
 */
export async function recordBuyerAction(db: Db, dealId: string, userId: string, input: { type: BuyerActionType; message: string; requirementKeys: string[]; refersToId?: string | null }) {
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "BUYER", "respond to deliveries");
  if (!BUYER_ACTIONS.includes(input.type)) throw new AppError("INVALID", "Unknown action.");
  const latest = await db.delivery.findFirst({ where: { dealId }, orderBy: { number: "desc" } });
  if (!latest) throw new AppError("INVALID", "Nothing has been delivered yet.");
  const message = input.message.trim().slice(0, 2000);
  if ((input.type === "REQUEST_REVISION" || input.type === "REPORT_PROBLEM") && message.length < 5) {
    throw new AppError("INVALID", "Describe what needs to change so the seller can respond.");
  }
  const st = await versionState(db, dealId);
  const brief = st.effective ? parseContent(st.effective) : null;
  const validKeys = new Set(["deadline", "price", "revisions", ...(brief?.deliverables.map((d) => d.key) ?? [])]);
  const keys = [...new Set(input.requirementKeys.filter((k) => validKeys.has(k)))].slice(0, 12);

  let refersTo: string | null = null;
  if (input.type === "WITHDRAW_OBJECTION") {
    const target = input.refersToId ? await db.buyerAction.findUnique({ where: { id: input.refersToId } }) : null;
    if (!target || target.dealId !== dealId || !["REQUEST_REVISION", "REPORT_PROBLEM"].includes(target.type)) throw new AppError("INVALID", "Choose an open objection to withdraw.");
    refersTo = target.id;
  }

  let revisionNote = "";
  if (input.type === "REQUEST_REVISION" && brief?.revisionRounds.count !== null && brief) {
    const used = await db.buyerAction.count({ where: { dealId, type: "REQUEST_REVISION" } });
    const n = used + 1;
    revisionNote = n > brief.revisionRounds.count! ? ` This is revision request ${n}; the brief includes ${brief.revisionRounds.count}.` : ` Revision round ${n} of ${brief.revisionRounds.count}.`;
  }

  return db.$transaction(async (tx) => {
    const a = await tx.buyerAction.create({ data: { dealId, deliveryId: latest.id, userId, type: input.type, message, requirementKeys: JSON.stringify(keys), refersToId: refersTo } });
    await appendEvent(tx, {
      dealId, type: `BUYER_${input.type}`, kind: "USER_DECLARATION", actorId: userId, actorRole: "BUYER",
      summary: `Buyer ${LABEL[input.type]} for delivery ${latest.number}${keys.length ? ` (about ${keys.join(", ")})` : ""}${message ? `: "${message.slice(0, 300)}"` : "."}${revisionNote}`,
      data: { actionId: a.id, delivery: latest.number, requirementKeys: keys, refersTo },
    });
    return a;
  });
}

export async function openObjections(db: Db, dealId: string) {
  const actions = await db.buyerAction.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } });
  const withdrawn = new Set(actions.filter((a) => a.type === "WITHDRAW_OBJECTION").map((a) => a.refersToId));
  return actions.filter((a) => (a.type === "REQUEST_REVISION" || a.type === "REPORT_PROBLEM") && !withdrawn.has(a.id));
}
