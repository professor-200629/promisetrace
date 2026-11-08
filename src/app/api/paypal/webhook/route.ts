import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env, paypalSetup } from "@/lib/env";
import { readWebhookHeaders, verifyWebhookSignature } from "@/lib/paypal/webhook-verify";
import { processVerifiedWebhook } from "@/lib/services/webhooks";
import { getGateway } from "@/lib/services/payments";

/**
 * PayPal webhook listener. The signature is verified on the raw body before
 * anything is parsed. Unverified requests get 400 and change nothing.
 * Verified duplicates get 200 so PayPal stops retrying.
 */
export async function POST(req: Request) {
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > 256 * 1024) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  const headers = readWebhookHeaders(req.headers);
  if (!headers) return NextResponse.json({ error: "Missing PayPal transmission headers" }, { status: 400 });
  const webhookId = env().PAYPAL_WEBHOOK_ID ?? "";
  const verdict = await verifyWebhookSignature({ headers, rawBody: raw, webhookId });
  if (!verdict.ok) {
    console.warn("[webhook] rejected:", verdict.reason);
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }
  const gateway = paypalSetup().state === "ready" ? getGateway() : null;
  const out = await processVerifiedWebhook(prisma, new TextDecoder().decode(raw), { transmissionId: headers.transmissionId, verifyMethod: "SELF", gateway });
  return NextResponse.json({ status: out.status }, { status: out.status === "INVALID" ? 400 : 200 });
}
