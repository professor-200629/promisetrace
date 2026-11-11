/**
 * Who may capture or release a payment that PayPal holds for an agreement.
 * Pure and deterministic: the UI shows these answers and the server enforces
 * the same ones. No AI is involved.
 *
 *  - Buyer accepts the latest delivery            -> the held payment is captured.
 *  - Seller, review window passed, every check met
 *    and no open buyer objection                  -> the seller may capture.
 *  - Seller cancels the job (any time while held) -> the hold is released to the buyer.
 *  - Buyer, the agreed deadline passed with
 *    nothing delivered                            -> the buyer may release the hold.
 *  - Otherwise the hold stays until one of these happens or PayPal's
 *    authorization expires (29 days), when the money returns to the buyer.
 *  - Seller capture always comes after the review window, which is longer than
 *    PayPal's 3-day honor period, so it can fail; failures are recorded.
 */

/** PayPal's honor period: the first 3 days of an authorization, when capture success rates are highest (not a guarantee). */
export const PAYPAL_HONOR_DAYS = 3;
export const HONOR_SENTENCE = "PayPal capture is most likely to succeed within the first three days of authorization.";
const DAY = 86_400_000;

export type HoldInputs = {
  payment: { status: string; intent: string; authorizedAt: Date | null; authorizationExpiresAt: Date | null } | null;
  deliveries: Array<{ number: number; submittedAt: Date }>;
  buyerActions: Array<{ type: string; createdAt: Date }>;
  openObjectionCount: number;
  /** Agreed deliverables (or the agreed deadline) the delivered files do not meet, or that code flagged for review. */
  flaggedCount: number;
  /**
   * Agreed deliverables code cannot check (e.g. formats it cannot identify, or items with no file
   * format or count). Only the buyer can confirm these, so the seller can never capture on silence
   * while any exist. Optional fields the parties never agreed on (no deadline, no revision count)
   * are not counted.
   */
  buyerConfirmCount: number;
  deadlineUtc: Date | null;
  reviewWindowDays: number;
  now: Date;
};

export type Permission = { allowed: boolean; reason: string };

export type HoldState = {
  held: boolean;
  expiresAt: Date | null;
  honorEndsAt: Date | null;
  expired: boolean;
  reviewEndsAt: Date | null;
  buyerAccepted: boolean;
  sellerCapture: Permission;
  sellerVoid: Permission;
  buyerVoid: Permission;
};

const iso = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const no = (reason: string): Permission => ({ allowed: false, reason });
const yes = (reason: string): Permission => ({ allowed: true, reason });

export function holdState(i: HoldInputs): HoldState {
  const p = i.payment;
  const authorized = !!p && p.intent === "AUTHORIZE" && p.status === "AUTHORIZED";
  const expiresAt = p?.authorizationExpiresAt ?? null;
  const honorEndsAt = p?.authorizedAt ? new Date(p.authorizedAt.getTime() + PAYPAL_HONOR_DAYS * DAY) : null;
  // Past PayPal's expiry time the hold is gone even if no webhook told us yet: nothing can be captured or released.
  const expired = authorized && !!expiresAt && i.now.getTime() >= expiresAt.getTime();
  const held = authorized && !expired;
  const ended = expired ? no(`PayPal's hold expired on ${iso(expiresAt!)}. Nothing was captured, and nothing can be captured or released now.`) : null;
  const latest = i.deliveries.at(-1) ?? null;
  const reviewEndsAt = latest ? new Date(latest.submittedAt.getTime() + i.reviewWindowDays * DAY) : null;
  const buyerAccepted = !!latest && i.buyerActions.some((a) => a.type === "ACCEPT" && a.createdAt.getTime() >= latest.submittedAt.getTime());

  let sellerCapture: Permission;
  if (ended) sellerCapture = ended;
  else if (!held) sellerCapture = no("No payment is held for this agreement.");
  else if (!latest) sellerCapture = no("Submit a delivery first.");
  else if (buyerAccepted) sellerCapture = yes(`The buyer accepted delivery ${latest.number}.`);
  else if (i.openObjectionCount > 0) sellerCapture = no(`The buyer has ${i.openObjectionCount} open objection${i.openObjectionCount === 1 ? "" : "s"}. Resolve ${i.openObjectionCount === 1 ? "it" : "them"} with the buyer first.`);
  else if (i.flaggedCount > 0) sellerCapture = no(`${i.flaggedCount} requirement${i.flaggedCount === 1 ? " is" : "s are"} not met or flagged for review. Only the buyer's acceptance can capture now.`);
  else if (i.buyerConfirmCount > 0) sellerCapture = no(`${i.buyerConfirmCount} agreed item${i.buyerConfirmCount === 1 ? "" : "s"} can only be confirmed by the buyer (code cannot check ${i.buyerConfirmCount === 1 ? "it" : "them"}). Only the buyer's acceptance of delivery ${latest.number} can capture.`);
  else if (i.now.getTime() < reviewEndsAt!.getTime()) sellerCapture = no(`The buyer has until ${iso(reviewEndsAt!)} to review delivery ${latest.number}. After that, with every check met and no objection, you can capture.`);
  else sellerCapture = yes(`The ${i.reviewWindowDays}-day review window for delivery ${latest.number} passed with every check met and no open objection.`);

  const sellerVoid = ended ?? (held ? yes("Cancel the job and release the hold to the buyer. Nothing is captured.") : no("No payment is held for this agreement."));

  let buyerVoid: Permission;
  if (ended) buyerVoid = ended;
  else if (!held) buyerVoid = no("No payment is held for this agreement.");
  else if (latest) buyerVoid = no("A delivery was submitted. Respond to it instead (accept, request a revision or report a problem).");
  else if (!i.deadlineUtc) buyerVoid = no("No deadline was agreed, so only the seller can release the hold before PayPal's expiry.");
  else if (i.now.getTime() < i.deadlineUtc.getTime()) buyerVoid = no(`Available after the agreed deadline (${iso(i.deadlineUtc)}) if nothing has been delivered by then.`);
  else buyerVoid = yes(`The agreed deadline (${iso(i.deadlineUtc)}) passed with nothing delivered.`);

  return { held, expiresAt, honorEndsAt, expired, reviewEndsAt, buyerAccepted, sellerCapture, sellerVoid, buyerVoid };
}

/** PayPal keeps a hold for 29 days. Warn before checkout when the deadline plus the review window would outlast it. */
export const PAYPAL_HOLD_DAYS = 29;
export function holdLengthWarning(deadlineUtc: Date | null, now: Date, reviewWindowDays: number): string | null {
  if (!deadlineUtc) return `No deadline is agreed. PayPal keeps a hold for at most ${PAYPAL_HOLD_DAYS} days. ${HONOR_SENTENCE}`;
  const reviewEnd = new Date(deadlineUtc.getTime() + reviewWindowDays * DAY);
  const holdEnd = new Date(now.getTime() + PAYPAL_HOLD_DAYS * DAY);
  if (reviewEnd.getTime() <= holdEnd.getTime()) return null;
  return `The deadline (${iso(deadlineUtc)}) plus the ${reviewWindowDays}-day review ends after PayPal's ${PAYPAL_HOLD_DAYS}-day hold limit (${iso(holdEnd)}). The hold may expire before it is captured; agree an earlier deadline or split the job.`;
}
