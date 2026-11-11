/**
 * One plain-language status for an agreement, shared by the deal page and the
 * exported evidence record so they never disagree. Pure and deterministic.
 *
 * "Complete" needs all three: PayPal confirmed the capture (COMPLETED), the
 * buyer accepted the current (latest) delivery, and no objection is open.
 * Fixture payments are labelled as simulated everywhere.
 */

export type AgreementStatusKey =
  | "COMPLETE"
  | "CAPTURE_PENDING"
  | "ACCEPTED_NOT_CAPTURED"
  | "OBJECTION_OPEN"
  | "CHECKS_UNRESOLVED"
  | "BUYER_TO_CONFIRM"
  | "AWAITING_BUYER_REVIEW"
  | "PAID_WITHOUT_ACCEPTANCE"
  | "AWAITING_DELIVERY"
  | "HOLD_PENDING"
  | "AWAITING_PAYMENT"
  | "HOLD_RELEASED"
  | "HOLD_EXPIRED"
  | "REFUNDED_OR_REVERSED"
  | "NOT_FUNDED";

export type AgreementStatus = {
  key: AgreementStatusKey;
  label: string;
  detail: string;
  tone: "agreed" | "observed" | "review" | "bad" | "neutral";
  /** True when the payment is a FIXTURE simulation, not a PayPal transaction. */
  simulated: boolean;
};

export type AgreementStatusInputs = {
  payment: { status: string; intent: string; mode: string; captureTrigger: string | null } | null;
  isPaid: boolean;
  isHeld: boolean;
  holdExpired: boolean;
  approvedByBoth: boolean;
  latestDeliveryNumber: number | null;
  /** The buyer accepted the latest delivery (an acceptance of an earlier delivery does not count). */
  buyerAcceptedLatest: boolean;
  openObjectionCount: number;
  /** Agreed deliverables or the agreed deadline that are not met or flagged for review. */
  unresolvedCheckCount: number;
  /** Agreed deliverables only the buyer can confirm. */
  buyerConfirmCount: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function agreementStatus(i: AgreementStatusInputs): AgreementStatus {
  const p = i.payment;
  const simulated = p?.mode === "FIXTURE";
  const sim = simulated ? " (FIXTURE, simulated: not a PayPal transaction)" : "";
  const s = (key: AgreementStatusKey, label: string, detail: string, tone: AgreementStatus["tone"]): AgreementStatus => ({ key, label: simulated ? `${label} · FIXTURE` : label, detail, tone, simulated });

  if (p?.status === "CAPTURE_PENDING") {
    return s("CAPTURE_PENDING", "Capture pending at PayPal", `PayPal has not completed the capture yet, so this is not counted as paid. PromiseTrace updates when PayPal confirms it${sim}.`, "review");
  }
  const funded = i.isPaid || i.isHeld;
  if (!funded) {
    if (p?.status === "VOIDED") return s("HOLD_RELEASED", "Closed: hold released", `The hold was released to the buyer and nothing was charged${sim}.`, "neutral");
    if (p?.status === "EXPIRED" || i.holdExpired) return s("HOLD_EXPIRED", "Hold expired", `PayPal's hold expired before it was captured; nothing was charged${sim}.`, "bad");
    if (p?.status === "AUTHORIZATION_PENDING") return s("HOLD_PENDING", "Hold pending at PayPal", "PayPal has not confirmed the hold yet. Work should not start until it does.", "review");
    if (p && ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(p.status)) return s("REFUNDED_OR_REVERSED", `Payment ${p.status.replace(/_/g, " ").toLowerCase()}`, `PayPal reports this payment as ${p.status.replace(/_/g, " ").toLowerCase()}${sim}.`, "bad");
    if (i.approvedByBoth) return s("AWAITING_PAYMENT", "Awaiting payment", "Both sides approved the brief. The buyer pays next; PayPal holds the money and nothing is captured at checkout.", "neutral");
    return s("NOT_FUNDED", "Brief not approved yet", "Both sides must approve the same version of the brief before the buyer can pay.", "neutral");
  }

  const holdWord = i.isPaid ? "Paid" : "Payment held";
  if (i.latestDeliveryNumber === null) {
    return s("AWAITING_DELIVERY", `${holdWord}, awaiting delivery`, i.isPaid ? `PayPal captured the payment${sim}. Waiting for the seller's delivery.` : `PayPal holds the buyer's payment; nothing is captured yet${sim}. Waiting for the seller's delivery.`, "observed");
  }
  const n = i.latestDeliveryNumber;
  if (i.isPaid && i.buyerAcceptedLatest && i.openObjectionCount === 0) {
    const caveat = i.unresolvedCheckCount > 0 ? ` The buyer accepted with ${plural(i.unresolvedCheckCount, "check")} still flagged; the record keeps ${i.unresolvedCheckCount === 1 ? "it" : "them"} visible.` : "";
    return s("COMPLETE", "Complete", `Payment captured${simulated ? " (FIXTURE, simulated: not a PayPal transaction)" : " and confirmed by PayPal"}, the buyer accepted delivery ${n}, and no objection is open.${caveat}`, "agreed");
  }
  if (i.openObjectionCount > 0) {
    return s("OBJECTION_OPEN", `Objection open (${i.openObjectionCount})`, `The buyer has ${plural(i.openObjectionCount, "open objection")}. ${i.isHeld ? "The seller cannot capture the held payment until it is withdrawn or the buyer accepts." : "It stays in the record until the buyer withdraws it."}`, "review");
  }
  if (i.isHeld && i.buyerAcceptedLatest) {
    return s("ACCEPTED_NOT_CAPTURED", "Accepted, capture not confirmed", `The buyer accepted delivery ${n}, but PayPal has not confirmed a capture yet. The seller can retry it on the Payment tab.`, "review");
  }
  if (i.unresolvedCheckCount > 0) {
    return s("CHECKS_UNRESOLVED", `Delivery checks unresolved (${i.unresolvedCheckCount})`, `${plural(i.unresolvedCheckCount, "agreed item")} ${i.unresolvedCheckCount === 1 ? "is" : "are"} not met or flagged in delivery ${n}. ${i.isHeld ? "Only the buyer's acceptance can capture the held payment while this is so." : "The buyer has not accepted."}`, "review");
  }
  if (i.isPaid) {
    const why = p?.captureTrigger === "SELLER_AFTER_REVIEW_WINDOW" ? "The seller captured after the review window with every check met; the buyer did not respond." : "The buyer has not accepted the latest delivery.";
    return s("PAID_WITHOUT_ACCEPTANCE", "Paid, not accepted by the buyer", `${why}${sim}`, "observed");
  }
  if (i.buyerConfirmCount > 0) {
    return s("BUYER_TO_CONFIRM", `Buyer to confirm (${i.buyerConfirmCount})`, `Code cannot check ${plural(i.buyerConfirmCount, "agreed item")} in delivery ${n}. Only the buyer's acceptance can capture the held payment.`, "review");
  }
  return s("AWAITING_BUYER_REVIEW", "Awaiting the buyer's review", `Every checkable item in delivery ${n} is present. The held payment is captured when the buyer accepts.`, "observed");
}
