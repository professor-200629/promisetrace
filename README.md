# PromiseTrace

**Agree the work, pay through PayPal, and check delivery against what was agreed — one requirement at a time, with every statement traceable to its source.**

PromiseTrace is a hackathon MVP for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). It serves one specific workflow: an independent digital-service seller (for example a logo designer in India) and an overseas client who agreed a job in chat or email and pay through PayPal.

## For judges: try it in five minutes

| | |
|---|---|
| **Hosted demo** | **https://promisetrace-sandbox.vercel.app**: PayPal **sandbox** and Claude live, fictional data, no real money |
| **Demo video** | https://youtu.be/-Rp3hlbv-DA (2:29) |
| **Seller login** | `seller@demo.promisetrace.test` · password `promisetrace-demo-2026` (fictional, test-only) |
| **Buyer login** | `buyer@demo.promisetrace.test` · same password |
| **Test card** | In the PayPal window choose **Debit or Credit Card**: Mastercard `5555 5555 5555 4444`, any future expiry, any CVV, any US billing details. If the sandbox declines it, try Visa `4012 8888 8888 1881` or a PayPal sandbox Personal account. |
| **Files to upload** | [`demo-files/`](demo-files/): `concept-a.png`, `concept-b.png`, `northwind-final.png`, `northwind-final.svg` (fictional) |

Use two windows (one private) so both people stay signed in. The demo accounts are shared by every tester, so you may see other agreements; for a clean space, create two accounts of your own on the sign-up page.

**Seller (window 1)**
1. Sign in as the seller → **New agreement** → **Use the fictional logo example** → **Create and propose brief**. Claude proposes the brief; each value links to the sentence it came from.
2. **Brief & approval** → copy the invite link → **Approve version 1**.
3. After the buyer pays: **Delivery** → upload `concept-a.png` and `concept-b.png` for the concepts and only `northwind-final.png` for the final files → **Submit delivery**. PromiseTrace shows *Final logo files: SVG — Not met*, linked to the sentence in the brief.
4. After the buyer reports it: upload `northwind-final.svg` as a second delivery. Every checkable item is now met.

**Buyer (window 2, private)**
1. Open the invite link → sign in as the buyer → **Join this agreement as the buyer** → **Approve version 1**.
2. **Payment** → read the payment terms shown above the PayPal buttons → pay with the test card. PayPal **holds** the money; nothing is captured.
3. **Delivery** → **Report a problem** about D2 (the missing SVG) → **Record my response**.
4. After the corrected delivery: **Accept** → **Accept and capture the held 300.00 USD**. PayPal captures the hold. Then withdraw the objection.
5. The agreement now reads **Complete** → **View evidence record** opens the exported record (HTML; JSON on **History & export**).

### Payment terms (the same text the app shows)

PayPal holds the payment at checkout. It is captured when the buyer accepts the delivery, or by the seller after a 5-day review period if code finds every agreed item met, nothing is flagged, no objection is open and nothing needs the buyer's confirmation.

- Accepting the latest delivery captures the held payment for the seller. An acceptance counts only for the delivery it follows.
- The seller can capture without the buyer's acceptance only after the 5-day review period that starts with the latest delivery, and only if code finds every agreed file format, count and the deadline met, no file is flagged, the buyer has no open objection, and no agreed item needs the buyer's confirmation (items code cannot check, such as an `.ai` file or an item with no format or count). Optional fields the parties never agreed on (no deadline, no revision count) do not block.
- The seller can cancel and release the hold at any time; the buyer can release it if the agreed deadline passes with nothing delivered. If nobody captures or releases it, PayPal's hold ends after 29 days and nothing is charged.
- PayPal capture is most likely to succeed within the first three days of authorization ([PayPal: authorization and honor period](https://developer.paypal.com/payment-methods/auth-honor/)). The 5-day review period puts any seller capture after that window, so it can fail; PromiseTrace records a failed capture instead of hiding it. Reauthorization is not built.

The server enforces these rules (`src/lib/hold-rules.ts`); the wording lives in one place (`src/lib/payment-terms.ts`).

## What it does

1. The seller pastes the conversation. **Claude (Anthropic API)** proposes a structured brief — deliverables, counts, file formats, price, deadline and timezone, revision rounds, and open questions. Every value must quote the source; our code checks that the quote exists and mentions that value, or the value stays *unknown*.
2. The buyer joins through a private invite link. **Both participants approve the same version.** Any edit before payment creates a new version and resets approvals.
3. The buyer pays with **PayPal Checkout (sandbox)**, and PayPal **holds** the money (an authorization) instead of taking it. Orders are created on the server from the approved version's price. The hold is **captured when the buyer accepts the delivery**, or by the seller after the review period under the [payment terms](#payment-terms-the-same-text-the-app-shows) above, and **released** if the seller cancels or the deadline passes with nothing delivered. Only a capture PayPal returns as `COMPLETED`, with the exact amount and reconciliation IDs, marks the agreement paid.
4. The seller uploads files. **Deterministic code** checks promised formats (from file bytes, not names), counts and the deadline in the agreed timezone. In the demo, the seller forgets the SVG; PromiseTrace flags it and links the finding to the sentence in the approved brief.
5. The buyer acknowledges, accepts, requests a revision or reports a problem — separate, explicit statements. Accepting the latest delivery captures the held payment. Objections stay visible until withdrawn. Once PayPal confirms the capture, the buyer has accepted and no objection is open, the agreement reads **Complete**.
6. A **requirement-to-evidence table**, a **hash-chained history**, and an **HTML/JSON evidence export** keep *agreed*, *observed* and *needs review* apart, and label every entry as recorded by PromiseTrace, confirmed by PayPal's API, stated by a participant, or interpreted by AI.

> PromiseTrace records facts and supports resolution between two parties. It never holds funds itself: a payment hold is a PayPal authorization on the buyer's payment method. It does **not** lift PayPal account holds, decide PayPal claims, or guarantee PayPal Seller Protection. All demo data is fictional.

## Status (be precise)

| Area | State | Evidence |
|---|---|---|
| Brief extraction with source validation | Built | `src/lib/ai/*`, unit tests |
| Two-party approval and immutable versions | Built | `src/lib/services/briefs.ts`, tests |
| PayPal order/capture/webhooks (server-side, idempotent) | Built; mock-tested and live-tested | `src/lib/services/payments.ts`, `webhooks.ts` |
| **Hold at checkout, capture on acceptance** (authorize / capture / void) | Built 10 Nov; mock-tested; **live hosted runs passed**: hold → buyer accepts → capture COMPLETED, and hold → seller cancels → VOIDED, signed webhooks verified | `src/lib/hold-rules.ts`, `src/lib/services/hold.ts`, [VERIFICATION 5c–5e](docs/VERIFICATION.md) |
| **Single-merchant only** | Every capture goes to the one sandbox merchant account configured on the server, not to each seller | See [DEPLOYMENT](docs/DEPLOYMENT.md) → Production would need |
| **Live PayPal sandbox payment** | Passed 8 Nov (guest card checkout, capture COMPLETED, re-verified via API) | [docs/VERIFICATION.md](docs/VERIFICATION.md), [sample record](docs/sample-evidence/) |
| **Real Claude extraction** | Live run passed 8 Nov | `npm run ai:check`, [docs/VERIFICATION.md](docs/VERIFICATION.md) |
| Delivery checks, buyer actions, evidence export | Built | tests + Playwright journey |
| Buyer-confirm rule, **Complete** state, one set of payment terms | Built 11 Nov; 77 tests + browser journey (fixture); live runs passed locally and on the **hosted demo** (Claude + hold → missing SVG → corrected delivery → acceptance → capture COMPLETED → Complete, signed webhooks verified) | [VERIFICATION 5f–5g](docs/VERIFICATION.md) |
| Browser journey (fixture mode) | Passing | `tests/e2e/journey.spec.ts` |
| Synthetic extraction benchmark | Baseline + 2 Claude runs (precision 1.00, recall 0.95–0.97) | [docs/EVALUATION.md](docs/EVALUATION.md) |
| Customer interviews | **Not done** — script only | [docs/INTERVIEW_SCRIPT.md](docs/INTERVIEW_SCRIPT.md) |

## Run it locally (Windows, macOS or Linux)

Requirements: Node.js 20.19+ (tested on Node 24.14, Windows 11).

```bash
git clone <this repo> promisetrace
cd promisetrace
npm install
copy .env.example .env        # macOS/Linux: cp .env.example .env
npx prisma migrate deploy     # creates dev.db (SQLite)
npm run db:seed               # fictional demo accounts (see below)
npm run dev                   # http://localhost:3000
```

Fill `.env`:

| Variable | Needed for | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | sessions | any 32+ random characters |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | real sandbox checkout | developer.paypal.com → Apps & Credentials → **Sandbox** → your app |
| `PAYPAL_WEBHOOK_ID` | webhook verification | after adding `https://<your-host>/api/paypal/webhook` to the app (subscribe to `PAYMENT.AUTHORIZATION.CREATED` / `VOIDED` too) |
| `CHECKOUT_INTENT`, `REVIEW_WINDOW_DAYS` | payment flow | default `AUTHORIZE` (hold at checkout, capture under the payment terms) and 5 days; `CAPTURE` takes the money at checkout |
| `AI_DAILY_CALL_LIMIT`, `AI_DAILY_CALL_LIMIT_PER_USER` | AI budget | defaults 40 per day overall and 8 per account |
| `MAX_UPLOAD_BYTES`, `MAX_DELIVERY_BYTES` | uploads | default 4 MiB per file and per delivery (Vercel rejects bodies over 4.5 MB) |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | real AI extraction | default `claude-opus-5-5`, effort `low`, daily call cap |

Without credentials the app shows a clear **setup state**. For offline development only, `PAYPAL_MODE=fixture` and `AI_PROVIDER=fixture` replace PayPal and the AI with labelled stand-ins; every fixture payment and extraction is marked FIXTURE in the UI and in exports.

### Demo accounts (fictional, test-only)

`npm run db:seed` creates `seller@demo.promisetrace.test`, `buyer@demo.promisetrace.test` and `outsider@demo.promisetrace.test` with the password in `prisma/seed.ts` (`promisetrace-demo-2026`). Never reuse it. To pay in the sandbox, use a PayPal **sandbox Personal** account from your developer dashboard (Testing Tools → Sandbox Accounts).

### Try the core path

1. Sign in as the seller → **New agreement** → *Use the fictional logo example* → **Create and propose brief**.
2. Copy the invite link → open it in a private window → sign in as the buyer → **Join**.
3. Both approve the same version (edit something first to see approvals reset).
4. Buyer → **Payment** → pay with the PayPal sandbox buyer. PayPal now **holds** the money; nothing is captured.
5. Seller → **Delivery** → upload two concept PNGs and a final PNG (no SVG) → see *Final logo files: SVG — Not met*, linked to the source line.
6. Buyer reports the problem → seller uploads the SVG → buyer chooses **Accept** → **Accept and capture the held 300.00 USD**, then withdraws the objection.
7. The agreement reads **Complete** → **View evidence record**, or **History & export** → download the HTML or JSON record.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development, production build, production server |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Vitest: 77 unit + service-level failure cases (mock PayPal, real SQLite) |
| `npm run test:e2e` | Playwright browser journey (run `npm run build` first; fixture mode) |
| `npm run paypal:check` | Live sandbox: OAuth, create order, idempotent retry, read back |
| `npm run paypal:verify` | Re-read the latest completed capture (and, for holds, the authorization) from PayPal and compare with the stored record |
| `npx tsx scripts/paypal-authorize-check.ts` | Live sandbox check of authorize / capture / void for your merchant (see the file header) |
| `npx tsx scripts/paypal-refresh-holds.ts [--apply]` | Re-read every hold from PayPal and record its current status (CAPTURED, VOIDED, EXPIRED) |
| `npx tsx scripts/export-latest.ts [dealId basename]` | Write an agreement's evidence record to `docs/sample-evidence/` |
| `npm run eval -- --provider fixture` | Synthetic benchmark, rule-based baseline (free) |
| `npm run eval -- --provider anthropic` | Synthetic benchmark with Claude (uses API credit) |
| `npx tsx eval/scenarios.ts` | Four scripted end-to-end scenarios |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — data model, trust boundaries, payment state machine
- [Verification](docs/VERIFICATION.md) — what was tested, how, and what was not
- [Evaluation](docs/EVALUATION.md) — synthetic benchmark, scenarios, time-comparison protocol
- [Deployment](docs/DEPLOYMENT.md) — Render + Turso (free tiers) and multi-merchant notes
- [Landscape and policy research](docs/research/policy-and-landscape.md) — PayPal India rules, Disputes API, Chargeflow, Bonsai
- [Interview script](docs/INTERVIEW_SCRIPT.md) and [pilot hypothesis](docs/PILOT_HYPOTHESIS.md)
- [Submission drafts](docs/submission/) — Devpost text, demo script, judging self-review

## How AI is used (and not used)

- **Used:** Claude (`claude-opus-5-5` by default, configurable via `AI_MODEL`) through the official `@anthropic-ai/sdk` with structured outputs, low effort, a token cap, a per-day call cap, a refusal fallback, and per-call token/cost/latency logging (`AiRun`).
- **Not used for:** money arithmetic, payment status, file types or counts, deadlines, or deciding whether the work is acceptable. Those are code or people.
- **Untrusted input:** pasted text is wrapped as data, the model is told never to follow instructions inside it, and nothing it returns can authorize an action — every value still needs a verified quote and both participants' approval.

## AI tools used to build this project

- **Claude Code** (Anthropic; model Claude Opus 5.5) wrote most of the code, tests and documentation under the author's direction.
- **Claude API** is the runtime AI inside the app (see above).
- **ElevenLabs** (AI voice) for the demo video's voice-over. The screen footage is a real recording of the hosted sandbox app (Playwright), not generated.

## Third-party software

Next.js, React, Prisma (+ libSQL adapter), Better Auth, Zod, Tailwind CSS, Anthropic TypeScript SDK, Vitest, Playwright — all under their own open-source licenses (see `package.json` / `node_modules/*/LICENSE`). PayPal JavaScript SDK is loaded from PayPal at runtime and is subject to PayPal's developer terms. No PayPal logos or trademarks are bundled; PayPal names are used only to describe the integration. PromiseTrace is not affiliated with or endorsed by PayPal.

## License

[MIT](LICENSE)
