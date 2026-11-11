# Devpost draft — PromiseTrace

> Text for the Devpost submission, 11 Nov 2026. Paste each section into the matching Devpost field.
>
> Repository: https://github.com/professor-200629/promisetrace · Live demo: https://promisetrace-sandbox.vercel.app · Video: https://youtu.be/wKefoWY4dLE

## For judges: try it in five minutes

- **Hosted demo:** https://promisetrace-sandbox.vercel.app (PayPal sandbox and Claude live, fictional data, no real money).
- **Logins (fictional, test-only):** seller `seller@demo.promisetrace.test`, buyer `buyer@demo.promisetrace.test`, password `promisetrace-demo-2026` for both. Use two windows, one private. The accounts are shared by all testers; for a clean space, sign up two accounts of your own.
- **Test card:** in the PayPal window choose *Debit or Credit Card*: Mastercard 5555 5555 5555 4444, any future expiry, any CVV, any US billing details. If the sandbox declines it, try Visa 4012 8888 8888 1881 or a PayPal sandbox Personal account.
- **Files to upload:** https://github.com/professor-200629/promisetrace/tree/main/demo-files (two concept PNGs, a final PNG, a final SVG; fictional).

**Seller:** New agreement → *Use the fictional logo example* → *Create and propose brief* (Claude proposes it; every value links to its source sentence) → copy the invite link → *Approve version 1*. After the buyer pays: upload the two concepts and only the final PNG → PromiseTrace shows **Final logo files: SVG — Not met**. After the buyer reports it: upload the SVG as a second delivery.

**Buyer:** open the invite link → *Join this agreement as the buyer* → *Approve version 1* → **Payment**: read the payment terms above the PayPal buttons, then pay with the test card (PayPal holds the money; nothing is captured) → **Delivery**: *Report a problem* about D2 → after the corrected delivery, *Accept* → *Accept and capture the held 300.00 USD* → withdraw the objection → the agreement reads **Complete** → **View evidence record**.

**Payment terms (as shown in the app):** PayPal holds the payment at checkout. It is captured when the buyer accepts the delivery, or by the seller after a 5-day review period if code finds every agreed item met, nothing is flagged, no objection is open and nothing needs the buyer's confirmation. PayPal capture is most likely to succeed within the first three days of authorization; the 5-day review period puts any seller capture after that window, so it can fail, and the app records a failure instead of hiding it.

## Tagline

Agree the work, let PayPal hold the payment, and release it when the delivery matches what was agreed — one requirement at a time.

## Inspiration

Independent designers and developers in India often agree a job with an overseas client in a chat thread, get paid through PayPal, and deliver files by link. When something goes wrong it is usually small and specific: the client expected an SVG, a second concept, or a deadline in their own timezone. Afterwards, nobody can easily show what was agreed, what was paid for, and what was actually delivered.

## What it does

PromiseTrace turns that thread into a shared, versioned brief and follows the job through payment and delivery:

1. **Paste the conversation.** Claude proposes a structured brief: deliverables, counts, file formats, price and currency, deadline with timezone, revision rounds, and clarification questions. Every value must quote the source. Our code checks that the quote exists and actually mentions the value; anything unsupported stays *unknown*.
2. **Both sides approve the same version.** The buyer joins by a private link. Editing before payment creates a new version and resets approvals.
3. **Pay with PayPal Checkout (sandbox) — held, not taken.** The order is created on the server from the approved version's price with intent AUTHORIZE, so PayPal holds the buyer's money. The agreement is funded (and locked) only when PayPal returns the authorization as CREATED with the right amount. The money is reserved before work starts (PayPal keeps a hold for up to 29 days), and the buyer knows it is not gone yet. Before paying, the buyer sees the review period and exactly when the seller could capture without them.
4. **Deliver and check.** Uploaded files are identified from their bytes. Code checks promised formats, counts and the deadline in the agreed timezone. In the demo the seller forgets the SVG; PromiseTrace flags "Final logo files: SVG — Not met" and links it to the sentence in the approved brief.
5. **Release the money on acceptance.** The buyer acknowledges, accepts, requests a revision or reports a problem — separately. **Accepting the latest delivery captures the held payment** for the seller. If the buyer goes silent, the seller can capture after a 5-day review period, but only if code finds every agreed format, count and the deadline met, no file is flagged, no objection is open, and no agreed item needs the buyer's confirmation (things code cannot check, such as an Illustrator file, can only be confirmed by the buyer). The seller can cancel and release the hold; the buyer can release it if the deadline passes with nothing delivered. Objections stay visible until withdrawn. When PayPal confirms the capture, the buyer has accepted and no objection is open, the agreement reads **Complete**, with a link to the evidence record.
6. **Keep the record.** A requirement-to-evidence table, a hash-chained history and an HTML/JSON export keep *agreed*, *observed* and *needs review* apart, and label every entry as recorded by PromiseTrace, confirmed by PayPal's API, stated by a person, or interpreted by AI.

## How we built it

- Next.js 16 (TypeScript), Prisma 7 with SQLite/libSQL, Better Auth, Zod, Tailwind.
- **PayPal**: Orders v2 create/get/**authorize** and Payments v2 **authorization capture / void / get** and capture get over REST from the server, `PayPal-Request-Id` on every POST (so a buyer acceptance and a seller capture racing each other produce one capture), the PayPal JavaScript SDK Buttons with `intent=authorize` for buyer approval, webhook self-verification (CRC32 + SHA-256 over the raw body, certificate host allowlist), deduplication by event id, `PAYMENT.AUTHORIZATION.*`, capture, refund/reversal and dispute notifications.
- **AI**: Claude via the official Anthropic SDK with structured outputs (Zod schema), low effort, token and daily caps, a server-side refusal fallback, and per-call token/cost/latency logging. Pasted text is treated as untrusted data.
- **Deterministic checks**: magic-byte file typing, SVG/PDF active-content scanning, IANA timezone deadline conversion, exact minor-unit money arithmetic.
- **Tests**: 77 Vitest tests for the failure cases (agreed items only the buyer can confirm, cross-user access, editing approved briefs, stale checkout versions, amount tampering, retries, invalid/duplicate webhooks, pending and expired holds, capture before the review window, capture while an objection is open or a file is flagged, cancel and missed-deadline release, delete while held, account-takeover endpoints, AI budget, upload size, missing files) with a mock PayPal; a Playwright browser journey; five scripted scenarios; a synthetic extraction benchmark. Live PayPal Sandbox runs on the hosted demo (Vercel + Turso; docs/VERIFICATION.md 5b, 5d, 5e): on 8 Nov, live Claude extraction and a capture at checkout, COMPLETED; on 10 Nov, a hold (authorization CREATED) → missing SVG flagged and the seller's capture refused → SVG added → buyer accepted → capture COMPLETED, re-verified through the PayPal API (authorization CAPTURED); and on 10 Nov, a hold → seller cancelled → authorization VOIDED, nothing captured. In those hosted runs the app verified real signed `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED` and `PAYMENT.CAPTURE.COMPLETED` webhooks. On 11 Nov the final code passed a **local production run with live Claude and PayPal Sandbox** (fresh database; webhooks cannot reach localhost, so PayPal's API responses were used): live Claude extraction → hold → missing SVG flagged and the seller's capture refused → corrected delivery → buyer accepted → capture COMPLETED, re-verified through the PayPal API → **Complete** (docs/VERIFICATION.md 5f). After deploying that code, the same journey passed on the **hosted demo**: live Claude extraction, PayPal Sandbox authorization, missing SVG flagged and the seller's capture refused, corrected delivery, buyer acceptance, capture COMPLETED (re-verified through the PayPal API, authorization CAPTURED), three signed webhooks verified, **Complete**, and a working evidence-record link (docs/VERIFICATION.md 5g).

## Challenges

- Making AI output safe to show as "agreed": every claim must point to a passage that exists and contains the value, and people still approve it.
- Separating "the buyer clicked approve in PayPal" from "money was captured", and handling retries without double orders or captures.
- Never letting a pre-payment edit slip through: approvals are bound to a content hash, and a checkout created for an older version cannot be authorized or captured.
- Deciding who may release a hold without pretending to judge the work: the rules are deterministic (acceptance, review window with every check met and no objection, cancel, missed deadline), recorded as a person's statement first and PayPal's confirmation second. PayPal capture is most likely to succeed within the first three days of authorization, and the 5-day review period puts a seller capture after that window, so a late capture can fail; the app records that instead of hiding it.

## Accomplishments

- A complete path from pasted conversation to an exportable, source-linked record, with each step checked by code or confirmed by PayPal.
- Honest labelling throughout: fixture modes are marked, AI interpretations are marked, and the app never claims PayPal protection.

## What we learned

PayPal's capture status, reconciliation fields and webhooks give enough to build a trustworthy record — as long as the app never treats the buyer's click, a screenshot or a download as proof.

## What's next

- Interviews with five overseas-paid sellers (script ready, not yet done).
- PayPal partner onboarding so each seller is paid into their own account (this build is single-merchant).
- PDF briefs, more languages, and scope-change suggestions.

## Limits (stated plainly)

- **Single merchant.** In this sandbox build every capture goes to the one PayPal merchant account the demo is configured with, not to each seller. Paying each seller directly needs PayPal's multiparty (platform) onboarding; collecting money for many sellers from one account is not allowed by PayPal's policies and, in India, would need an RBI payment-aggregator licence. A real version would make each freelancer the payee and only tell PayPal when to capture or void.
- **Holds are short.** A PayPal authorization lasts up to 29 days, and PayPal capture is most likely to succeed within the first three days of authorization; reauthorization is not built. The app warns before checkout when the deadline plus the review window would outlast the hold, and treats a hold past its expiry as over.
- **The rules are deterministic, not a judge.** An open objection (which must name a requirement) blocks the seller's own capture until the buyer withdraws it or accepts; there is no neutral referee, and an unresolved objection ends when the hold expires. File checks cover format, count, integrity and deadline — not quality or style.
- **No emails, no password reset** in this build; the demo uses shared fictional accounts.
- PromiseTrace never holds funds itself and is not an escrow service. It does not decide PayPal claims or guarantee Seller Protection (PayPal India's Seller Protection excludes "Significantly Not as Described" claims). Complaints recorded in the app are not PayPal disputes. The hash chain shows whether entries were altered, not that a statement is true; it is not signed or externally timestamped yet.
- The benchmark is synthetic (10 fictional English briefs); no customer results or interviews exist yet.

## Existing tools

Chargeflow assembles dispute evidence for SaaS and e-commerce from business data; Bonsai handles contracts, e-signature and deposits for freelancers. PromiseTrace is narrower: it checks each delivered file against each requirement of a brief both parties approved, for sellers using ordinary PayPal Checkout. We do not claim to be the only tool in this space.

## Built with

Claude (Anthropic API), PayPal Checkout / Orders v2 / Webhooks (sandbox), Next.js, TypeScript, Prisma, SQLite/libSQL, Better Auth, Zod, Tailwind CSS, Vitest, Playwright, Vercel, Turso.

## AI tools used

- Claude API (runtime extraction in the app).
- Claude Code (Claude Opus 5.5) to write most of the code, tests and docs, directed and reviewed by the author, and to record and edit the demo video.
- ElevenLabs (AI voice) for the demo video's voice-over. The screen footage is a real recording of the hosted sandbox app (Playwright), not generated.

## Testing instructions

- Hosted demo: **https://promisetrace-sandbox.vercel.app** (PayPal sandbox + Claude live; fictional data). Demo accounts: `seller@demo.promisetrace.test` / `buyer@demo.promisetrace.test`, password `promisetrace-demo-2026` (fictional, test-only). To pay: in the PayPal window choose "Debit or Credit Card" and use a PayPal-published sandbox test card, any future expiry, any CVV, any US billing details (no real money). We use Mastercard 5555 5555 5555 4444; on 11 Nov the sandbox started declining the heavily reused test Visa 4012 8888 8888 1881 for this merchant, so if one test card is declined, try the other. PayPal sandbox buyer accounts also work. The payment is held; as the buyer, accept the delivery on the Delivery tab to capture it, or as the seller cancel on the Payment tab to release it. The two demo accounts are shared by everyone, so you may see other testers' agreements; for a clean space, create your own accounts on the sign-up page. Account-changing endpoints are disabled, AI extraction is capped per account per day, and one delivery can be at most 4 MB.
- The steps above ("For judges") walk through the whole journey.
- Or run locally: see README (Node 20.19+, `npm install`, `npx prisma migrate deploy`, `npm run db:seed`, `npm run dev`).
