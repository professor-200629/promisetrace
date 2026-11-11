/**
 * The payment terms, written once. The landing page, the buyer invite, the
 * checkout, the About page and the docs all describe the same capture
 * conditions, and the server enforces them in hold-rules.ts.
 *
 * Timing wording follows PayPal's "Authorization and honor period" page
 * (developer.paypal.com/payment-methods/auth-honor/, checked 11 Nov 2026):
 * a 29-day authorization period, and a 3-day honor period in which capture
 * success rates are highest. Capture is not guaranteed in either.
 */
import { HONOR_SENTENCE, PAYPAL_HOLD_DAYS } from "@/lib/hold-rules";

export { HONOR_SENTENCE };

export function paymentTerms(reviewDays: number) {
  const review = `${reviewDays}-day review period`;
  return {
    /** One sentence for cards and invites. */
    short: `PayPal holds the payment at checkout. It is captured when the buyer accepts the delivery, or by the seller after a ${review} if code finds every agreed item met, nothing is flagged, no objection is open and nothing needs the buyer's confirmation.`,
    /** The full list shown to the buyer before they authorize. */
    conditions: [
      "Accepting the latest delivery captures the held payment for the seller.",
      `The seller can capture without your acceptance only after the ${review} that starts with the latest delivery, and only if code finds every agreed file format, count and the deadline met, no file is flagged, you have no open objection, and no agreed item needs your confirmation (items code cannot check).`,
      "An acceptance counts only for the delivery it follows. A new delivery needs a new acceptance.",
      "The seller can cancel and release the hold at any time. You can release it if the agreed deadline passes with nothing delivered.",
      `If nobody captures or releases it, PayPal's hold ends after ${PAYPAL_HOLD_DAYS} days and nothing is charged.`,
    ],
    /** Why seller capture is the less reliable path. */
    timing: `${HONOR_SENTENCE} The ${review} puts any seller capture after that window, so it can fail; PromiseTrace records a failed capture instead of hiding it. Prompt buyer acceptance is the most reliable path.`,
  };
}
