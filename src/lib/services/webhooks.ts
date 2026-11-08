import type { Db } from "@/lib/db";
import { appendEvent } from "@/lib/services/events";
import { applyCaptureState } from "@/lib/services/payments";
import type { PayPalCapture, PayPalGateway } from "@/lib/paypal/gateway";

type WebhookBody = {
  id?: string;
  event_type?: string;
  resource_type?: string;
  resource?: Record<string, unknown>;
  create_time?: string;
};

export type WebhookOutcome = { status: "DUPLICATE" | "APPLIED" | "IGNORED" | "NO_MATCH" | "INVALID"; note?: string };

const CAPTURE_EVENTS: Record<string, string | undefined> = {
  "PAYMENT.CAPTURE.COMPLETED": undefined, // use capture.status
  "PAYMENT.CAPTURE.PENDING": undefined,
  "PAYMENT.CAPTURE.DENIED": "DECLINED",
  "PAYMENT.CAPTURE.DECLINED": "DECLINED",
  "PAYMENT.CAPTURE.REFUNDED": "REFUNDED",
  "PAYMENT.CAPTURE.REVERSED": "REVERSED",
};

/**
 * Process a webhook whose signature has ALREADY been verified by the route.
 * Idempotent by PayPal event id: a redelivered event is recorded once and
 * ignored afterwards. When a sandbox gateway is available the capture is
 * re-read from PayPal so the stored status reflects PayPal's current state.
 */
export async function processVerifiedWebhook(db: Db, rawBody: string, opts: { transmissionId?: string; verifyMethod: "SELF" | "FIXTURE"; gateway?: PayPalGateway | null }): Promise<WebhookOutcome> {
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return { status: "INVALID", note: "Body is not JSON" };
  }
  if (!body.id || !body.event_type) return { status: "INVALID", note: "Missing id or event_type" };

  const resource = (body.resource ?? {}) as Record<string, unknown>;
  const resourceId = typeof resource.id === "string" ? resource.id : null;
  try {
    await db.webhookEvent.create({
      data: { id: body.id, eventType: body.event_type, resourceType: body.resource_type ?? null, resourceId, transmissionId: opts.transmissionId ?? null, verified: true, verifyMethod: opts.verifyMethod, outcome: "IGNORED" },
    });
  } catch {
    return { status: "DUPLICATE", note: `Event ${body.id} already processed` };
  }

  const finish = async (status: WebhookOutcome["status"], note?: string) => {
    await db.webhookEvent.update({ where: { id: body.id }, data: { outcome: status === "APPLIED" ? "APPLIED" : status, note: note ?? null, processedAt: new Date() } });
    return { status, note };
  };

  const type = body.event_type;
  if (type in CAPTURE_EVENTS) {
    // For capture events the resource is the capture; for refund/reversal it is the refund, linked "up" to the capture.
    const links = (resource.links as Array<{ rel?: string; href?: string }> | undefined) ?? [];
    const up = links.find((l) => l.rel === "up" && l.href?.includes("/captures/"))?.href;
    const captureId = up ? up.split("/captures/")[1]!.split(/[/?]/)[0]! : resourceId;
    const orderId = ((resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id) ?? null;
    const payment =
      (captureId ? await db.payment.findUnique({ where: { captureId } }) : null) ??
      (orderId ? await db.payment.findUnique({ where: { paypalOrderId: orderId } }) : null);
    if (!payment) return finish("NO_MATCH", `No payment for capture ${captureId ?? "?"} / order ${orderId ?? "?"}`);

    let capture: PayPalCapture;
    if (up || type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
      capture = { id: captureId!, status: CAPTURE_EVENTS[type] ?? "REFUNDED", custom_id: payment.customId, invoice_id: payment.invoiceId };
    } else {
      capture = resource as unknown as PayPalCapture;
    }
    if (opts.gateway && captureId && opts.gateway.mode === "SANDBOX") {
      try {
        const live = await opts.gateway.getCapture(captureId);
        capture = { ...live, status: CAPTURE_EVENTS[type] === "REVERSED" ? "REVERSED" : live.status };
      } catch {
        /* fall back to the signed webhook body */
      }
    }
    const forced = CAPTURE_EVENTS[type] === "REVERSED" ? "REVERSED" : CAPTURE_EVENTS[type] === "DECLINED" ? "DECLINED" : undefined;
    try {
      await applyCaptureState(db, payment, capture, { actorId: null, source: `webhook ${type} (${body.id})`, forcedStatus: forced });
    } catch (e) {
      return finish("APPLIED", `Recorded with problem: ${e instanceof Error ? e.message : "error"}`);
    }
    return finish("APPLIED");
  }

  if (type === "CHECKOUT.ORDER.APPROVED") {
    const payment = resourceId ? await db.payment.findUnique({ where: { paypalOrderId: resourceId } }) : null;
    if (!payment) return finish("NO_MATCH");
    const fresh = await db.payment.findUnique({ where: { id: payment.id } });
    const captured = fresh?.status === "COMPLETED";
    await db.$transaction((tx) => appendEvent(tx, { dealId: payment.dealId, type: "PAYPAL_BUYER_APPROVED", kind: "PAYPAL_CONFIRMED", actorRole: "PAYPAL",
      summary: captured
        ? `Signed PayPal webhook confirms the buyer approved order ${resourceId} (the capture had already been confirmed).`
        : `PayPal reports the buyer approved order ${resourceId}. Approval is not payment; capture is still required.`,
      data: { orderId: resourceId, webhookEvent: body.id, alreadyCaptured: captured } }));
    return finish("APPLIED");
  }

  if (type.startsWith("CUSTOMER.DISPUTE.")) {
    const txs = (resource.disputed_transactions as Array<{ seller_transaction_id?: string }> | undefined) ?? [];
    for (const t of txs) {
      const payment = t.seller_transaction_id ? await db.payment.findUnique({ where: { captureId: t.seller_transaction_id } }) : null;
      if (!payment) continue;
      await db.$transaction((tx) => appendEvent(tx, { dealId: payment.dealId, type: "PAYPAL_DISPUTE_NOTICE", kind: "PAYPAL_CONFIRMED", actorRole: "PAYPAL",
        summary: `PayPal webhook ${type}: dispute ${String(resource.dispute_id ?? resourceId ?? "")} on capture ${t.seller_transaction_id}. This is an official PayPal case; resolve it in PayPal.`,
        data: { disputeId: resource.dispute_id ?? resourceId, status: resource.status, reason: resource.reason } }));
      return finish("APPLIED");
    }
    return finish("NO_MATCH");
  }

  return finish("IGNORED", `Event type ${type} is not used by PromiseTrace`);
}
