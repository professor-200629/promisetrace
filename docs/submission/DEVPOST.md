# Devpost draft — PromiseTrace

> Draft for the author's review. Items marked **[fill]** depend on runs that have not happened yet. Do not submit with placeholders.

## Tagline

Agree the work, pay through PayPal, and check delivery against what was agreed — one requirement at a time.

## Inspiration

Independent designers and developers in India often agree a job with an overseas client in a chat thread, get paid through PayPal, and deliver files by link. When something goes wrong it is usually small and specific: the client expected an SVG, a second concept, or a deadline in their own timezone. Afterwards, nobody can easily show what was agreed, what was paid for, and what was actually delivered.

## What it does

PromiseTrace turns that thread into a shared, versioned brief and follows the job through payment and delivery:

1. **Paste the conversation.** Claude proposes a structured brief: deliverables, counts, file formats, price and currency, deadline with timezone, revision rounds, and clarification questions. Every value must quote the source. Our code checks that the quote exists and actually mentions the value; anything unsupported stays *unknown*.
2. **Both sides approve the same version.** The buyer joins by a private link. Editing before payment creates a new version and resets approvals.
3. **Pay with PayPal Checkout (sandbox).** Orders are created and captured on the server from the approved version's price. Approval in the PayPal window is not payment: only a capture PayPal returns as COMPLETED with the right amount, currency, custom_id and invoice_id marks it paid. Pending, declined, refunded and reversed states are shown as such.
4. **Deliver and check.** Uploaded files are identified from their bytes. Code checks promised formats, counts and the deadline in the agreed timezone. In the demo the seller forgets the SVG; PromiseTrace flags "Final logo files: SVG — Not met" and links it to the sentence in the approved brief.
5. **Respond and keep the record.** The buyer acknowledges, accepts, requests a revision or reports a problem — separately. Objections stay visible until withdrawn. A requirement-to-evidence table, a hash-chained history and an HTML/JSON export keep *agreed*, *observed* and *needs review* apart, and label every entry as recorded by PromiseTrace, confirmed by PayPal's API, stated by a person, or interpreted by AI.

## How we built it

- Next.js 16 (TypeScript), Prisma 7 with SQLite/libSQL, Better Auth, Zod, Tailwind.
- **PayPal**: Orders v2 create/get/capture and Payments v2 get-capture over REST from the server, `PayPal-Request-Id` on every POST for idempotent retries, the PayPal JavaScript SDK Buttons for buyer approval, webhook self-verification (CRC32 + SHA-256 over the raw body, certificate host allowlist), deduplication by event id, and refund/reversal/dispute notifications.
- **AI**: Claude via the official Anthropic SDK with structured outputs (Zod schema), low effort, token and daily caps, a server-side refusal fallback, and per-call token/cost/latency logging. Pasted text is treated as untrusted data.
- **Deterministic checks**: magic-byte file typing, SVG/PDF active-content scanning, IANA timezone deadline conversion, exact minor-unit money arithmetic.
- **Tests**: 32 Vitest tests for the failure cases (cross-user access, editing approved briefs, stale checkout versions, amount/currency tampering, capture retries, invalid/duplicate webhooks, pending capture, missing files) with a mock PayPal; a Playwright browser journey; four scripted scenarios; a synthetic extraction benchmark. Live sandbox runs: **[fill from docs/VERIFICATION.md]**.

## Challenges

- Making AI output safe to show as "agreed": every claim must point to a passage that exists and contains the value, and people still approve it.
- Separating "the buyer clicked approve in PayPal" from "money was captured", and handling retries without double orders or captures.
- Never letting a pre-payment edit slip through: approvals are bound to a content hash, and a checkout created for an older version cannot be captured.

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

PromiseTrace does not hold funds, release holds, decide PayPal claims or guarantee Seller Protection (PayPal India's Seller Protection excludes "Significantly Not as Described" claims). Complaints recorded in the app are not PayPal disputes. File hashes show whether files changed, not whether the work is good. Indian sellers can receive only international payments through PayPal. The benchmark is synthetic; no customer results exist yet.

## Existing tools

Chargeflow assembles dispute evidence for SaaS and e-commerce from business data; Bonsai handles contracts, e-signature and deposits for freelancers. PromiseTrace is narrower: it checks each delivered file against each requirement of a brief both parties approved, for sellers using ordinary PayPal Checkout. We do not claim to be the only tool in this space.

## Built with

Claude (Anthropic API), PayPal Checkout / Orders v2 / Webhooks (sandbox), Next.js, TypeScript, Prisma, SQLite/libSQL, Better Auth, Zod, Tailwind CSS, Vitest, Playwright, Render [if hosted].

## AI tools used

- Claude API (runtime extraction in the app).
- Claude Code (Claude Opus 5.5) to write most of the code, tests and docs, directed and reviewed by the author.

## Testing instructions

- Hosted demo: **[fill URL]** (may take about a minute to wake). Demo accounts: `seller@demo.promisetrace.test` / `buyer@demo.promisetrace.test`, password `promisetrace-demo-2026` (fictional, test-only). PayPal sandbox buyer: **[fill sandbox personal account email + password — sandbox test account only]**.
- Or run locally: see README (Node 20.19+, `npm install`, `npx prisma migrate deploy`, `npm run db:seed`, `npm run dev`).
