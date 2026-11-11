# Architecture

One Next.js 16 application (App Router, TypeScript) with server components, server actions and a few route handlers. One SQLite database through Prisma 7 and the libSQL driver adapter (a local file in development; a Turso libSQL database or a persistent disk in hosting). No queues, no microservices.

```
Browser ──► Next.js server ──► Prisma ──► SQLite / libSQL
              │   ├─ Better Auth (sessions, password hashing, origin checks)
              │   ├─ Anthropic API (brief proposal only)
              │   └─ PayPal REST: OAuth, Orders v2 create/get/authorize/capture, Payments v2 authorization get/capture/void, capture get
              ▲
PayPal ───────┘ webhooks (signature self-verified on the raw body)
```

## Trust boundaries

| Input | Treated as | Where enforced |
|---|---|---|
| Pasted brief / conversation | Untrusted data; stored unchanged with SHA-256 | `createDeal`, AI prompt, `validateExtraction` |
| AI output | A proposal; every value needs a quote that exists in the source and mentions that value | `src/lib/ai/validate.ts` |
| Browser requests | Untrusted; price, currency, merchant and version are never read from them | `createCheckout`, `authorizePayment`, `capturePayment` |
| Capture / release of a hold | Allowed only by deterministic rules re-checked on the server | `src/lib/hold-rules.ts`, `src/lib/services/hold.ts` |
| PayPal API responses | Authoritative for payment state, after amount/currency/custom_id/invoice_id reconciliation | `applyAuthorizationState`, `applyCaptureState` |
| PayPal webhooks | Authoritative only after signature verification; idempotent by event id | `/api/paypal/webhook`, `processVerifiedWebhook` |
| Uploaded files | Untrusted bytes; type from magic bytes; never rendered inline; served as attachments with `CSP: sandbox` | `src/lib/files/inspect.ts`, `/api/files/[id]` |

## Data model (prisma/schema.prisma)

- `Deal` — seller, buyer (joins via single-use hashed invite token), soft-delete flag.
- `SourceDocument` — immutable pasted text (`S1`), SHA-256.
- `BriefVersion` — immutable canonical JSON + content hash. Edits create a new version and mark the old one superseded. `lockedAt` is set when the agreement is funded: a hold (authorization) is CREATED, or a capture COMPLETES. After payment, changes are `AMENDMENT` versions.
- `Approval` — (version, user, role, contentHash). Counts only if the hash still matches and the version is current.
- `Payment` — one row per checkout attempt: approved version + hash, `intent` (AUTHORIZE = held at checkout, the default; CAPTURE = paid at checkout), amount in minor units, `createRequestId` / `authorizeRequestId` / `captureRequestId` / `voidRequestId` (sent as `PayPal-Request-Id`), PayPal order, authorization and capture IDs, hold expiry, capture trigger, status, gross/fee/net, hashed payer id.
- `WebhookEvent` — PayPal event id as primary key (dedupe), outcome.
- `Delivery`, `DeliveryFile` (+ `FileBlob`), `CheckResult` — files with SHA-256, detected type, dimensions, safety notes; check snapshot at submission.
- `BuyerAction` — ACKNOWLEDGE_RECEIPT, ACCEPT, REQUEST_REVISION, REPORT_PROBLEM, WITHDRAW_OBJECTION.
- `AiRun` — provider, model, tokens, cost (micro-USD), latency, validation report.
- `Event` — append-only history; `hash = sha256(prevHash + canonical(entry))`; `kind` ∈ SYSTEM_CONFIRMED, PAYPAL_CONFIRMED, USER_DECLARATION, AI_INTERPRETATION.

## Brief extraction

1. Sources are sent inside `<source id="S1">` tags with a system prompt that forbids following embedded instructions and requires verbatim quotes.
2. `client.beta.messages.parse` with a Zod schema (structured output), `output_config.effort` (default low), `max_tokens` cap, server-side refusal fallback.
3. `validateExtraction` locates each quote (exact, then whitespace/quote-tolerant mapped back to original offsets), then checks that the passage literally mentions the value (amount digits and currency, day and month, hour, count as digit or word, format name). Unsupported values become `unknown`; invalid quotes and dropped claims are recorded.
4. Deterministic gap questions are added (price, deadline, timezone, revisions, unspecified deliverables) and labelled "Gap found by checks" separately from AI questions.
5. Budget: `AI_DAILY_CALL_LIMIT`, `AI_MAX_INPUT_CHARS`, `AI_MAX_OUTPUT_TOKENS`; failures fall back to manual entry.

## Payment state machine

Default (`CHECKOUT_INTENT=AUTHORIZE`): hold at checkout, capture on acceptance.

```
INITIATED ─create order intent AUTHORIZE─► ORDER_CREATED ─buyer approves in PayPal (not payment)─►
   authorize: GET order → verify APPROVED + amount/IDs → POST /authorize (stable PayPal-Request-Id)
            ├─ CREATED ──► AUTHORIZED (funded: version locked, deliveries open; nothing captured)
            ├─ PENDING ──► AUTHORIZATION_PENDING (not funded)   ├─ DENIED ──► AUTHORIZATION_DENIED
            └─ amount mismatch ──► MISMATCH
AUTHORIZED ─buyer ACCEPTs latest delivery──────────────────────────────► capture (final, full amount)
           ─seller, review window passed, all checks met, nothing flagged, no objection,
            no agreed item that only the buyer can confirm─► capture (always after PayPal's 3-day honor period)
           ─seller cancels (reason recorded) / buyer after missed deadline with nothing delivered─► VOIDED
           ─PayPal says expired/voided at capture time─► EXPIRED / VOIDED (never paid)
capture ─► COMPLETED / CAPTURE_PENDING / DECLINED (same states and webhooks as below)
Webhooks: PAYMENT.AUTHORIZATION.CREATED / VOIDED (a late event never undoes a capture)
```

Capture at checkout (`CHECKOUT_INTENT=CAPTURE`, and payments made before 10 Nov):

```
INITIATED ─create order (PayPal-Request-Id)─► ORDER_CREATED ─buyer approves in PayPal (not payment)─►
   capture: GET order → verify APPROVED + amount/currency/custom_id/invoice_id
            → POST capture (stable PayPal-Request-Id)
            ├─ COMPLETED ────────► COMPLETED (version locked, deliveries open)
            ├─ PENDING ──────────► CAPTURE_PENDING (not paid; webhook or re-check later)
            ├─ DECLINED/FAILED ──► DECLINED / FAILED
            ├─ amount mismatch ──► MISMATCH (never paid)
            └─ INSTRUMENT_DECLINED → buyer restarts with another funding source
Brief edited before capture ─► ABANDONED; capture refused without calling PayPal
Webhooks: PAYMENT.CAPTURE.COMPLETED/PENDING/DENIED/DECLINED/REFUNDED/REVERSED, CHECKOUT.ORDER.APPROVED, CUSTOMER.DISPUTE.*
COMPLETED ─refund/reversal webhook─► REFUNDED / PARTIALLY_REFUNDED / REVERSED (no longer shown as paid)
```

Retries: a repeated create reuses the same `Payment` row and request id; repeated authorize/capture/void calls reuse their request ids (so a buyer acceptance and a seller capture racing each other produce one capture); `ORDER_ALREADY_CAPTURED` / `ORDER_ALREADY_AUTHORIZED` trigger a GET and reconciliation. PayPal guarantees held funds for 3 days (honor period) and keeps a hold for 29 days; reauthorization is not built.

## Delivery checks (`src/lib/services/checks.ts`)

Pure function of (effective brief, all files so far). For each deliverable: per promised format, count files whose **content** is that format (need = quantity or 1); formats code cannot identify (AI, PSD, FIG…) are "buyer to confirm"; renamed or active-content files are "needs review". Deadline: the moment the last required file arrived vs the agreed date/time converted from the agreed IANA timezone (end of day assumed and labelled if no time). Revisions: count of revision requests vs allowance.

## Security notes

- Every deal access goes through `loadDealForUser`; outsiders get 404.
- Server actions have Next.js origin checks; mutating route handlers call `assertSameOrigin`; cookies are HttpOnly, SameSite=Lax, Secure on HTTPS.
- CSP restricts scripts/frames to self + PayPal; `frame-ancestors 'none'`; `Referrer-Policy: no-referrer` (invite tokens are in URLs).
- Uploads: size and count limits, magic-byte allowlist (PNG, JPEG, SVG, PDF, ZIP), SVG scanned for scripts/handlers/external refs, PDF for JavaScript/launch actions; never rendered by the app.
- Exports omit emails and PayPal payer IDs; logs never print secrets.
- Retention: the seller can delete an agreement (cascade delete of sources, versions, files, history) only while PayPal has neither held nor moved money for it; after a hold or capture the record is kept for both sides, and `npm run retention` skips those agreements too (`src/lib/services/deals.ts`). PayPal's records are unaffected.
- Auth API: `/api/auth/*` serves only sign-in, sign-up, sign-out and session; Better Auth's account-changing endpoints (change password, update user, delete user, session revocation, password reset) return 404, so shared demo accounts cannot be taken over.
- Budgets: AI extraction has a daily cap overall and per account; one delivery is capped at 4 MiB to fit the host's 4.5 MB body limit.
- Holds: a hold past PayPal's expiry time counts as over (no delivery, capture or release); checkout warns when deadline + review window outlasts the 29-day hold; files flagged for review, and agreed items code cannot check (only the buyer can confirm them), block the seller's own capture; optional fields never agreed (no deadline, no revision count) do not; an objection must name a requirement. PayPal capture is most likely to succeed within the first three days of authorization, so the seller's capture after the 5-day review period can fail and is recorded if it does. The payment terms are written once in `src/lib/payment-terms.ts`; one agreement status (`src/lib/agreement-status.ts`) drives the page and the export, and reads Complete only when PayPal confirmed the capture, the buyer accepted the latest delivery and no objection is open.
