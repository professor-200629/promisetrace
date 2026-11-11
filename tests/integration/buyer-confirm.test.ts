/**
 * Regression: an agreed deliverable that code cannot check (NOT_CHECKABLE) must not let the seller
 * capture a held payment on the buyer's silence. Only the buyer's acceptance of the current delivery
 * can capture it. Optional fields the parties never agreed on (no deadline, no revision count) do
 * not block. Real SQLite, MOCK PayPal gateway; no network.
 */
import { describe, expect, it } from "vitest";
import { db, makeUser, logoBrief, LOGO_BRIEF, ScriptedGateway, PNG_BYTES, SVG_BYTES, EVIL_SVG_BYTES } from "../helpers";
import { canonicalJson } from "@/lib/hash";
import { createDeal, acceptInvite, approveVersion, hashContent } from "@/lib/services/briefs";
import { authorizePayment, createCheckout, paymentSummary } from "@/lib/services/payments";
import { captureOnAcceptance, sellerCapture } from "@/lib/services/hold";
import { submitDelivery } from "@/lib/services/delivery";
import { recordBuyerAction } from "@/lib/services/buyer";
import { buildDealView, evidenceJson } from "@/lib/services/evidence";
import { AppError } from "@/lib/errors";
import type { BriefContent } from "@/lib/brief";

async function expectCode(p: Promise<unknown>, code: string, message?: RegExp) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    if (message) expect((e as AppError).message).toMatch(message);
    return;
  }
  throw new Error(`expected ${code}`);
}

async function heldDeal(content: BriefContent) {
  const seller = await makeUser("Priya Seller");
  const buyer = await makeUser("Alex Buyer");
  const { deal, inviteToken } = await createDeal(db, seller.id, { title: "Logo package", sourceTitle: "Email", sourceKind: "CONVERSATION", sourceText: LOGO_BRIEF });
  await acceptInvite(db, inviteToken, buyer.id);
  const v1 = await db.briefVersion.create({ data: { dealId: deal.id, number: 1, kind: "ORIGINAL", origin: "MANUAL", content: canonicalJson(content), contentHash: hashContent(content), createdById: seller.id } });
  await approveVersion(db, deal.id, seller.id, v1.id, v1.contentHash);
  await approveVersion(db, deal.id, buyer.id, v1.id, v1.contentHash);
  const gw = new ScriptedGateway();
  const { orderId } = await createCheckout(db, gw, deal.id, buyer.id);
  gw.approve(orderId);
  expect((await authorizePayment(db, gw, deal.id, buyer.id, orderId)).kind).toBe("AUTHORIZED");
  return { seller, buyer, deal, gw };
}

/** Moves every delivery and buyer action back in time, keeping their order. */
async function backdate(dealId: string, days: number) {
  const ms = days * 86_400_000;
  for (const d of await db.delivery.findMany({ where: { dealId } })) {
    await db.delivery.update({ where: { id: d.id }, data: { submittedAt: new Date(d.submittedAt.getTime() - ms) } });
  }
  for (const a of await db.buyerAction.findMany({ where: { dealId } })) {
    await db.buyerAction.update({ where: { id: a.id }, data: { createdAt: new Date(a.createdAt.getTime() - ms) } });
  }
}

const CHECKABLE_FILES = [
  { deliverableKey: "D1", name: "concept-a.png", bytes: PNG_BYTES },
  { deliverableKey: "D1", name: "concept-b.png", bytes: PNG_BYTES },
  { deliverableKey: "D2", name: "final.png", bytes: PNG_BYTES },
  { deliverableKey: "D2", name: "final.svg", bytes: SVG_BYTES },
];

describe("agreed items that only the buyer can confirm", () => {
  it("block the seller's capture after the review window until the buyer accepts the current delivery", async () => {
    const b = logoBrief();
    b.deadline = { ...b.deadline, date: "2030-01-15" };
    b.deliverables.push(
      { key: "D3", label: "Brand guidelines (Illustrator)", quantity: 1, formats: ["ai"], refs: [], status: "edited" },
      { key: "D4", label: "Colour palette suggestion", quantity: null, formats: [], refs: [], status: "edited" },
    );
    const s = await heldDeal(b);
    // No .ai file arrives: code cannot tell (an uploaded .ai would also be flagged, since its contents
    // cannot be identified), so only the buyer can say whether the guidelines were delivered.
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [...CHECKABLE_FILES, { deliverableKey: "D4", name: "palette.png", bytes: PNG_BYTES }] });
    await backdate(s.deal.id, 6);

    const view = await buildDealView(db, s.deal.id, s.seller.id);
    expect(view.rows.filter((r) => r.group === "Deliverables" && r.result === "NOT_CHECKABLE").map((r) => r.key).sort()).toEqual(["D3:ai", "D4:any"]);
    expect(view.rows.filter((r) => r.group === "Deliverables" && (r.result === "NOT_MET" || r.result === "NEEDS_REVIEW"))).toHaveLength(0);
    expect(view.rows.find((r) => r.key === "deadline")!.result).toBe("MET");
    expect(view.hold.sellerCapture.allowed).toBe(false);
    expect(view.status).toMatchObject({ key: "BUYER_TO_CONFIRM", label: "Buyer to confirm (2)" });
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET", /only be confirmed by the buyer/);
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);

    // A new delivery after an earlier acceptance needs a new acceptance.
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACKNOWLEDGE_RECEIPT", message: "", requirementKeys: [] });
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET", /only be confirmed by the buyer/);

    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "Guidelines and palette look right", requirementKeys: [] });
    expect((await buildDealView(db, s.deal.id, s.seller.id)).status.key).toBe("ACCEPTED_NOT_CAPTURED");
    expect((await captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id))?.kind).toBe("COMPLETED");
    expect((await paymentSummary(db, s.deal.id)).latest).toMatchObject({ status: "COMPLETED", captureTrigger: "BUYER_ACCEPTED" });
    // Captured, accepted, nothing open: the agreement reads Complete, here and in the exported record.
    const done = await buildDealView(db, s.deal.id, s.buyer.id);
    expect(done.status).toMatchObject({ key: "COMPLETE", label: "Complete", simulated: false });
    expect(evidenceJson(done).status).toMatchObject({ key: "COMPLETE", label: "Complete" });
    // The items only the buyer could confirm now read as confirmed by the buyer (a statement, not a code check).
    expect(done.rows.filter((r) => r.result === "CONFIRMED_BY_BUYER").map((r) => [r.key, r.observedBy])).toEqual([["D3:ai", "Buyer statement"], ["D4:any", "Buyer statement"]]);
    expect(done.summary.met).toBe(done.summary.total);
  });

  it("an earlier acceptance does not carry over to a newer delivery", async () => {
    const b = logoBrief();
    b.deadline = { ...b.deadline, date: "2030-01-15" };
    b.deliverables.push({ key: "D3", label: "Colour palette suggestion", quantity: null, formats: [], refs: [], status: "edited" });
    const s = await heldDeal(b);
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: CHECKABLE_FILES.slice(0, 3) });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "", requirementKeys: [] });
    await new Promise((r) => setTimeout(r, 20));
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "SVG added", files: [CHECKABLE_FILES[3]!] });
    await backdate(s.deal.id, 6);
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET", /only be confirmed by the buyer/);
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
  });

  it("optional fields the parties never agreed on do not block the seller once every agreed deliverable is met", async () => {
    const b = logoBrief();
    b.deadline = { date: null, time: null, timezone: null, refs: [], status: "unknown" };
    b.revisionRounds = { count: null, refs: [], status: "unknown" };
    const s = await heldDeal(b);
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: CHECKABLE_FILES });
    await backdate(s.deal.id, 6);
    const view = await buildDealView(db, s.deal.id, s.seller.id);
    expect(view.rows.find((r) => r.key === "deadline")!.result).toBe("NOT_AGREED");
    expect(view.rows.find((r) => r.key === "revisions")!.result).toBe("NOT_AGREED");
    expect(view.hold.sellerCapture.allowed).toBe(true);
    expect((await sellerCapture(db, s.gw, s.deal.id, s.seller.id)).kind).toBe("COMPLETED");
    expect((await paymentSummary(db, s.deal.id)).latest!.captureTrigger).toBe("SELLER_AFTER_REVIEW_WINDOW");
  });

  it("a flagged file still blocks the seller after the review window, even when every format is present", async () => {
    const b = logoBrief();
    b.deadline = { ...b.deadline, date: "2030-01-15" };
    const s = await heldDeal(b);
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [...CHECKABLE_FILES.slice(0, 3), { deliverableKey: "D2", name: "final.svg", bytes: EVIL_SVG_BYTES }] });
    await backdate(s.deal.id, 6);
    const view = await buildDealView(db, s.deal.id, s.seller.id);
    expect(view.rows.find((r) => r.key === "D2:integrity")!.result).toBe("NEEDS_REVIEW");
    expect(view.status).toMatchObject({ key: "CHECKS_UNRESOLVED", label: "Delivery checks unresolved (1)" });
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET", /not met or flagged/);
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
  });
});
