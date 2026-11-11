# Demo video script — 2:29 (must stay under 3:00)

Published: https://youtu.be/-Rp3hlbv-DA (public, 11 Nov 2026). Footage: the hosted journey of 11 Nov (docs/VERIFICATION.md 5g).

The video is a real recording of the app, not generated footage. `scripts/demo-video/record.mjs` drives two browser contexts (**Seller Priya** and **Buyer Alex**, the fictional seeded demo accounts) through one live journey: real Claude extraction, PayPal **sandbox** authorization and capture with PayPal's published test Mastercard, and the files in `demo-files/`. `scripts/demo-video/cards.mjs` renders the title and closing cards. The voice-over is ElevenLabs (AI voice); captions are burned in. No music, and no PayPal logos beyond what PayPal's own sandbox window shows.

The video centres on four moments: **the missing SVG**, **the corrected delivery**, **the buyer's acceptance**, and **the exported evidence record**.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:14 | Title card → landing page | "Priya designs logos in Bengaluru. Alex runs a coffee shop in Portland. They agreed a three hundred dollar logo job by email. PromiseTrace makes the payment follow what they agreed." |
| 0:14–0:29 | Seller: New agreement → fictional example → Create; Claude's brief with source chips; Sources tab | "Priya pastes the email. Claude proposes the brief, and every value must quote the email: two PNG concepts, and final files in PNG and SVG. Anything it can't quote stays unknown." |
| 0:29–0:45 | Invite link → buyer joins → both approve version 1 → buyer's **Payment terms** card above the PayPal buttons | "Alex joins by a private link, and both approve the same version. Before paying, Alex sees the terms. Accepting captures the money. Priya can only capture it alone after a five-day review, with nothing missing, flagged or open." |
| 0:45–0:59 | PayPal sandbox card form → "PayPal holds 300.00 USD" → payment record (authorization CREATED) | "Alex pays with PayPal. The order is created on the server from the approved price, with intent authorize, so PayPal holds three hundred dollars instead of taking it. Nothing is captured yet." |
| 0:59–1:15 | **Seller delivers concepts + final PNG, no SVG** → *Final logo files: SVG — Not met* → source chip | "Priya delivers the concepts and the final PNG, but forgets the SVG. Code, not AI, reads the file bytes. Final logo files, SVG: not met, linked to the exact sentence in the brief." |
| 1:15–1:23 | Seller's Payment tab: status *Delivery checks unresolved (1)*, capture blocked | "While the SVG is missing, Priya cannot capture the money herself. Only Alex's acceptance can." |
| 1:23–1:31 | Buyer reports the problem against D2 → **seller uploads the SVG as delivery 2** | "Alex reports the problem against that requirement. Priya adds the SVG, and every checkable item is now met." |
| 1:31–1:41 | **Buyer accepts** → "PayPal captured the held payment" → payment record COMPLETED | "Alex accepts the corrected delivery, and that is what releases the money. PayPal captures the hold, and the capture comes back completed." |
| 1:41–1:49 | Buyer withdraws the objection → **Complete** banner → *View evidence record* | "Alex withdraws the objection. Captured, accepted, nothing open: the agreement now reads Complete." |
| 1:49–2:09 | **Exported evidence record** (HTML), scrolled: status, PayPal IDs, requirements with source quotes, deliveries with hashes, history | "The evidence record shows the agreed brief with its source quotes, both deliveries with file hashes, PayPal's order, hold and capture IDs, and a hash-chained history. Every entry says who stands behind it: PromiseTrace, PayPal's API, a person, or AI." |
| 2:09–2:29 | Limits card | "This is a sandbox, single-merchant build. Holds last up to twenty-nine days, and PayPal capture is most likely to succeed within the first three days of authorization. The checks cover format, count and deadline, not taste. PromiseTrace: payment that follows the promise." |

## Re-recording

1. `npm run build`, then start a live server on a fresh throwaway database: `node scripts/live-server.mjs` (port 3300, `live-check.db`, needs PayPal sandbox and Anthropic credentials in `.env`).
2. `DEMO_BASE=http://localhost:3300 node scripts/demo-video/record.mjs <outDir>` records both people and writes `marks.json`.
3. `node scripts/demo-video/cards.mjs <outDir>` renders the cards; the edit trims each scene to its `marks.json` times and fits it to its narration line.
