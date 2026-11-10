# Verification record

Everything here was run on the author's Windows 11 laptop (Node 24.14). "Mock" means the PayPal API was replaced by a scripted stand-in (`tests/helpers.ts → ScriptedGateway`) or the labelled FIXTURE gateway. **Mocked tests are not evidence that the live PayPal integration works.** Live runs are listed separately below.

## 1. Static checks and build — 8 Nov 2026

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | pass, 0 errors |
| Lint | `npm run lint` | pass, 0 errors, 0 warnings |
| Production build | `npm run build` | pass (Next.js 16.4.5, Turbopack), 17 routes |

## 2. Automated tests (mock PayPal, real SQLite) — 8 Nov 2026, extended 10 Nov 2026

`npm test` → **57 passed, 0 failed** (4 files, about 10 s) on 10 Nov, after the hold-at-checkout flow was added (33 on 8 Nov). Tests that exercise capture-at-checkout pass `intent: "CAPTURE"` explicitly; the default hold flow is tested in `tests/integration/holds.test.ts` and `tests/unit/hold-rules.test.ts`.

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
| **Holds (10 Nov):** an authorization funds and locks the agreement and opens delivery but captures nothing; a second checkout is refused | `hold at checkout › a PayPal authorization funds…` | mock PayPal |
| Approval in PayPal is not a hold; stale version → authorize refused without calling PayPal; tampered hold amount → MISMATCH; PENDING/DENIED hold → not funded | `hold at checkout › …` | mock PayPal |
| Lost authorize response reconciled with the same `PayPal-Request-Id`; the capture-at-checkout endpoint refuses a hold | `hold at checkout › a lost authorize response…`, `…refuses a hold checkout` | mock PayPal |
| Buyer acceptance captures once even if the seller also asks (same request id); acknowledgement never captures; only the buyer can accept; outsiders get 404 | `capture on acceptance › …` | mock PayPal |
| Hold reported EXPIRED at capture → recorded, never paid; PENDING capture of a hold → not paid | `capture on acceptance › a hold that PayPal reports expired…`, `…PENDING capture…` | mock PayPal |
| Seller capture refused before the review window, while a requirement is not met, while an objection is open; allowed after; recorded as the seller's declaration first | `seller capture after the review window › …` | mock PayPal |
| Seller cancel needs a reason, voids the hold, blocks capture and delivery; buyer release only after a missed deadline with nothing delivered | `releasing the hold to the buyer › …` | mock PayPal |
| Authorization webhooks: CREATED applied once (duplicate ignored), a late CREATED after capture does not undo it, VOIDED releases, unknown hold ignored | `authorization webhooks › …` | webhook processor |
| Rules table: honor period, expiry, acceptance of an older delivery does not count, missing deadline | `hold rules › …` | pure functions |

## 3. Browser journey (Playwright, Chromium) — 8 Nov 2026, re-run 10 Nov 2026

10 Nov re-run with the hold flow: **1 passed**. The buyer's fixture checkout now places a hold ("PayPal holds 300.00 USD for this agreement"), and "Accept and release 300.00 USD to the seller" captures it; the JSON export shows `flow: hold_at_checkout_capture_on_acceptance`, `status: COMPLETED`, `captureTrigger: BUYER_ACCEPTED`.

`npm run build && npm run test:e2e` → **1 passed** (about 7 s of browser time). Production server, fresh database, **PayPal FIXTURE and AI FIXTURE modes**.

Steps: seller signs up → creates the agreement from the fictional conversation → copies the invite link → buyer signs up through it and joins → buyer edits the brief (version 2) → both approve version 2 → seller is refused checkout → buyer pays (fixture) → seller uploads concepts + final PNG without SVG → overview shows *SVG — Not met* with a source chip → buyer reports a problem → seller uploads the SVG → buyer accepts and withdraws the objection → history shows an intact hash chain → JSON export checked → an unrelated user gets *Not found* for the page, the export and a file → a cross-origin POST with a valid session is refused (403).

## 4. Scripted scenarios — 8 Nov 2026

`npx tsx eval/scenarios.ts` → 4/4 pass on 8 Nov; **5/5 on 10 Nov** with the hold flow (complete delivery: AUTHORIZED while delivering, COMPLETED after acceptance; missing item; ambiguous terms; approved change; new: seller cancels before delivery → VOIDED, nothing captured, deliveries closed). See `eval/results/scenarios.md`. FIXTURE PayPal gateway; fictional data.

## 5. Live PayPal sandbox

| Run | Status |
|---|---|
| `npm run paypal:check` (OAuth, create order, idempotent repeat, GET) | **Pass, 8 Nov 2026**: OAuth token in 2.0 s; order `3XR94915XJ8075621` created; the same `PayPal-Request-Id` returned the **same** order; GET shows 1.00 USD, our `custom_id`, approval link on `www.sandbox.paypal.com`. |
| Full browser journey against the live sandbox (production build, real Claude, Chrome) | **Pass, 8 Nov 2026, 16:42–16:56 UTC** — see below. |
| `npm run paypal:verify` (re-read order and capture from PayPal, compare with the stored record) | **Pass**: order `8B294411574047320` COMPLETED; capture `096203045U497594X` COMPLETED, 300.00 USD, `invoice_id` `PT-77b8748d-mw82ikfx`, `custom_id` `pt:cmw8293rs0000dcuucp7aeb1n:v2`; gross 300.00 / fee 14.16 / net 285.84; "MATCH". |
| Buyer paying with a sandbox **PayPal account** (wallet login in the popup) | **Not run.** The live payment used PayPal's **guest card** checkout with PayPal's published sandbox test Visa (4012 8888 8888 1881) and fictional billing details, because both sandbox test accounts on this developer account are in India (PayPal India does not support India-to-India payments) and creating a US test account needs the account owner. Same server-side order/capture path. |
| Signed sandbox webhook received and verified | **Pass, 8 Nov 2026 (hosted)** — see 5b; and for holds on 10 Nov — see 5d. Signature verification is also covered by the unit test with a throwaway certificate. |

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

Sandbox webhook registered on 8 Nov 2026: ID `5KH82963RX958642Y` → `https://promisetrace.vercel.app/api/paypal/webhook`, events CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED/PENDING/DECLINED/DENIED/REFUNDED/REVERSED, CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED; `PAYPAL_WEBHOOK_ID` set in Vercel and redeployed (`/setup` shows it set).

### Hosted logged-in journey with real signed webhooks — 8 Nov 2026, 17:30–17:40 UTC

On **https://promisetrace-sandbox.vercel.app** (same deployment; the user named this sandbox-labelled address for the run), demo accounts, Chrome:

1. Live Claude extraction on Vercel: 3,544 tokens, about $0.0216, 4.4 s; 11/11 claims kept with verified passages; one palette question.
2. Buyer joined by invite, resolved the question (version 2), both approved.
3. Buyer paid through the PayPal JS SDK guest card form (PayPal test Visa): order `3YT96083VP356691S`, capture `7R669110YN260430P` **COMPLETED**, 300.00 / 14.16 / 285.84 USD.
4. **Signed webhooks received and self-verified** (rows in the hosted `WebhookEvent` table, `verified = 1`, method SELF): `CHECKOUT.ORDER.APPROVED` (applied, recorded as a PayPal-confirmed history entry) and `PAYMENT.CAPTURE.COMPLETED` (applied idempotently: the capture was already recorded, so nothing was duplicated).
5. Seller delivered concepts + final PNG → "Not met yet: Final logo files: SVG"; added the SVG → "4 checks met"; buyer accepted.
6. History: 18 entries, hash chain intact.

Follow-up fixed after this run: the history text for a buyer-approval webhook that arrives after the capture now says the capture was already confirmed.

## 5c. Authorize-then-capture feasibility (same Indian sandbox merchant) — 10 Nov 2026

Question: can this merchant hold the buyer's payment at checkout and capture it only when the buyer accepts the delivery? Tested outside the app with `scripts/paypal-authorize-check.ts` (REST calls) and `scripts/paypal-authorize-page.mjs` (a local page with the PayPal JS SDK Buttons loaded with `intent=authorize`, the same button type the app uses). Fictional guest card details, PayPal's published test cards; no real money.

| Step | Result |
|---|---|
| Create order `intent=AUTHORIZE`, $10.00 USD | HTTP 201, order `5K770871YG781454F` CREATED |
| Buyer approval through JS SDK "Debit or Credit Card" (test Visa) | `onApprove` fired; order status APPROVED |
| `POST /v2/checkout/orders/{id}/authorize` | HTTP 201; authorization `33533414BB626663L` **CREATED**, $10.00, expires **2026-12-09T11:31:38Z** (29 days) |
| `POST /v2/payments/authorizations/{id}/capture` $6.00, `final_capture: false` | HTTP 201; capture `9FK5866029227804X` **COMPLETED** $6.00; authorization PARTIALLY_CAPTURED |
| `POST /v2/payments/authorizations/{id}/void` | HTTP 200; authorization **VOIDED** |
| Capture $1.00 after the void | HTTP 422 `AUTHORIZATION_VOIDED` (refused, as expected) |

Result: **authorize, partial capture and void all work for this merchant** on the JS SDK path.

What did not work, recorded as found: PayPal's *redirect* checkout page (`checkoutnow?token=…`, guest card form) refused both test cards ("We weren't able to add this card") for an AUTHORIZE order **and** for a CAPTURE control order, so the refusal comes from that page, not from the intent. The app does not use that page.

Not tested yet: the honor period (PayPal's documentation says funds are only guaranteed for 3 days after authorizing; capturing later may fail) and reauthorization. The `PAYMENT.AUTHORIZATION.*` webhooks were tested on the hosted app in 5d.

## 5d. Hosted journey with a held payment — 10 Nov 2026, 11:54–12:01 UTC

Same Vercel deployment and Turso database (additive migration `20261110000000_payment_holds` applied first); webhook `5KH82963RX958642Y` extended with `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.AUTHORIZATION.VOIDED` (12 events). Demo accounts in Chrome; buyer paid with the JS SDK guest card form (PayPal test Visa, fictional US details).

1. Live Claude extraction: 3,541 tokens, about $0.0216, 7.2 s; 11/11 claims kept; one open question (palette), approved knowingly.
2. Buyer joined, both approved version 1.
3. Checkout with `intent=AUTHORIZE`: order `6WJ57592AV292201X`; authorization `244006074A973950A` **CREATED**, 300.00 USD held until 2026-12-09 11:58 UTC; status AUTHORIZED, version locked, nothing captured.
4. Seller delivered concepts + final PNG → "Not met yet: Final logo files: SVG"; the seller's capture button was refused ("The buyer has until 2026-11-15 … to review delivery 2"); seller added the SVG → 4 checks met.
5. Buyer chose Accept → "Accept and release 300.00 USD to the seller" → capture `37S43228146842457` **COMPLETED**, 300.00 / 14.16 / 285.84 USD, recorded as "captured because the buyer accepted the delivery".
6. Signed webhooks received and self-verified (hosted `WebhookEvent` rows, `verified = 1`, method SELF, outcome APPLIED, no duplicate history entries): `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`.
7. History: 17 entries, hash chain intact, in order: hold → deliveries → checks → buyer acceptance → capture.
8. `npm run paypal:verify` against the hosted database: order COMPLETED; capture COMPLETED 300.00 USD with our `invoice_id` and `custom_id`; authorization **CAPTURED** 300.00 USD; trigger BUYER_ACCEPTED → **MATCH**.

Found and fixed after this run: the stored authorization status stayed "CREATED" after the capture (PayPal reports CAPTURED; the app now re-reads the authorization after capturing), and a "Z UTC" time format. The row from this run still shows the old stored value. Not run live in the app: the seller cancel / buyer release (void) path — the void API itself passed live in 5c and the app path is covered by mock tests.

## 6. Live AI

| Run | Status |
|---|---|
| `npm run ai:check` (one Claude extraction of the demo conversation) | **Pass, 8 Nov 2026**: `claude-opus-5-5`, 8.2 s, 3,063 in + 544 out tokens (~$0.023). Price 300.00 USD, deadline 2026-11-20 17:00 America/New_York, 2 revisions, 2 × PNG concepts, final PNG + SVG — all with verified quotes (12/12 kept, 0/7 quotes invalid). It also flagged the colour palette as unclear and asked whether it is included. |
| `npm run eval -- --provider anthropic` | **Pass, 8 Nov 2026**: two runs, see `docs/EVALUATION.md` (precision 1.00, recall 0.947 → 0.965 after one validator fix, $0.21 per run) |

## Known gaps

- Disputes API not integrated: the sandbox `disputes/create` scope needs PayPal account-manager enablement. Complaints are recorded inside the app and labelled as such; verified `CUSTOMER.DISPUTE.*` webhooks are recorded as official PayPal notices.
- No load, accessibility audit tooling, or cross-browser runs beyond Chromium.
- Time-comparison study (manual vs app) not run. See `docs/EVALUATION.md`.
