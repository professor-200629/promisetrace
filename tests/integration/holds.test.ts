/**
 * Hold at checkout (PayPal authorization), capture on acceptance.
 * Real SQLite database, MOCK PayPal gateway (ScriptedGateway); no network.
 * The live sandbox check of the same PayPal calls is in docs/VERIFICATION.md (5c).
 */
import { describe, expect, it } from "vitest";
import { db, makeUser, logoBrief, LOGO_BRIEF, ScriptedGateway, PNG_BYTES, SVG_BYTES } from "../helpers";
import { canonicalJson } from "@/lib/hash";
import { createDeal, acceptInvite, approveVersion, saveEdit, hashContent, versionState } from "@/lib/services/briefs";
import { authorizePayment, capturePayment, captureHold, createCheckout, paymentSummary } from "@/lib/services/payments";
import { captureOnAcceptance, releaseHoldToBuyer, sellerCapture } from "@/lib/services/hold";
import { submitDelivery } from "@/lib/services/delivery";
import { recordBuyerAction } from "@/lib/services/buyer";
import { buildDealView, evidenceJson } from "@/lib/services/evidence";
import { processVerifiedWebhook } from "@/lib/services/webhooks";
import { verifyChain } from "@/lib/services/events";
import { AppError } from "@/lib/errors";
import type { BriefContent } from "@/lib/brief";

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

function brief(deadlineDate: string): BriefContent {
  const b = logoBrief();
  b.deadline = { ...b.deadline, date: deadlineDate };
  return b;
}

async function approvedDeal(content: BriefContent = brief("2030-01-15")) {
  const seller = await makeUser("Priya Seller");
  const buyer = await makeUser("Alex Buyer");
  const { deal, inviteToken } = await createDeal(db, seller.id, { title: "Northwind Coffee logo package", sourceTitle: "Email thread", sourceKind: "CONVERSATION", sourceText: LOGO_BRIEF });
  await acceptInvite(db, inviteToken, buyer.id);
  const v1 = await db.briefVersion.create({ data: { dealId: deal.id, number: 1, kind: "ORIGINAL", origin: "MANUAL", content: canonicalJson(content), contentHash: hashContent(content), createdById: seller.id } });
  await approveVersion(db, deal.id, seller.id, v1.id, v1.contentHash);
  await approveVersion(db, deal.id, buyer.id, v1.id, v1.contentHash);
  return { seller, buyer, deal, v1 };
}

/** Buyer pays with the default flow: the order is created with intent AUTHORIZE and the hold is placed. */
async function heldDeal(content?: BriefContent, gw = new ScriptedGateway()) {
  const s = await approvedDeal(content);
  const { orderId, intent } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
  expect(intent).toBe("AUTHORIZE");
  gw.approve(orderId);
  const r = await authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId);
  expect(r.kind).toBe("AUTHORIZED");
  return { ...s, gw, orderId };
}

const ALL_FILES = [
  { deliverableKey: "D1", name: "concept-a.png", bytes: PNG_BYTES },
  { deliverableKey: "D1", name: "concept-b.png", bytes: PNG_BYTES },
  { deliverableKey: "D2", name: "final.png", bytes: PNG_BYTES },
  { deliverableKey: "D2", name: "final.svg", bytes: SVG_BYTES },
];

async function backdateDeliveries(dealId: string, days: number) {
  const ds = await db.delivery.findMany({ where: { dealId } });
  for (const d of ds) await db.delivery.update({ where: { id: d.id }, data: { submittedAt: new Date(d.submittedAt.getTime() - days * 86_400_000) } });
}

describe("hold at checkout", () => {
  it("a PayPal authorization funds the agreement, locks the version and opens delivery, but captures nothing", async () => {
    const s = await heldDeal();
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum.latest!.intent).toBe("AUTHORIZE");
    expect(sum.latest!.status).toBe("AUTHORIZED");
    expect(sum.latest!.authorizationExpiresAt).toBeInstanceOf(Date);
    expect(sum).toMatchObject({ isHeld: true, isFunded: true, isPaid: false });
    expect((await versionState(db, s.deal.id)).paid?.id).toBe(s.v1.id);
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    const view = await buildDealView(db, s.deal.id, s.buyer.id);
    expect(view.rows.find((r) => r.key === "price")!.result).toBe("PENDING"); // held is not paid
    expect(view.summary.agreed).toMatch(/held by PayPal/);
    // a second checkout is refused while the hold exists
    await expectCode(createCheckout(db, s.gw, s.deal.id, s.buyer.id), "ALREADY_PAID");
  });

  it("approval in the PayPal window is not a hold: an unapproved order is not authorized", async () => {
    const s = await approvedDeal();
    const gw = new ScriptedGateway();
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
    expect((await authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId)).kind).toBe("NOT_APPROVED");
    expect(gw.authorizeCalls()).toHaveLength(0);
    expect((await paymentSummary(db, s.deal.id)).isFunded).toBe(false);
    await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES }), "NOT_APPROVED");
  });

  it("refuses to authorize a checkout whose brief was edited afterwards", async () => {
    const s = await approvedDeal();
    const gw = new ScriptedGateway();
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
    gw.approve(orderId);
    const edited = brief("2030-01-15");
    edited.revisionRounds.count = 1;
    await saveEdit(db, s.deal.id, s.seller.id, s.v1.id, edited);
    await expectCode(authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId), "STALE_VERSION");
    expect(gw.authorizeCalls()).toHaveLength(0);
  });

  it("a hold for a different amount is rejected and never counts as funded", async () => {
    const s = await approvedDeal();
    const gw = new ScriptedGateway();
    gw.authBehavior = "TAMPER_AUTH_AMOUNT";
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
    gw.approve(orderId);
    await expectCode(authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId), "AMOUNT_MISMATCH");
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum.latest!.status).toBe("MISMATCH");
    expect(sum.isFunded).toBe(false);
    expect((await versionState(db, s.deal.id)).paid).toBeNull();
  });

  it("a PENDING or DENIED authorization is not funded", async () => {
    for (const b of ["PENDING", "DENIED"] as const) {
      const s = await approvedDeal();
      const gw = new ScriptedGateway();
      gw.authBehavior = b;
      const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
      gw.approve(orderId);
      const r = await authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId);
      expect(r.kind).toBe(b === "PENDING" ? "PENDING" : "DECLINED");
      expect((await paymentSummary(db, s.deal.id)).isFunded).toBe(false);
      await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES }), "NOT_APPROVED");
    }
  });

  it("a lost authorize response is reconciled from PayPal with the same request id", async () => {
    const s = await approvedDeal();
    const gw = new ScriptedGateway();
    gw.authBehavior = "ALREADY_AUTHORIZED_AFTER";
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
    gw.approve(orderId);
    await expectCode(authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId), "PAYPAL_ERROR");
    expect((await paymentSummary(db, s.deal.id)).isFunded).toBe(false);
    expect((await authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId)).kind).toBe("AUTHORIZED");
    expect(new Set(gw.authorizeCalls().map((c) => c.split(":")[2])).size).toBe(1);
  });

  it("the capture-at-checkout endpoint refuses a hold checkout", async () => {
    const s = await heldDeal();
    await expectCode(capturePayment(db, s.gw, s.deal.id, s.buyer.id, s.orderId), "INVALID");
    expect(s.gw.captureCalls()).toHaveLength(0);
  });
});

describe("capture on acceptance", () => {
  it("the buyer's acceptance captures the held payment once, even if the seller also asks", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    // Recording other responses never captures.
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACKNOWLEDGE_RECEIPT", message: "", requirementKeys: [] });
    await expectCode(captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id), "INVALID");
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);

    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "Looks right", requirementKeys: [] });
    const r = await captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id);
    expect(r?.kind).toBe("COMPLETED");
    const again = await sellerCapture(db, s.gw, s.deal.id, s.seller.id);
    expect(again.kind).toBe("COMPLETED");
    expect(s.gw.holdCaptureCalls()).toHaveLength(1);
    const p = (await paymentSummary(db, s.deal.id)).latest!;
    expect(p).toMatchObject({ status: "COMPLETED", captureTrigger: "BUYER_ACCEPTED" });
    const events = await db.event.findMany({ where: { dealId: s.deal.id }, orderBy: { seq: "asc" } });
    const types = events.map((e) => e.type);
    expect(types.indexOf("BUYER_ACCEPT")).toBeLessThan(types.indexOf("PAYMENT_COMPLETED"));
    expect(events.find((e) => e.type === "PAYMENT_COMPLETED")!.summary).toMatch(/after the buyer accepted/);
    expect(verifyChain(events)).toBeNull();
  });

  it("only the buyer can accept-and-capture, and an outsider cannot touch the hold", async () => {
    const s = await heldDeal();
    const outsider = await makeUser("Mallory Outsider");
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    await expectCode(captureOnAcceptance(db, s.gw, s.deal.id, s.seller.id), "FORBIDDEN");
    await expectCode(captureOnAcceptance(db, s.gw, s.deal.id, outsider.id), "NOT_FOUND");
    await expectCode(sellerCapture(db, s.gw, s.deal.id, outsider.id), "NOT_FOUND");
    await expectCode(releaseHoldToBuyer(db, s.gw, s.deal.id, outsider.id, "x"), "NOT_FOUND");
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
  });

  it("a hold that PayPal reports expired at capture time is recorded and never shown as paid", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "", requirementKeys: [] });
    s.gw.captureAuthBehavior = "EXPIRED";
    await expectCode(captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id), "HOLD_ENDED");
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum.latest!.status).toBe("EXPIRED");
    expect(sum).toMatchObject({ isPaid: false, isHeld: false });
  });

  it("a PENDING capture of a hold is not shown as paid", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "", requirementKeys: [] });
    s.gw.captureAuthBehavior = "PENDING";
    expect((await captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id))?.kind).toBe("PENDING");
    expect((await paymentSummary(db, s.deal.id)).isPaid).toBe(false);
  });
});

describe("seller capture after the review window", () => {
  it("is refused before the window ends, while a requirement is not met, and while an objection is open; allowed after", async () => {
    const s = await heldDeal();
    // Missing SVG: not met.
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES.slice(0, 3) });
    await backdateDeliveries(s.deal.id, 6);
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET");
    // Complete delivery, but the window restarts with the new delivery.
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "SVG added", files: [ALL_FILES[3]!] });
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET");
    // Buyer objects; even after the window, the open objection blocks the seller.
    const objection = await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "REPORT_PROBLEM", message: "The colours are wrong", requirementKeys: ["D2"] });
    await backdateDeliveries(s.deal.id, 6);
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET");
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
    // Objection withdrawn, window passed, every check met: the seller may capture.
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "WITHDRAW_OBJECTION", message: "Fixed", requirementKeys: [], refersToId: objection.id });
    const r = await sellerCapture(db, s.gw, s.deal.id, s.seller.id);
    expect(r.kind).toBe("COMPLETED");
    const p = (await paymentSummary(db, s.deal.id)).latest!;
    expect(p.captureTrigger).toBe("SELLER_AFTER_REVIEW_WINDOW");
    const ev = await db.event.findMany({ where: { dealId: s.deal.id } });
    expect(ev.find((e) => e.type === "SELLER_REQUESTED_CAPTURE")!.kind).toBe("USER_DECLARATION");
    expect(ev.find((e) => e.type === "PAYMENT_COMPLETED")!.summary).toMatch(/review window/);
  });

  it("the buyer cannot use the seller's capture", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.buyer.id), "FORBIDDEN");
  });
});

describe("releasing the hold to the buyer", () => {
  it("the seller can cancel with a reason; nothing is captured and nothing can be captured afterwards", async () => {
    const s = await heldDeal();
    await expectCode(releaseHoldToBuyer(db, s.gw, s.deal.id, s.seller.id, ""), "INVALID");
    expect((await releaseHoldToBuyer(db, s.gw, s.deal.id, s.seller.id, "Client changed plans")).kind).toBe("VOIDED");
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum.latest!.status).toBe("VOIDED");
    expect(sum).toMatchObject({ isFunded: false, isPaid: false, isHeld: false });
    await expectCode(captureHold(db, s.gw, sum.latest!.id, { trigger: "BUYER_ACCEPTED", actorId: s.buyer.id }), "INVALID");
    await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES }), "NOT_APPROVED");
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
    const types = (await db.event.findMany({ where: { dealId: s.deal.id }, orderBy: { seq: "asc" } })).map((e) => e.type);
    expect(types.indexOf("SELLER_CANCELLED_JOB")).toBeLessThan(types.indexOf("PAYMENT_VOIDED"));
    const json = evidenceJson(await buildDealView(db, s.deal.id, s.buyer.id));
    expect(json.payment).toMatchObject({ flow: "hold_at_checkout_capture_on_acceptance", status: "VOIDED", captureId: null });
  });

  it("the buyer cannot release the hold before the deadline, or after a delivery", async () => {
    const s = await heldDeal(brief("2030-01-15"));
    await expectCode(releaseHoldToBuyer(db, s.gw, s.deal.id, s.buyer.id, ""), "NOT_ALLOWED_YET");
    const late = await heldDeal(brief("2020-01-15"));
    await submitDelivery(db, late.deal.id, late.seller.id, { note: "", files: ALL_FILES });
    await expectCode(releaseHoldToBuyer(db, late.gw, late.deal.id, late.buyer.id, ""), "NOT_ALLOWED_YET");
    expect((await paymentSummary(db, late.deal.id)).latest!.status).toBe("AUTHORIZED");
  });

  it("the buyer can release the hold when the agreed deadline passed with nothing delivered", async () => {
    const s = await heldDeal(brief("2020-01-15"));
    expect((await releaseHoldToBuyer(db, s.gw, s.deal.id, s.buyer.id, "Nothing arrived")).kind).toBe("VOIDED");
    expect((await paymentSummary(db, s.deal.id)).latest!.status).toBe("VOIDED");
    const ev = await db.event.findMany({ where: { dealId: s.deal.id, type: "BUYER_RELEASED_HOLD" } });
    expect(ev[0]!.summary).toMatch(/deadline .* passed with nothing delivered/);
  });
});

describe("authorization webhooks", () => {
  it("a signed CREATED webhook places the hold once; a late one after capture does not undo the capture", async () => {
    const s = await approvedDeal();
    const gw = new ScriptedGateway();
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
    gw.approve(orderId);
    // PayPal authorized, but our response was lost: the webhook is the only news.
    const order = await gw.authorizeOrder(orderId, "out-of-band");
    const auth = order.purchase_units![0]!.payments!.authorizations![0]!;
    const body = (id: string) => JSON.stringify({ id, event_type: "PAYMENT.AUTHORIZATION.CREATED", resource_type: "authorization", resource: auth });
    expect((await processVerifiedWebhook(db, body("WH-AUTH-1"), { verifyMethod: "FIXTURE", gateway: null })).status).toBe("APPLIED");
    expect((await processVerifiedWebhook(db, body("WH-AUTH-1"), { verifyMethod: "FIXTURE", gateway: null })).status).toBe("DUPLICATE");
    expect((await paymentSummary(db, s.deal.id)).latest!.status).toBe("AUTHORIZED");
    expect(await db.event.count({ where: { dealId: s.deal.id, type: "PAYMENT_AUTHORIZED" } })).toBe(1);

    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "", requirementKeys: [] });
    expect((await captureOnAcceptance(db, gw, s.deal.id, s.buyer.id))?.kind).toBe("COMPLETED");
    expect((await processVerifiedWebhook(db, body("WH-AUTH-2"), { verifyMethod: "FIXTURE", gateway: null })).status).toBe("APPLIED");
    expect((await paymentSummary(db, s.deal.id)).latest!.status).toBe("COMPLETED");
  });

  it("a VOIDED webhook releases the hold; authorization events for unknown holds are ignored", async () => {
    const s = await heldDeal();
    const p = (await paymentSummary(db, s.deal.id)).latest!;
    const voided = { id: p.authorizationId, status: "VOIDED", supplementary_data: { related_ids: { order_id: s.orderId } } };
    expect((await processVerifiedWebhook(db, JSON.stringify({ id: "WH-VOID-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: voided }), { verifyMethod: "FIXTURE", gateway: null })).status).toBe("APPLIED");
    expect((await paymentSummary(db, s.deal.id)).latest!.status).toBe("VOIDED");
    const unknown = await processVerifiedWebhook(db, JSON.stringify({ id: "WH-VOID-2", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "NOPE", status: "VOIDED" } }), { verifyMethod: "FIXTURE", gateway: null });
    expect(unknown.status).toBe("NO_MATCH");
  });
});
