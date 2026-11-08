import type { Tx } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/hash";

export type EventKind = "SYSTEM_CONFIRMED" | "PAYPAL_CONFIRMED" | "USER_DECLARATION" | "AI_INTERPRETATION";
export type ActorRole = "SELLER" | "BUYER" | "SYSTEM" | "PAYPAL" | "AI";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  SYSTEM_CONFIRMED: "Recorded by PromiseTrace",
  PAYPAL_CONFIRMED: "Confirmed by PayPal API",
  USER_DECLARATION: "Stated by a participant",
  AI_INTERPRETATION: "AI interpretation",
};

export type NewEvent = {
  dealId: string;
  type: string;
  kind: EventKind;
  actorId?: string | null;
  actorRole: ActorRole;
  summary: string;
  data?: Record<string, unknown>;
};

export function eventHash(prevHash: string, e: { dealId: string; seq: number; type: string; kind: string; actorId: string | null; actorRole: string | null; summary: string; data: string; createdAt: Date }): string {
  return sha256Hex(
    prevHash +
      canonicalJson({
        dealId: e.dealId, seq: e.seq, type: e.type, kind: e.kind, actorId: e.actorId,
        actorRole: e.actorRole, summary: e.summary, data: e.data, createdAt: e.createdAt.toISOString(),
      }),
  );
}

/** Append to the deal's hash-chained history. Must run inside the caller's transaction. */
export async function appendEvent(tx: Tx, e: NewEvent) {
  const last = await tx.event.findFirst({ where: { dealId: e.dealId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? "GENESIS";
  const createdAt = new Date();
  const data = canonicalJson(e.data ?? {});
  const row = { dealId: e.dealId, seq, type: e.type, kind: e.kind, actorId: e.actorId ?? null, actorRole: e.actorRole, summary: e.summary, data, createdAt };
  return tx.event.create({ data: { ...row, prevHash, hash: eventHash(prevHash, row) } });
}

/** Recompute the chain; returns the first broken sequence number, or null when intact. */
export function verifyChain(events: Array<{ dealId: string; seq: number; type: string; kind: string; actorId: string | null; actorRole: string | null; summary: string; data: string; createdAt: Date; prevHash: string; hash: string }>): number | null {
  let prev = "GENESIS";
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    if (ev.prevHash !== prev || eventHash(prev, ev) !== ev.hash) return ev.seq;
    prev = ev.hash;
  }
  return null;
}
