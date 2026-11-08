# Verification record

Everything here was run on the author's Windows 11 laptop (Node 24.14). "Mock" means the PayPal API was replaced by a scripted stand-in (`tests/helpers.ts → ScriptedGateway`) or the labelled FIXTURE gateway. **Mocked tests are not evidence that the live PayPal integration works.** Live runs are listed separately below.

## 1. Static checks and build — 8 Nov 2026

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | pass, 0 errors |
| Lint | `npm run lint` | pass, 0 errors, 0 warnings |
| Production build | `npm run build` | pass (Next.js 16.4.5, Turbopack), 17 routes |

## 2. Automated tests (mock PayPal, real SQLite) — 8 Nov 2026

`npm test` → **33 passed, 0 failed** (2 files, about 5 s).

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
| `npm run paypal:check` (OAuth, create order, idempotent repeat, GET) | **Pass, 8 Nov 2026**: OAuth token in 2.0 s; order `3XR94915XJ8075621` created; the same `PayPal-Request-Id` returned the **same** order; GET shows 1.00 USD, our `custom_id`, approval link on `www.sandbox.paypal.com`. |
| Full browser journey against the live sandbox (production build, real Claude, Chrome) | **Pass, 8 Nov 2026, 16:42–16:56 UTC** — see below. |
| `npm run paypal:verify` (re-read order and capture from PayPal, compare with the stored record) | **Pass**: order `8B294411574047320` COMPLETED; capture `096203045U497594X` COMPLETED, 300.00 USD, `invoice_id` `PT-77b8748d-mw82ikfx`, `custom_id` `pt:cmw8293rs0000dcuucp7aeb1n:v2`; gross 300.00 / fee 14.16 / net 285.84; "MATCH". |
| Buyer paying with a sandbox **PayPal account** (wallet login in the popup) | **Not run.** The live payment used PayPal's **guest card** checkout with PayPal's published sandbox test Visa (4012 8888 8888 1881) and fictional billing details, because both sandbox test accounts on this developer account are in India (PayPal India does not support India-to-India payments) and creating a US test account needs the account owner. Same server-side order/capture path. |
| Signed sandbox webhook received and verified | **Not run yet** — needs a public HTTPS URL and `PAYPAL_WEBHOOK_ID` (hosted demo). Signature verification is covered by the unit test with a throwaway certificate. |

### Live sandbox journey, 8 Nov 2026 (record exported to `docs/sample-evidence/northwind-live-sandbox.{json,html}`)

Merchant: the developer account's default sandbox Business account (region IN). Buyer: guest card checkout as above.

1. Seller created the agreement from the fictional email; **Claude** (`claude-opus-5-5`, 3,077 + 605 tokens, $0.0244, 6.0 s) proposed version 1: 300.00 USD, 2026-11-20 17:00 America/New_York, 2 revisions, 2 × PNG concepts, final PNG + SVG, and a "colour palette suggestion" marked ambiguous; 12/12 claims kept with verified passages. It asked whether the palette is included and whether the 12 Nov concept date has a time.
2. Buyer joined by invite, resolved both questions (version 2), both approved version 2 (hash `7e6d2b1eb1…`).
3. Buyer paid through the PayPal JS SDK; server captured: **COMPLETED**, version 2 locked.
4. Seller delivered two concept PNGs and the final PNG → automatic checks: **Final logo files: SVG — Not met**, linked to S1 line 9.
5. Buyer reported the problem → seller delivered the SVG → 4 checks met, 1 for the buyer to confirm (the palette, which code cannot check) → buyer accepted and withdrew the objection.
6. History: 19 entries, hash chain intact; export contains no email addresses or payer IDs.

Issues found during the live run and fixed:
- The sandboxed preview server could not reach the internet; the app was run from the user's terminal instead.
- A machine-wide `ANTHROPIC_BASE_URL` (a local proxy left by another tool) redirected the Anthropic SDK; the app now sets its API base URL explicitly (`AI_BASE_URL`).
- `next dev` entered a hot-reload loop in one long-lived Chrome tab after the server was restarted; the live run used the production build (`npm run build && npm start`). Not yet root-caused.

## 5b. Hosted deployment (Vercel + Turso), 8 Nov 2026

URL: https://promisetrace.vercel.app (Vercel Hobby, region iad1; database: Turso libSQL in AWS us-east-1; migrations applied with `scripts/migrate-libsql.ts`; fictional demo accounts seeded).

| Check (no login) | Result |
|---|---|
| `/`, `/about`, `/sign-in`, `/sign-up`, `/setup` | 200 |
| `/api/health` | 200 `{"status":"ok","db":"ok","paypal":"ready","ai":"ready"}` |
| `/deals` signed out | 307 to `/sign-in?next=/deals` |
| `/api/files/:id` signed out | 401 |
| Webhook POST without PayPal headers / with forged headers and a foreign cert URL | 400 / 400 ("Signature verification failed") |
| Cross-origin POST to the order endpoint | 403 |
| Security headers | CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` present |

Not yet run on the hosted site: the logged-in journey and a real signed sandbox webhook (needs `PAYPAL_WEBHOOK_ID`).

## 6. Live AI

| Run | Status |
|---|---|
| `npm run ai:check` (one Claude extraction of the demo conversation) | **Pass, 8 Nov 2026**: `claude-opus-5-5`, 8.2 s, 3,063 in + 544 out tokens (~$0.023). Price 300.00 USD, deadline 2026-11-20 17:00 America/New_York, 2 revisions, 2 × PNG concepts, final PNG + SVG — all with verified quotes (12/12 kept, 0/7 quotes invalid). It also flagged the colour palette as unclear and asked whether it is included. |
| `npm run eval -- --provider anthropic` | **Pass, 8 Nov 2026**: two runs, see `docs/EVALUATION.md` (precision 1.00, recall 0.947 → 0.965 after one validator fix, $0.21 per run) |

## Known gaps

- Disputes API not integrated: the sandbox `disputes/create` scope needs PayPal account-manager enablement. Complaints are recorded inside the app and labelled as such; verified `CUSTOMER.DISPUTE.*` webhooks are recorded as official PayPal notices.
- No load, accessibility audit tooling, or cross-browser runs beyond Chromium.
- Time-comparison study (manual vs app) not run. See `docs/EVALUATION.md`.
