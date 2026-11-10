# Deployment

The judging build must stay usable from submission (12 Nov 2026) until winners are announced (about 21 Dec 2026; judging ends 15 Dec, 08:00 PT). Two supported options:

## A. Judges run it locally (always available)

The README's quick start works on Windows, macOS and Linux with only Node.js. Judges can use their own PayPal sandbox app, or `PAYPAL_MODE=fixture` / `AI_PROVIDER=fixture` for an offline, clearly labelled walkthrough.

## B. Hosted demo (live): Vercel + Turso

The judging build runs at **https://promisetrace-sandbox.vercel.app** (Vercel Hobby, functions in iad1) with a Turso database in AWS us-east-1. Deployed with the Vercel CLI from the local checkout (`npx vercel deploy --prod`), environment variables stored in Vercel (secrets marked sensitive), migrations applied with `DATABASE_URL=<libsql url> DATABASE_AUTH_TOKEN=<token> npx tsx scripts/migrate-libsql.ts`, demo accounts with `npx tsx prisma/seed.ts`. A daily Vercel cron calls `/api/health` so the database never sits idle during judging. The Turso token expires about 6 Feb 2027 (90 days), after judging ends. The sandbox webhook (`5KH82963RX958642Y`) is subscribed to 12 events: the capture, order, dispute and `PAYMENT.AUTHORIZATION.CREATED` / `VOIDED` events. Vercel limits function request and response bodies to 4.5 MB, so uploads are capped at 4 MiB per file and per delivery.

## C. Alternative: Render (free) + Turso (free)

Files are stored in the database, so the only persistent state is the database. A free Render web service has an ephemeral disk, so the database lives in Turso (hosted libSQL), which the Prisma libSQL adapter supports.

1. **Turso** (turso.tech, free plan): create a database in a region near Render's (e.g. `aws-ap-south-1`), then create an auth token. You need `libsql://<db>-<org>.turso.io` and the token.
2. **Render** (render.com): New → Blueprint → connect the public GitHub repo → it reads `render.yaml`.
3. In the Render dashboard set: `APP_URL` (the service URL, e.g. `https://promisetrace.onrender.com`), `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`. `BETTER_AUTH_SECRET` is generated.
4. Deploy. The start command applies migrations (`scripts/migrate-libsql.ts`, non-destructive), creates the fictional demo accounts, and starts Next.js.
5. **Webhooks**: in the PayPal developer dashboard (sandbox app → Webhooks) add `https://<service>/api/paypal/webhook` and subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED` (and optionally `CUSTOMER.DISPUTE.*`). Copy the Webhook ID into `PAYPAL_WEBHOOK_ID` and redeploy.
6. Smoke test: sign in with the demo seller, run the core path with a sandbox buyer, and check **Setup status**.

Notes:
- Render free services sleep after inactivity; the first request can take about a minute. Say so in the Devpost testing instructions.
- Keep the AI daily cap low (`AI_DAILY_CALL_LIMIT`) on a public demo so a judge or a bot cannot spend the API budget. Anthropic API usage is prepaid credit; check that auto-reload is off if you do not want overage.
- Do not rotate the sandbox credentials, change the demo password or delete the Turso database before 22 Dec 2026 (after winners are announced on about 21 Dec).

## Production would need (not done)

- **Multi-merchant:** this build is ordinary single-merchant Checkout — every payment goes to the one sandbox merchant configured on the server. Collecting payments for many sellers through one account is payment aggregation, which PayPal's developer policy does not allow, and in India it would need an RBI cross-border payment-aggregator authorisation. The route is for each seller to be the payee on their own PayPal account, with PromiseTrace only sending capture/void instructions. A marketplace where each seller is paid directly needs PayPal's partner/platform onboarding (Partner Referrals API to onboard sellers, payee or `PayPal-Auth-Assertion` on calls, PayPal approval of the platform). See `docs/research/policy-and-landscape.md` §4.
- **India:** an Indian seller can receive only international payments through PayPal and needs PAN verification, a bank account and an RBI purpose code; Seller Protection excludes "Significantly Not as Described" claims. A sandbox success says nothing about production eligibility.
- Object storage for large files, background jobs for webhook retries/re-checks, email notifications, rate limiting at the edge, a proper data-processing agreement and privacy policy.
