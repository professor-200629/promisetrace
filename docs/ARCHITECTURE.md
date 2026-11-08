# Architecture

One Next.js 16 application (App Router, TypeScript) with server components, server actions and a few route handlers. One SQLite database through Prisma 7 and the libSQL driver adapter (a local file in development; a Turso libSQL database or a persistent disk in hosting). No queues, no microservices.

```
Browser ──► Next.js server ──► Prisma ──► SQLite / libSQL
              │   ├─ Better Auth (sessions, password hashing, origin checks)
              │   ├─ Anthropic API (brief proposal only)
              │   └─ PayPal REST: OAuth, Orders v2 create/get/capture, Payments v2 get capture
              ▲
PayPal ───────┘ webhooks (signature self-verified on the raw body)
```

## Trust boundaries

| Input | Treated as | Where enforced |
|---|---|---|
| Pasted brief / conversation | Untrusted data; stored unchanged with SHA-256 | `createDeal`, AI prompt, `validateExtraction` |
| AI output | A proposal; every value needs a quote that exists in the source and mentions that value | `src/lib/ai/validate.ts` |
| Browser requests | Untrusted; price, currency, merchant and version are never read from them | `createCheckout`, `capturePayment` |
| PayPal API responses | Authoritative for payment state, after amount/currency/custom_id/invoice_id reconciliation | `applyCaptureState` |
| PayPal webhooks | Authoritative only after signature verification; idempotent by event id | `/api/paypal/webhook`, `processVerifiedWebhook` |
| Uploaded files | Untrusted bytes; type from magic bytes; never rendered inline; served as attachments with `CSP: sandbox` | `src/lib/files/inspect.ts`, `/api/files/[id]` |

## Data model (prisma/schema.prisma)

- `Deal` — seller, buyer (joins via single-use hashed invite token), soft-delete flag.
- `SourceDocument` — immutable pasted text (`S1`), SHA-256.
- `BriefVersion` — immutable canonical JSON + content hash. Edits create a new version and mark the old one superseded. `lockedAt` is set when a capture COMPLETES. After payment, changes are `AMENDMENT` versions.
- `Approval` — (version, user, role, contentHash). Counts only if the hash still matches and the version is current.
- `Payment` — one row per checkout attempt: approved version + hash, amount in minor units, `createRequestId` / `captureRequestId` (sent as `PayPal-Request-Id`), PayPal order and capture IDs, status, gross/fee/net, hashed payer id.
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

Retries: a repeated create reuses the same `Payment` row and request id; a repeated capture uses the same capture request id; `ORDER_ALREADY_CAPTURED` triggers a GET and reconciliation.

## Delivery checks (`src/lib/services/checks.ts`)

Pure function of (effective brief, all files so far). For each deliverable: per promised format, count files whose **content** is that format (need = quantity or 1); formats code cannot identify (AI, PSD, FIG…) are "buyer to confirm"; renamed or active-content files are "needs review". Deadline: the moment the last required file arrived vs the agreed date/time converted from the agreed IANA timezone (end of day assumed and labelled if no time). Revisions: count of revision requests vs allowance.

## Security notes

- Every deal access goes through `loadDealForUser`; outsiders get 404.
- Server actions have Next.js origin checks; mutating route handlers call `assertSameOrigin`; cookies are HttpOnly, SameSite=Lax, Secure on HTTPS.
- CSP restricts scripts/frames to self + PayPal; `frame-ancestors 'none'`; `Referrer-Policy: no-referrer` (invite tokens are in URLs).
- Uploads: size and count limits, magic-byte allowlist (PNG, JPEG, SVG, PDF, ZIP), SVG scanned for scripts/handlers/external refs, PDF for JavaScript/launch actions; never rendered by the app.
- Exports omit emails and PayPal payer IDs; logs never print secrets.
- Retention: the seller can delete an agreement (cascade delete of sources, versions, files, history). PayPal's records are unaffected.
