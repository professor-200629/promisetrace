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

## Done (10 Nov 2026)

- Public repo: https://github.com/professor-200629/promisetrace (MIT, detected by GitHub). Pre-publish checks: secret scan of full history clean; typecheck, lint, 33 tests, build, Playwright journey all pass.
- Hosted demo: https://promisetrace-sandbox.vercel.app (Vercel + Turso), logged-in journey and real signed webhooks verified 8 Nov.

## Done (10 Nov 2026, evening) — hold at checkout, capture on acceptance

- Live feasibility check on the Indian sandbox merchant: authorize, partial capture and void all work on the JS SDK path (VERIFICATION 5c).
- Built: checkout with intent AUTHORIZE by default (`CHECKOUT_INTENT`), hold funds and locks the agreement and opens delivery; buyer Accept captures; seller capture after a 5-day review window (`REVIEW_WINDOW_DAYS`) only with every check met and no open objection; seller cancel and missed-deadline buyer release void the hold; `PAYMENT.AUTHORIZATION.CREATED/VOIDED` webhooks; payment record, history, HTML/JSON export and wording updated. Additive migration `20261110000000_payment_holds`.
- Verified: typecheck, lint, build; 57 tests (24 new); Playwright journey; 5/5 scenarios; hosted live run hold → accept → capture COMPLETED with signed webhooks and `paypal:verify` MATCH (VERIFICATION 5d). Not run live in the app: the void path (API verified live in 5c).

## Blocked on the author

1. Optional: a US sandbox Personal account (developer dashboard) to also show the PayPal-wallet path in the video.
2. Accounts for hosting (Render, Turso) if a hosted demo is wanted; GitHub publish approval.
3. Recording the demo video; optional seller interviews.

## Next concrete steps

- Hosted demo (Render + Turso) so judges can try it and so a signed sandbox webhook can be tested → VERIFICATION.md.
- Root-cause the next dev hot-reload loop (production build works).
- Demo video from the live sandbox; Devpost text placeholders; publish repo after review.
