import { describe, expect, it } from "vitest";
import { agreementStatus, type AgreementStatusInputs } from "@/lib/agreement-status";

const paid = { status: "COMPLETED", intent: "AUTHORIZE", mode: "SANDBOX", captureTrigger: "BUYER_ACCEPTED" };
const held = { status: "AUTHORIZED", intent: "AUTHORIZE", mode: "SANDBOX", captureTrigger: null };

function inputs(over: Partial<AgreementStatusInputs> = {}): AgreementStatusInputs {
  return { payment: paid, isPaid: true, isHeld: false, holdExpired: false, approvedByBoth: true, latestDeliveryNumber: 2, buyerAcceptedLatest: true, openObjectionCount: 0, unresolvedCheckCount: 0, buyerConfirmCount: 0, ...over };
}

describe("agreement status", () => {
  it("is Complete only when PayPal confirmed the capture, the buyer accepted the latest delivery and no objection is open", () => {
    expect(agreementStatus(inputs())).toMatchObject({ key: "COMPLETE", label: "Complete", tone: "agreed", simulated: false });
    expect(agreementStatus(inputs({ buyerAcceptedLatest: false })).key).not.toBe("COMPLETE");
    expect(agreementStatus(inputs({ openObjectionCount: 1 })).label).toBe("Objection open (1)");
    expect(agreementStatus(inputs({ payment: { ...paid, status: "CAPTURE_PENDING" }, isPaid: false })).label).toBe("Capture pending at PayPal");
  });

  it("keeps a flagged check visible after the buyer accepts", () => {
    const s = agreementStatus(inputs({ unresolvedCheckCount: 1 }));
    expect(s.key).toBe("COMPLETE");
    expect(s.detail).toMatch(/1 check still flagged/);
  });

  it("labels fixture payments as simulated", () => {
    const s = agreementStatus(inputs({ payment: { ...paid, mode: "FIXTURE" } }));
    expect(s).toMatchObject({ key: "COMPLETE", label: "Complete · FIXTURE", simulated: true });
    expect(s.detail).toMatch(/not a PayPal transaction/);
  });

  it("names what is still open while the payment is held", () => {
    const h = { payment: held, isPaid: false, isHeld: true, buyerAcceptedLatest: false };
    expect(agreementStatus(inputs({ ...h, unresolvedCheckCount: 2 })).label).toBe("Delivery checks unresolved (2)");
    expect(agreementStatus(inputs({ ...h, buyerConfirmCount: 1 })).label).toBe("Buyer to confirm (1)");
    expect(agreementStatus(inputs({ ...h })).key).toBe("AWAITING_BUYER_REVIEW");
    expect(agreementStatus(inputs({ ...h, buyerAcceptedLatest: true })).label).toBe("Accepted, capture not confirmed");
    expect(agreementStatus(inputs({ ...h, latestDeliveryNumber: null })).label).toBe("Payment held, awaiting delivery");
  });

  it("says when the seller was paid without the buyer's acceptance", () => {
    const s = agreementStatus(inputs({ payment: { ...paid, captureTrigger: "SELLER_AFTER_REVIEW_WINDOW" }, buyerAcceptedLatest: false }));
    expect(s.label).toBe("Paid, not accepted by the buyer");
    expect(s.detail).toMatch(/did not respond/);
  });

  it("covers released, expired and unpaid agreements", () => {
    const none = { isPaid: false, isHeld: false };
    expect(agreementStatus(inputs({ ...none, payment: { ...held, status: "VOIDED" } })).label).toBe("Closed: hold released");
    expect(agreementStatus(inputs({ ...none, payment: held, holdExpired: true })).label).toBe("Hold expired");
    expect(agreementStatus(inputs({ ...none, payment: null })).label).toBe("Awaiting payment");
    expect(agreementStatus(inputs({ ...none, payment: null, approvedByBoth: false })).label).toBe("Brief not approved yet");
  });
});
