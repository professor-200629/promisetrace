# Devpost draft — PromiseTrace

> Draft for the author's review. Add the YouTube link before submitting.
>
> Repository: https://github.com/professor-200629/promisetrace · Live demo: https://promisetrace-sandbox.vercel.app

## Tagline

Agree the work, let PayPal hold the payment, and release it when the delivery matches what was agreed — one requirement at a time.

## Inspiration

Independent designers and developers in India often agree a job with an overseas client in a chat thread, get paid through PayPal, and deliver files by link. When something goes wrong it is usually small and specific: the client expected an SVG, a second concept, or a deadline in their own timezone. Afterwards, nobody can easily show what was agreed, what was paid for, and what was actually delivered.

## What it does

PromiseTrace turns that thread into a shared, versioned brief and follows the job through payment and delivery:

1. **Paste the conversation.** Claude proposes a structured brief: deliverables, counts, file formats, price and currency, deadline with timezone, revision rounds, and clarification questions. Every value must quote the source. Our code checks that the quote exists and actually mentions the value; anything unsupported stays *unknown*.
2. **Both sides approve the same version.** The buyer joins by a private link. Editing before payment creates a new version and resets approvals.
3. **Pay with PayPal Checkout (sandbox) — held, not taken.** The order is created on the server from the approved version's price with intent AUTHORIZE, so PayPal holds the buyer's money. The agreement is funded (and locked) only when PayPal returns the authorization as CREATED with the right amount. The seller can start work knowing the money exists; the buyer knows it is not gone yet.
4. **Deliver and check.** Uploaded files are identified from their bytes. Code checks promised formats, counts and the deadline in the agreed timezone. In the demo the seller forgets the SVG; PromiseTrace flags "Final logo files: SVG — Not met" and links it to the sentence in the approved brief.
5. **Release the money on acceptance.** The buyer acknowledges, accepts, requests a revision or reports a problem — separately. **Accept captures the held payment** for the seller. If the buyer goes silent, the seller can capture after a 5-day review window, but only if code finds every check met and no objection open. The seller can cancel and release the hold; the buyer can release it if the deadline passes with nothing delivered. Objections stay visible until withdrawn.
6. **Keep the record.** A requirement-to-evidence table, a hash-chained history and an HTML/JSON export keep *agreed*, *observed* and *needs review* apart, and label every entry as recorded by PromiseTrace, confirmed by PayPal's API, stated by a person, or interpreted by AI.

## How we built it

- Next.js 16 (TypeScript), Prisma 7 with SQLite/libSQL, Better Auth, Zod, Tailwind.
- **PayPal**: Orders v2 create/get/**authorize** and Payments v2 **authorization capture / void / get** and capture get over REST from the server, `PayPal-Request-Id` on every POST (so a buyer acceptance and a seller capture racing each other produce one capture), the PayPal JavaScript SDK Buttons with `intent=authorize` for buyer approval, webhook self-verification (CRC32 + SHA-256 over the raw body, certificate host allowlist), deduplication by event id, `PAYMENT.AUTHORIZATION.*`, capture, refund/reversal and dispute notifications.
- **AI**: Claude via the official Anthropic SDK with structured outputs (Zod schema), low effort, token and daily caps, a server-side refusal fallback, and per-call token/cost/latency logging. Pasted text is treated as untrusted data.
- **Deterministic checks**: magic-byte file typing, SVG/PDF active-content scanning, IANA timezone deadline conversion, exact minor-unit money arithmetic.
- **Tests**: 57 Vitest tests for the failure cases (cross-user access, editing approved briefs, stale checkout versions, amount tampering, retries, invalid/duplicate webhooks, pending and expired holds, capture before the review window, capture while an objection is open, cancel and missed-deadline release, missing files) with a mock PayPal; a Playwright browser journey; five scripted scenarios; a synthetic extraction benchmark. Live sandbox runs on the hosted demo: hold placed (authorization CREATED) → buyer accepted → capture COMPLETED, re-verified through the PayPal API (authorization CAPTURED), with real signed `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.CAPTURE.COMPLETED` webhooks verified by the app (docs/VERIFICATION.md).

## Challenges

- Making AI output safe to show as "agreed": every claim must point to a passage that exists and contains the value, and people still approve it.
- Separating "the buyer clicked approve in PayPal" from "money was captured", and handling retries without double orders or captures.
- Never letting a pre-payment edit slip through: approvals are bound to a content hash, and a checkout created for an older version cannot be authorized or captured.
- Deciding who may release a hold without pretending to judge the work: the rules are deterministic (acceptance, review window with every check met and no objection, cancel, missed deadline), recorded as a person's statement first and PayPal's confirmation second. PayPal only guarantees held funds for 3 days, so a late capture can fail; the app records that instead of hiding it.

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

PromiseTrace never holds funds itself: the hold is a PayPal authorization, valid up to 29 days and honoured for 3; reauthorization is not built. It does not decide PayPal claims or guarantee Seller Protection (PayPal India's Seller Protection excludes "Significantly Not as Described" claims), and it is not an escrow service. Complaints recorded in the app are not PayPal disputes. File hashes show whether files changed, not whether the work is good. Indian sellers can receive only international payments through PayPal. The benchmark is synthetic; no customer results exist yet.

## Existing tools

Chargeflow assembles dispute evidence for SaaS and e-commerce from business data; Bonsai handles contracts, e-signature and deposits for freelancers. PromiseTrace is narrower: it checks each delivered file against each requirement of a brief both parties approved, for sellers using ordinary PayPal Checkout. We do not claim to be the only tool in this space.

## Built with

Claude (Anthropic API), PayPal Checkout / Orders v2 / Webhooks (sandbox), Next.js, TypeScript, Prisma, SQLite/libSQL, Better Auth, Zod, Tailwind CSS, Vitest, Playwright, Vercel, Turso.

## AI tools used

- Claude API (runtime extraction in the app).
- Claude Code (Claude Opus 5.5) to write most of the code, tests and docs, directed and reviewed by the author.

## Testing instructions

- Hosted demo: **https://promisetrace-sandbox.vercel.app** (PayPal sandbox + Claude live; fictional data). Demo accounts: `seller@demo.promisetrace.test` / `buyer@demo.promisetrace.test`, password `promisetrace-demo-2026` (fictional, test-only). To pay: in the PayPal window choose "Debit or Credit Card" and use PayPal's published sandbox test Visa 4012 8888 8888 1881, any future expiry, any CVV, any US billing details (no real money). PayPal sandbox buyer accounts also work. The payment is held; as the buyer, accept the delivery on the Delivery tab to capture it.
- Or run locally: see README (Node 20.19+, `npm install`, `npx prisma migrate deploy`, `npm run db:seed`, `npm run dev`).
