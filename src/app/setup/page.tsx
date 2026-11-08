import { aiSetup, env, paypalSetup } from "@/lib/env";
import { Card, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function Setup() {
  const pp = paypalSetup();
  const ai = aiSetup();
  const e = env();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Setup status</h1>
      <p className="text-sm text-muted">This page shows which integrations are configured. It never shows secret values.</p>
      <Card title="PayPal (sandbox only)">
        <p className="text-sm">
          Status:{" "}
          {pp.state === "ready" ? <Pill tone="agreed">Sandbox credentials present</Pill> : pp.state === "fixture" ? <Pill tone="review">FIXTURE mode — no PayPal calls</Pill> : <Pill tone="bad">Missing {pp.missing.join(", ")}</Pill>}
        </p>
        <p className="mt-2 text-sm">Webhook verification: {e.PAYPAL_WEBHOOK_ID ? <Pill tone="agreed">PAYPAL_WEBHOOK_ID set</Pill> : <Pill tone="review">PAYPAL_WEBHOOK_ID not set — webhooks are rejected</Pill>}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Sign in at developer.paypal.com and open Apps &amp; Credentials with the Sandbox toggle on.</li>
          <li>Create (or open) a Merchant app and copy its Client ID and Secret into <code>.env</code> as PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.</li>
          <li>Use the sandbox Personal account (Testing Tools → Sandbox Accounts) to approve checkouts.</li>
          <li>For webhooks, add your public HTTPS URL + <code>/api/paypal/webhook</code> to the app and copy the Webhook ID into PAYPAL_WEBHOOK_ID.</li>
        </ol>
      </Card>
      <Card title="AI (runtime API access)">
        <p className="text-sm">
          Status:{" "}
          {ai.state === "ready" ? <Pill tone="agreed">Anthropic API key present · model {ai.model}</Pill> : ai.state === "fixture" ? <Pill tone="review">Rule-based FIXTURE extractor (not AI)</Pill> : <Pill tone="bad">ANTHROPIC_API_KEY missing — manual entry</Pill>}
        </p>
        <p className="mt-2 text-sm text-muted">
          Budget controls: effort {e.AI_EFFORT}, max {e.AI_MAX_OUTPUT_TOKENS} output tokens per call, {e.AI_MAX_INPUT_CHARS} input characters, {e.AI_DAILY_CALL_LIMIT} calls per UTC day.
          A Claude subscription used for coding is separate from this API key; API usage is billed to the API account that owns the key.
        </p>
      </Card>
    </div>
  );
}
