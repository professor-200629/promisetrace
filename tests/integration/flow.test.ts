/**
 * Service-level tests against a real SQLite database and a MOCK PayPal
 * gateway (ScriptedGateway). These do not contact PayPal; the live sandbox
 * run is recorded separately in docs/VERIFICATION.md.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeUser, logoBrief, LOGO_BRIEF, ScriptedGateway, PNG_BYTES, SVG_BYTES, EVIL_SVG_BYTES } from "../helpers";
import { canonicalJson } from "@/lib/hash";
import { createDeal, acceptInvite, approveVersion, saveEdit, startAmendment, hashContent, parseContent, versionState, proposeInitialBrief } from "@/lib/services/briefs";
import { createCheckout, capturePayment, paymentSummary } from "@/lib/services/payments";
import { submitDelivery, readFileForUser } from "@/lib/services/delivery";
import { recordBuyerAction } from "@/lib/services/buyer";
import { buildDealView, evidenceJson } from "@/lib/services/evidence";
import { processVerifiedWebhook } from "@/lib/services/webhooks";
import { verifyChain } from "@/lib/services/events";
import { AppError } from "@/lib/errors";
import type { BriefContent } from "@/lib/brief";

/** These tests cover capture-at-checkout; the default hold flow is tested in holds.test.ts. */
const CAP = { intent: "CAPTURE" as const };

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

async function setup(content: BriefContent = logoBrief()) {
  const seller = await makeUser("Priya Seller");
  const buyer = await makeUser("Alex Buyer");
  const outsider = await makeUser("Mallory Outsider");
  const { deal, inviteToken } = await createDeal(db, seller.id, { title: "Northwind Coffee logo package", sourceTitle: "Email thread", sourceKind: "CONVERSATION", sourceText: LOGO_BRIEF });
  await acceptInvite(db, inviteToken, buyer.id);
  const v1 = await db.briefVersion.create({ data: { dealId: deal.id, number: 1, kind: "ORIGINAL", origin: "MANUAL", content: canonicalJson(content), contentHash: hashContent(content), createdById: seller.id } });
  return { seller, buyer, outsider, deal, v1, inviteToken };
}

async function approveBoth(s: Awaited<ReturnType<typeof setup>>) {
  const st = await versionState(db, s.deal.id);
  await approveVersion(db, s.deal.id, s.seller.id, st.working!.id, st.working!.contentHash);
  await approveVersion(db, s.deal.id, s.buyer.id, st.working!.id, st.working!.contentHash);
}

async function paidDeal(gw = new ScriptedGateway()) {
  const s = await setup();
  await approveBoth(s);
  const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
  gw.approve(orderId);
  const r = await capturePayment(db, gw, s.deal.id, s.buyer.id, orderId);
  expect(r.kind).toBe("COMPLETED");
  return { ...s, gw, orderId };
}

describe("access control", () => {
  it("an unrelated user cannot read, approve, pay for or download from someone else's agreement", async () => {
    const s = await paidDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [{ deliverableKey: "D2", name: "logo.png", bytes: PNG_BYTES }] });
    const file = await db.deliveryFile.findFirstOrThrow({ where: { delivery: { dealId: s.deal.id } } });
    await expectCode(buildDealView(db, s.deal.id, s.outsider.id), "NOT_FOUND");
    await expectCode(readFileForUser(db, file.id, s.outsider.id), "NOT_FOUND");
    await expectCode(approveVersion(db, s.deal.id, s.outsider.id, s.v1.id, s.v1.contentHash), "NOT_FOUND");
    await expectCode(createCheckout(db, s.gw, s.deal.id, s.outsider.id, CAP), "NOT_FOUND");
    await expectCode(capturePayment(db, s.gw, s.deal.id, s.outsider.id, s.orderId), "NOT_FOUND");
    await expectCode(recordBuyerAction(db, s.deal.id, s.outsider.id, { type: "ACCEPT", message: "", requirementKeys: [] }), "NOT_FOUND");
    // participants can
    expect((await readFileForUser(db, file.id, s.buyer.id)).id).toBe(file.id);
  });

  it("roles are enforced: the seller cannot pay and the buyer cannot deliver", async () => {
    const s = await setup();
    await approveBoth(s);
    await expectCode(createCheckout(db, new ScriptedGateway(), s.deal.id, s.seller.id, CAP), "FORBIDDEN");
    const p = await paidDeal();
    await expectCode(submitDelivery(db, p.deal.id, p.buyer.id, { note: "", files: [{ deliverableKey: "D2", name: "x.png", bytes: PNG_BYTES }] }), "FORBIDDEN");
  });

  it("an invite link is single-use and the seller cannot join as their own buyer", async () => {
    const seller = await makeUser("S");
    const { inviteToken, deal } = await createDeal(db, seller.id, { title: "T", sourceTitle: "x", sourceKind: "PASTED_BRIEF", sourceText: LOGO_BRIEF });
    await expectCode(acceptInvite(db, inviteToken, seller.id), "FORBIDDEN");
    const b = await makeUser("B");
    expect(await acceptInvite(db, inviteToken, b.id)).toBe(deal.id);
    const c = await makeUser("C");
    await expectCode(acceptInvite(db, inviteToken, c.id), "NOT_FOUND");
  });
});

describe("two-party approval and versions", () => {
  it("checkout needs both approvals of the same version", async () => {
    const s = await setup();
    const gw = new ScriptedGateway();
    await approveVersion(db, s.deal.id, s.seller.id, s.v1.id, s.v1.contentHash);
    await expectCode(createCheckout(db, gw, s.deal.id, s.buyer.id, CAP), "NOT_APPROVED");
    expect(gw.calls).toHaveLength(0);
  });

  it("editing an approved brief creates a new version and prior approvals stop counting", async () => {
    const s = await setup();
    await approveBoth(s);
    expect((await versionState(db, s.deal.id)).workingApproved).toBe(true);
    const edited = logoBrief();
    edited.revisionRounds.count = 3;
    const v2 = await saveEdit(db, s.deal.id, s.buyer.id, s.v1.id, edited);
    const st = await versionState(db, s.deal.id);
    expect(st.working!.id).toBe(v2.id);
    expect(st.workingApproved).toBe(false);
    expect(parseContent(v2).revisionRounds.status).toBe("edited");
    expect(parseContent(v2).revisionRounds.editedBy).toBe("BUYER");
    // approving the old version is refused
    await expectCode(approveVersion(db, s.deal.id, s.seller.id, s.v1.id, s.v1.contentHash), "STALE_VERSION");
    // approving with a hash the user did not see is refused
    await expectCode(approveVersion(db, s.deal.id, s.seller.id, v2.id, s.v1.contentHash), "STALE_VERSION");
    const events = await db.event.findMany({ where: { dealId: s.deal.id } });
    expect(events.map((e) => e.type)).toContain("APPROVALS_INVALIDATED");
  });

  it("a paid version cannot be edited; changes go through an amendment that both approve", async () => {
    const s = await paidDeal();
    const st = await versionState(db, s.deal.id);
    const edited = logoBrief();
    edited.deadline.date = "2026-11-25";
    await expectCode(saveEdit(db, s.deal.id, s.seller.id, st.working!.id, edited), "LOCKED");
    const am = await startAmendment(db, s.deal.id, s.buyer.id);
    const v3 = await saveEdit(db, s.deal.id, s.buyer.id, am.id, edited);
    const priceChange = logoBrief();
    priceChange.price.amountMinor = 35000;
    await expectCode(saveEdit(db, s.deal.id, s.buyer.id, v3.id, priceChange), "INVALID");
    await approveVersion(db, s.deal.id, s.buyer.id, v3.id, v3.contentHash);
    expect((await versionState(db, s.deal.id)).effective!.id).toBe(s.v1.id); // not yet agreed
    await approveVersion(db, s.deal.id, s.seller.id, v3.id, v3.contentHash);
    const after = await versionState(db, s.deal.id);
    expect(after.effective!.id).toBe(v3.id);
    expect(after.paid!.id).toBe(s.v1.id);
    expect(parseContent(after.paid!).deadline.date).toBe("2026-11-20"); // the paid record is unchanged
  });
});

describe("payment", () => {
  it("repeated checkout clicks reuse one PayPal order", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    const a = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    const b = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    expect(b.orderId).toBe(a.orderId);
    expect(gw.orders.size).toBe(1);
  });

  it("price and currency come from the approved brief, and a PayPal order with a different amount is rejected", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    gw.orderAmountOverride = { currency_code: "USD", value: "1.00" };
    await expectCode(createCheckout(db, gw, s.deal.id, s.buyer.id, CAP), "AMOUNT_MISMATCH");
    const s2 = await setup();
    await approveBoth(s2);
    const gw2 = new ScriptedGateway();
    gw2.orderAmountOverride = { currency_code: "EUR", value: "300.00" };
    await expectCode(createCheckout(db, gw2, s2.deal.id, s2.buyer.id, CAP), "AMOUNT_MISMATCH");
    expect((await paymentSummary(db, s2.deal.id)).isPaid).toBe(false);
  });

  it("a capture whose amount differs from the agreement is not marked paid", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    gw.behavior = "TAMPER_CAPTURE_AMOUNT";
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    gw.approve(orderId);
    await expectCode(capturePayment(db, gw, s.deal.id, s.buyer.id, orderId), "AMOUNT_MISMATCH");
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum.isPaid).toBe(false);
    expect(sum.latest!.status).toBe("MISMATCH");
    expect((await versionState(db, s.deal.id)).paid).toBeNull();
  });

  it("refuses to capture a checkout created for a version that was edited afterwards", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    gw.approve(orderId);
    const edited = logoBrief();
    edited.revisionRounds.count = 1;
    await saveEdit(db, s.deal.id, s.seller.id, s.v1.id, edited);
    await expectCode(capturePayment(db, gw, s.deal.id, s.buyer.id, orderId), "STALE_VERSION");
    expect(gw.captureCalls()).toHaveLength(0);
  });

  it("buyer approval at PayPal is not payment: an unapproved order is not captured", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    const r = await capturePayment(db, gw, s.deal.id, s.buyer.id, orderId);
    expect(r.kind).toBe("NOT_APPROVED");
    expect(gw.captureCalls()).toHaveLength(0);
  });

  it("capture retries are idempotent and a lost capture response is reconciled from PayPal", async () => {
    const s = await paidDeal();
    const again = await capturePayment(db, s.gw, s.deal.id, s.buyer.id, s.orderId);
    expect(again.kind).toBe("COMPLETED");
    expect(s.gw.captureCalls()).toHaveLength(1);

    // Timeout after PayPal captured: the retry hits ORDER_ALREADY_CAPTURED and reconciles via GET.
    const t = await setup();
    await approveBoth(t);
    const gw = new ScriptedGateway();
    gw.behavior = "ALREADY_CAPTURED_AFTER";
    const { orderId } = await createCheckout(db, gw, t.deal.id, t.buyer.id, CAP);
    gw.approve(orderId);
    await expectCode(capturePayment(db, gw, t.deal.id, t.buyer.id, orderId), "PAYPAL_ERROR");
    expect((await paymentSummary(db, t.deal.id)).isPaid).toBe(false);
    const retry = await capturePayment(db, gw, t.deal.id, t.buyer.id, orderId);
    expect(retry.kind).toBe("COMPLETED");
    const caps = gw.captureCalls();
    expect(new Set(caps.map((c) => c.split(":")[2])).size).toBe(1); // same PayPal-Request-Id every time
  });

  it("a PENDING capture is not paid, blocks delivery, and completes only after PayPal says so", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    gw.behavior = "PENDING";
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    gw.approve(orderId);
    const r = await capturePayment(db, gw, s.deal.id, s.buyer.id, orderId);
    expect(r).toEqual({ kind: "PENDING", reason: "PENDING_REVIEW" });
    expect((await paymentSummary(db, s.deal.id)).isPaid).toBe(false);
    await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [{ deliverableKey: "D2", name: "a.png", bytes: PNG_BYTES }] }), "NOT_APPROVED");
    await expectCode(createCheckout(db, gw, s.deal.id, s.buyer.id, CAP), "PAYMENT_PENDING");

    const pay = (await paymentSummary(db, s.deal.id)).latest!;
    const capture = { id: pay.captureId, status: "COMPLETED", amount: { currency_code: "USD", value: "300.00" }, custom_id: pay.customId, invoice_id: pay.invoiceId, supplementary_data: { related_ids: { order_id: orderId } } };
    const out = await processVerifiedWebhook(db, JSON.stringify({ id: "WH-PENDING-DONE-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource_type: "capture", resource: capture }), { verifyMethod: "FIXTURE", gateway: null });
    expect(out.status).toBe("APPLIED");
    expect((await paymentSummary(db, s.deal.id)).isPaid).toBe(true);
    expect((await versionState(db, s.deal.id)).paid?.id).toBe(s.v1.id);
  });

  it("a declined funding source lets the buyer try again without marking anything paid", async () => {
    const s = await setup();
    await approveBoth(s);
    const gw = new ScriptedGateway();
    gw.behavior = "INSTRUMENT_DECLINED";
    const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id, CAP);
    gw.approve(orderId);
    expect((await capturePayment(db, gw, s.deal.id, s.buyer.id, orderId)).kind).toBe("INSTRUMENT_DECLINED");
    expect((await paymentSummary(db, s.deal.id)).isPaid).toBe(false);
  });
});

describe("webhooks", () => {
  it("a redelivered event is applied once", async () => {
    const s = await paidDeal();
    const pay = (await paymentSummary(db, s.deal.id)).latest!;
    const body = JSON.stringify({ id: "WH-REFUND-1", event_type: "PAYMENT.CAPTURE.REFUNDED", resource_type: "refund", resource: { id: "REFUND1", status: "COMPLETED", links: [{ rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${pay.captureId}` }] } });
    expect((await processVerifiedWebhook(db, body, { verifyMethod: "FIXTURE", gateway: null })).status).toBe("APPLIED");
    expect((await processVerifiedWebhook(db, body, { verifyMethod: "FIXTURE", gateway: null })).status).toBe("DUPLICATE");
    const events = await db.event.findMany({ where: { dealId: s.deal.id, type: "PAYMENT_REFUNDED" } });
    expect(events).toHaveLength(1);
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum.isPaid).toBe(false);
    expect(sum.latest!.status).toBe("REFUNDED");
  });

  it("a reversal is not silently treated as paid and events for unknown captures are ignored", async () => {
    const s = await paidDeal();
    const pay = (await paymentSummary(db, s.deal.id)).latest!;
    await processVerifiedWebhook(db, JSON.stringify({ id: "WH-REV-1", event_type: "PAYMENT.CAPTURE.REVERSED", resource: { id: "R1", links: [{ rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${pay.captureId}` }] } }), { verifyMethod: "FIXTURE", gateway: null });
    expect((await paymentSummary(db, s.deal.id)).latest!.status).toBe("REVERSED");
    const unknown = await processVerifiedWebhook(db, JSON.stringify({ id: "WH-UNKNOWN-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "NOPE", status: "COMPLETED" } }), { verifyMethod: "FIXTURE", gateway: null });
    expect(unknown.status).toBe("NO_MATCH");
  });
});

describe("delivery checks", () => {
  it("flags the missing SVG against the approved brief, then passes once it arrives", async () => {
    const s = await paidDeal();
    const d1 = await submitDelivery(db, s.deal.id, s.seller.id, { note: "Final logo attached", files: [
      { deliverableKey: "D1", name: "concept-a.png", bytes: PNG_BYTES },
      { deliverableKey: "D1", name: "concept-b.png", bytes: PNG_BYTES },
      { deliverableKey: "D2", name: "northwind-final.png", bytes: PNG_BYTES },
    ] });
    const svg1 = d1.checks.find((c) => c.requirementKey === "D2:svg")!;
    expect(svg1.result).toBe("FAIL");
    expect(svg1.refs[0]!.quote).toContain("PNG and SVG");
    expect(d1.checks.find((c) => c.requirementKey === "D2:png")!.result).toBe("PASS");
    expect(d1.checks.find((c) => c.requirementKey === "D1:png")!.result).toBe("PASS");

    const view = await buildDealView(db, s.deal.id, s.buyer.id);
    expect(view.rows.find((r) => r.key === "D2:svg")!.result).toBe("NOT_MET");
    expect(view.summary.needsReview).toBeGreaterThan(0);

    const d2 = await submitDelivery(db, s.deal.id, s.seller.id, { note: "Adding the SVG", files: [{ deliverableKey: "D2", name: "northwind-final.svg", bytes: SVG_BYTES }] });
    expect(d2.checks.find((c) => c.requirementKey === "D2:svg")!.result).toBe("PASS");
  });

  it("detects file type from content: a PNG renamed .svg does not satisfy the SVG requirement; unsafe SVG is flagged", async () => {
    const s = await paidDeal();
    const r = await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [
      { deliverableKey: "D2", name: "logo.svg", bytes: PNG_BYTES },
      { deliverableKey: "D2", name: "logo2.svg", bytes: EVIL_SVG_BYTES },
    ] });
    const integrity = r.checks.find((c) => c.requirementKey === "D2:integrity")!;
    expect(integrity.result).toBe("NEEDS_REVIEW");
    expect(integrity.observed).toMatch(/content is PNG/);
    expect(integrity.observed).toMatch(/script/i);
    await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [{ deliverableKey: "D2", name: "notes.txt", bytes: new TextEncoder().encode("hello world") }] }), "INVALID");
  });
});

describe("buyer responses and the record", () => {
  it("keeps acknowledgement, acceptance and objections distinct; objections stay visible until withdrawn", async () => {
    const s = await paidDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [{ deliverableKey: "D2", name: "f.png", bytes: PNG_BYTES }] });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACKNOWLEDGE_RECEIPT", message: "", requirementKeys: [] });
    const objection = await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "REPORT_PROBLEM", message: "The SVG file is missing", requirementKeys: ["D2"] });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "Concepts look good", requirementKeys: ["D1"] });
    let view = await buildDealView(db, s.deal.id, s.seller.id);
    expect(view.openObjections).toContain(objection.id);
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "WITHDRAW_OBJECTION", message: "SVG received", requirementKeys: ["D2"], refersToId: objection.id });
    view = await buildDealView(db, s.deal.id, s.seller.id);
    expect(view.openObjections).toHaveLength(0);
    expect(view.buyerActions.map((a) => a.type)).toEqual(["ACKNOWLEDGE_RECEIPT", "REPORT_PROBLEM", "ACCEPT", "WITHDRAW_OBJECTION"]);
  });

  it("exports a record whose every requirement has a valid source passage and whose hash chain verifies", async () => {
    const s = await paidDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [{ deliverableKey: "D2", name: "f.png", bytes: PNG_BYTES }] });
    const view = await buildDealView(db, s.deal.id, s.buyer.id);
    expect(view.invalidRefs).toBe(0);
    expect(view.chainBrokenAt).toBeNull();
    const json = evidenceJson(view);
    expect(json.history.hashChainIntact).toBe(true);
    expect(JSON.stringify(json)).not.toMatch(/@example\.test/); // no emails in exports
    expect(JSON.stringify(json)).not.toContain("TESTPAYER123"); // no raw PayPal payer id
    for (const r of json.requirements.filter((x) => x.agreedStatus === "sourced")) expect(r.sourcePassages.length).toBeGreaterThan(0);

    // tampering with any stored event breaks the chain
    const ev = await db.event.findFirstOrThrow({ where: { dealId: s.deal.id, type: "PAYMENT_COMPLETED" } });
    await db.event.update({ where: { id: ev.id }, data: { summary: ev.summary.replace("300.00", "30.00") } });
    expect(verifyChain(await db.event.findMany({ where: { dealId: s.deal.id } }))).toBe(ev.seq);
  });
});

describe("extraction path (fixture provider, no network)", () => {
  it("creates version 1 from the source with verified references and records an AI run", async () => {
    const seller = await makeUser("Seller X");
    const { deal } = await createDeal(db, seller.id, { title: "Logo", sourceTitle: "Email", sourceKind: "CONVERSATION", sourceText: LOGO_BRIEF });
    const out = await proposeInitialBrief(db, deal.id, seller.id);
    expect(out.status).toBe("OK");
    expect(out.provider).toBe("fixture");
    const v = await db.briefVersion.findFirstOrThrow({ where: { dealId: deal.id } });
    const c = parseContent(v);
    expect(c.price.amountMinor).toBe(30000);
    for (const r of [...c.price.refs, ...c.deliverables.flatMap((d) => d.refs)]) expect(LOGO_BRIEF.slice(r.start, r.end)).toBe(r.quote);
    expect(await db.aiRun.count({ where: { dealId: deal.id } })).toBe(1);
  });
});

beforeEach(() => {
  /* each test creates its own users and deals; the database is reset per run in global-setup */
});
