/**
 * Hardening added on 10 Nov 2026 after the weakness audit: demo lockdown,
 * delete protection, per-account AI budget, expired holds, fairer objection
 * and capture rules, delivery size cap. Real SQLite, MOCK PayPal; no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, makeUser, logoBrief, LOGO_BRIEF, ScriptedGateway, PNG_BYTES, SVG_BYTES } from "../helpers";
import { canonicalJson } from "@/lib/hash";
import { createDeal, acceptInvite, approveVersion, hashContent } from "@/lib/services/briefs";
import { authorizePayment, createCheckout, paymentSummary } from "@/lib/services/payments";
import { captureOnAcceptance, releaseHoldToBuyer, sellerCapture } from "@/lib/services/hold";
import { deleteDeal } from "@/lib/services/deals";
import { submitDelivery } from "@/lib/services/delivery";
import { recordBuyerAction } from "@/lib/services/buyer";
import { proposeBrief } from "@/lib/ai/extract";
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

function brief(deadlineDate = "2030-01-15"): BriefContent {
  const b = logoBrief();
  b.deadline = { ...b.deadline, date: deadlineDate };
  return b;
}

async function approvedDeal(content: BriefContent = brief()) {
  const seller = await makeUser("Priya Seller");
  const buyer = await makeUser("Alex Buyer");
  const { deal, inviteToken } = await createDeal(db, seller.id, { title: "Logo package", sourceTitle: "Email", sourceKind: "CONVERSATION", sourceText: LOGO_BRIEF });
  await acceptInvite(db, inviteToken, buyer.id);
  const v1 = await db.briefVersion.create({ data: { dealId: deal.id, number: 1, kind: "ORIGINAL", origin: "MANUAL", content: canonicalJson(content), contentHash: hashContent(content), createdById: seller.id } });
  await approveVersion(db, deal.id, seller.id, v1.id, v1.contentHash);
  await approveVersion(db, deal.id, buyer.id, v1.id, v1.contentHash);
  return { seller, buyer, deal };
}

async function heldDeal(content?: BriefContent) {
  const s = await approvedDeal(content);
  const gw = new ScriptedGateway();
  const { orderId } = await createCheckout(db, gw, s.deal.id, s.buyer.id);
  gw.approve(orderId);
  expect((await authorizePayment(db, gw, s.deal.id, s.buyer.id, orderId)).kind).toBe("AUTHORIZED");
  return { ...s, gw };
}

const ALL_FILES = [
  { deliverableKey: "D1", name: "concept-a.png", bytes: PNG_BYTES },
  { deliverableKey: "D1", name: "concept-b.png", bytes: PNG_BYTES },
  { deliverableKey: "D2", name: "final.png", bytes: PNG_BYTES },
  { deliverableKey: "D2", name: "final.svg", bytes: SVG_BYTES },
];

async function backdateDeliveries(dealId: string, days: number) {
  for (const d of await db.delivery.findMany({ where: { dealId } })) {
    await db.delivery.update({ where: { id: d.id }, data: { submittedAt: new Date(d.submittedAt.getTime() - days * 86_400_000) } });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo lockdown", () => {
  it("the auth API serves only sign-in, sign-up, sign-out and session; account-changing endpoints return 404", async () => {
    const { GET, POST } = await import("@/app/api/auth/[...all]/route");
    for (const path of ["change-password", "update-user", "change-email", "delete-user", "revoke-sessions", "revoke-other-sessions", "request-password-reset", "reset-password"]) {
      const r = await POST(new Request(`http://localhost:3000/api/auth/${path}`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
      expect(r.status, path).toBe(404);
    }
    expect((await GET(new Request("http://localhost:3000/api/auth/list-sessions"))).status).toBe(404);
  });

  it("an agreement whose payment PayPal holds or captured cannot be deleted; an unpaid one can", async () => {
    const s = await heldDeal();
    await expectCode(deleteDeal(db, s.deal.id, s.seller.id), "LOCKED", /hold on/);
    await expectCode(deleteDeal(db, s.deal.id, s.buyer.id), "FORBIDDEN");
    const outsider = await makeUser("Mallory");
    await expectCode(deleteDeal(db, s.deal.id, outsider.id), "NOT_FOUND");
    expect(await db.deal.findUnique({ where: { id: s.deal.id } })).not.toBeNull();
    const unpaid = await approvedDeal();
    await deleteDeal(db, unpaid.deal.id, unpaid.seller.id);
    expect(await db.deal.findUnique({ where: { id: unpaid.deal.id } })).toBeNull();
  });

  it("one account cannot use the whole day's AI budget", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-never-sent");
    vi.stubEnv("AI_DAILY_CALL_LIMIT_PER_USER", "3");
    const s = await approvedDeal();
    for (let i = 0; i < 3; i++) {
      await db.aiRun.create({ data: { dealId: s.deal.id, purpose: "EXTRACT_BRIEF", provider: "anthropic", model: "claude-opus-5-5", status: "OK", validation: "{}" } });
    }
    const out = await proposeBrief(db, { dealId: s.deal.id, title: "x", sources: [{ label: "S1", title: "Email", text: LOGO_BRIEF }] });
    expect(out.status).toBe("BUDGET_BLOCKED");
    expect(out.error).toMatch(/account's daily AI limit/);
  });
});

describe("expired holds", () => {
  it("past PayPal's expiry time a hold is not funded: no delivery, no capture, no release, and accepting says so", async () => {
    const s = await heldDeal();
    const p = (await paymentSummary(db, s.deal.id)).latest!;
    await db.payment.update({ where: { id: p.id }, data: { authorizationExpiresAt: new Date(Date.now() - 60_000) } });
    const sum = await paymentSummary(db, s.deal.id);
    expect(sum).toMatchObject({ isHeld: false, isFunded: false, holdExpired: true });
    await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES }), "NOT_APPROVED", /expired/);
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET", /expired/);
    await expectCode(releaseHoldToBuyer(db, s.gw, s.deal.id, s.seller.id, "Cancelling now"), "NOT_ALLOWED_YET", /expired/);
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
  });

  it("accepting after the hold expired reports it instead of silently recording nothing", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    const p = (await paymentSummary(db, s.deal.id)).latest!;
    await db.payment.update({ where: { id: p.id }, data: { authorizationExpiresAt: new Date(Date.now() - 60_000) } });
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "", requirementKeys: [] });
    await expectCode(captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id), "HOLD_ENDED", /expired/);
  });
});

describe("fairer rules", () => {
  it("an objection must name an agreed requirement", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES });
    await expectCode(recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "REPORT_PROBLEM", message: "I just do not like it", requirementKeys: [] }), "INVALID", /which agreed requirement/);
    await expectCode(recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "REQUEST_REVISION", message: "Change it please", requirementKeys: ["not-a-key"] }), "INVALID");
    const ok = await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "REPORT_PROBLEM", message: "SVG colours are off", requirementKeys: ["D2"] });
    expect(ok.type).toBe("REPORT_PROBLEM");
  });

  it("a file flagged for review (content does not match its name) blocks the seller's own capture after the window", async () => {
    const s = await heldDeal();
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: [...ALL_FILES, { deliverableKey: "D2", name: "extra.svg", bytes: PNG_BYTES }] });
    await backdateDeliveries(s.deal.id, 6);
    await expectCode(sellerCapture(db, s.gw, s.deal.id, s.seller.id), "NOT_ALLOWED_YET", /flagged for review/);
    expect(s.gw.holdCaptureCalls()).toHaveLength(0);
    // The buyer can still accept knowingly.
    await recordBuyerAction(db, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "Fine as is", requirementKeys: [] });
    expect((await captureOnAcceptance(db, s.gw, s.deal.id, s.buyer.id))?.kind).toBe("COMPLETED");
  });
});

describe("delivery size", () => {
  it("one delivery's total size is capped so it fits the host's request limit", async () => {
    vi.stubEnv("MAX_DELIVERY_BYTES", "100");
    const s = await heldDeal();
    await expectCode(submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES }), "INVALID", /at most .* MB in total/);
    // Under the cap it is accepted.
    await submitDelivery(db, s.deal.id, s.seller.id, { note: "", files: ALL_FILES.slice(0, 2) });
  });
});
