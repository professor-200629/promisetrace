/** Fictional demonstration data. Names, business and messages are invented. */
export const DEMO_CONVERSATION = `From: Alex Rivera (Northwind Coffee, Portland, USA)
To: Priya Nair (independent designer, Bengaluru)
Date: 6 November 2026

Hi Priya, thanks for the call today. To confirm what we agreed:

- The price is $300 USD for the full logo package, paid through PayPal.
- You will send two logo concepts as PNG images by November 12, 2026.
- After I pick one, you deliver the final logo files in PNG and SVG formats.
- The package includes two revision rounds.
- Final files are due by November 20, 2026 at 5 PM New York time.

Could you also suggest a colour palette? Not sure yet if that is part of the package.

Thanks,
Alex`;

const DAY = 86_400_000;
const us = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const uk = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "America/New_York" });

/**
 * The same fictional conversation with dates relative to today (concepts in
 * 4 days, final files in 9), so the "Use the fictional logo example" button
 * always produces a deadline in the future and well inside PayPal's 29-day hold.
 */
export function demoConversation(now: Date = new Date()): string {
  return DEMO_CONVERSATION
    .replace("Date: 6 November 2026", `Date: ${uk(now)}`)
    .replace("by November 12, 2026.", `by ${us(new Date(now.getTime() + 4 * DAY))}.`)
    .replace("due by November 20, 2026 at 5 PM", `due by ${us(new Date(now.getTime() + 9 * DAY))} at 5 PM`);
}
