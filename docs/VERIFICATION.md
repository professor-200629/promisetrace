# Verification record

Everything here was run on the author's Windows 11 laptop (Node 24.14). "Mock" means the PayPal API was replaced by a scripted stand-in (`tests/helpers.ts → ScriptedGateway`) or the labelled FIXTURE gateway. **Mocked tests are not evidence that the live PayPal integration works.** Live runs are listed separately below.

## 1. Static checks and build — 8 Nov 2026

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | pass, 0 errors |
| Lint | `npm run lint` | pass, 0 errors, 0 warnings |
| Production build | `npm run build` | pass (Next.js 16.4.5, Turbopack), 17 routes |

## 2. Automated tests (mock PayPal, real SQLite) — 8 Nov 2026

`npm test` → **32 passed, 0 failed** (2 files, about 5 s).

Failure cases the brief asked for, and where they are tested (`tests/integration/flow.test.ts`, `tests/unit/core.test.ts`):

| Failure case | Test | Kind |
|---|---|---|
| Unauthorized cross-user access (read, approve, pay, capture, respond, download) | `access control › an unrelated user cannot…` | service + real DB |
| Roles (seller cannot pay, buyer cannot deliver); single-use invite; seller cannot be own buyer | `access control › roles…`, `invite link…` | service |
| Editing an approved brief invalidates approvals; stale/forged approval hash refused | `two-party approval › editing an approved brief…` | service |
| Paid version cannot be edited; amendment needs both approvals; price change refused | `a paid version cannot be edited…` | service |
| Stale checkout version (brief edited after checkout) → capture refused, PayPal never called | `refuses to capture a checkout created for a version that was edited afterwards` | mock PayPal |
| Price/currency tampering (order or capture amount differs) → never marked paid | `price and currency come from the approved brief…`, `a capture whose amount differs…` | mock PayPal |
| Repeated create → one order; capture retries idempotent; lost capture response reconciled via `ORDER_ALREADY_CAPTURED` | `repeated checkout clicks…`, `capture retries are idempotent…` | mock PayPal |
| Buyer approval ≠ payment (unapproved order not captured) | `buyer approval at PayPal is not payment…` | mock PayPal |
| Pending capture → not paid, blocks delivery, completes only on a PayPal event | `a PENDING capture is not paid…` | mock PayPal + webhook processor |
| Declined funding source → retry possible, nothing paid | `a declined funding source…` | mock PayPal |
| Duplicate webhook applied once; refund and reversal not treated as paid; unknown capture ignored | `webhooks › …` | webhook processor |
| Invalid webhook signature (modified body, wrong webhook id, forged key, foreign cert URL) rejected | `webhook signature (PayPal self-verification algorithm)` | real crypto, throwaway self-signed cert |
| Missing promised file (SVG) flagged with the source passage; passes after correction | `delivery checks › flags the missing SVG…` | service |
| File type from content (renamed PNG, SVG with script) | `detects file type from content…` | service |
| Acknowledge ≠ accept; objections persist until withdrawn | `buyer responses and the record…` | service |
| Export has valid source passages, no emails or payer IDs; tampering breaks the hash chain | `exports a record…` | service |
| Extraction keeps only quoted, value-matching claims; INR rejected; injected instructions cannot create unsourced values | `extraction validation › …` | pure functions |

## 3. Browser journey (Playwright, Chromium) — 8 Nov 2026

`npm run build && npm run test:e2e` → **1 passed** (about 7 s of browser time). Production server, fresh database, **PayPal FIXTURE and AI FIXTURE modes**.

Steps: seller signs up → creates the agreement from the fictional conversation → copies the invite link → buyer signs up through it and joins → buyer edits the brief (version 2) → both approve version 2 → seller is refused checkout → buyer pays (fixture) → seller uploads concepts + final PNG without SVG → overview shows *SVG — Not met* with a source chip → buyer reports a problem → seller uploads the SVG → buyer accepts and withdraws the objection → history shows an intact hash chain → JSON export checked → an unrelated user gets *Not found* for the page, the export and a file → a cross-origin POST with a valid session is refused (403).

## 4. Scripted scenarios — 8 Nov 2026

`npx tsx eval/scenarios.ts` → 4/4 pass (complete delivery, missing item, ambiguous terms, approved change). See `eval/results/scenarios.md`. FIXTURE PayPal gateway; fictional data.

## 5. Live PayPal sandbox

| Run | Status |
|---|---|
| `npm run paypal:check` (OAuth, create order, idempotent repeat, GET) | **Not run yet** — sandbox app credentials not configured on 8 Nov |
| Browser checkout with a sandbox Personal buyer, capture COMPLETED, record shows PayPal order + capture IDs | **Not run yet** |
| Signed sandbox webhook received and verified | **Not run yet** — needs a public HTTPS URL and `PAYPAL_WEBHOOK_ID` |

## 6. Live AI

| Run | Status |
|---|---|
| `npm run ai:check` (one Claude extraction of the demo conversation) | **Not run yet** — `ANTHROPIC_API_KEY` not configured for this project on 8 Nov |
| `npm run eval -- --provider anthropic` | **Not run yet** |

## Known gaps

- Disputes API not integrated: the sandbox `disputes/create` scope needs PayPal account-manager enablement. Complaints are recorded inside the app and labelled as such; verified `CUSTOMER.DISPUTE.*` webhooks are recorded as official PayPal notices.
- No load, accessibility audit tooling, or cross-browser runs beyond Chromium.
- Time-comparison study (manual vs app) not run. See `docs/EVALUATION.md`.
