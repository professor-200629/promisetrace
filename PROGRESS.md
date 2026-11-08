# PromiseTrace progress log

Deadline: Devpost submission closes **Thu 12 Nov 2026 12:00 PT = Fri 13 Nov 01:30 IST**. Target: complete by 12 Nov 21:00 IST. Judging 1–15 Dec 2026 (keep the demo usable).

## Done (8 Nov 2026)

- Rules and judging criteria read; PayPal Orders v2 schema (v2.36), idempotency and webhook docs checked; policy and competitor research in `docs/research/`.
- App: brief extraction (Claude + code validation), two-party approval with immutable versions, PayPal create/capture/webhooks, delivery checks, buyer actions, requirement table, hash-chained history, HTML/JSON export, setup states, fixture modes, demo seed, retention script.
- Verification: typecheck, lint, build clean; 32 Vitest tests; Playwright journey; 4 scenarios; rule-based baseline benchmark. Details: `docs/VERIFICATION.md`.
- Docs: README, architecture, deployment (Render + Turso), evaluation, interview script, pilot hypothesis, Devpost draft, demo script, judging review.

## Done (8 Nov 2026, evening)

- Live Claude check + 2 benchmark runs (precision 1.00, recall 0.95-0.97, about $0.21 per run).
- Live PayPal sandbox: paypal:check passed; full browser journey with real Claude and a COMPLETED sandbox capture (guest card, PayPal test Visa); missing SVG flagged and fixed; record exported to docs/sample-evidence/.
- Fixed: explicit AI_BASE_URL (machine-wide ANTHROPIC_BASE_URL pointed to a dead local proxy).

## Blocked on the author

1. Optional: a US sandbox Personal account (developer dashboard) to also show the PayPal-wallet path in the video.
3. Accounts for hosting (Render, Turso) if a hosted demo is wanted; GitHub publish approval.
4. Recording the demo video; optional seller interviews.

## Next concrete steps

- Live sandbox proof → update VERIFICATION.md §5.
- Live Claude run → EVALUATION.md.
- Webhook test through a public URL (hosted demo) → VERIFICATION.md.
- Screenshots for Devpost; accessibility pass; publish repo after review.
