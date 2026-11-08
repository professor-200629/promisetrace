import type { Db } from "@/lib/db";
import { deadlineInstant, type BriefContent, type SourceRef } from "@/lib/brief";
import { formatMoney } from "@/lib/money";
import { refIsValid } from "@/lib/sources";
import { loadDealForUser, type Role } from "@/lib/services/access";
import { parseContent, versionState } from "@/lib/services/briefs";
import { paymentSummary } from "@/lib/services/payments";
import { allFileFacts } from "@/lib/services/delivery";
import { computeChecks, type Check } from "@/lib/services/checks";
import { openObjections } from "@/lib/services/buyer";
import { EVENT_KIND_LABEL, verifyChain, type EventKind } from "@/lib/services/events";

export type RowResult = "MET" | "NOT_MET" | "NEEDS_REVIEW" | "PENDING" | "NOT_CHECKABLE";

export type RequirementRow = {
  key: string;
  group: string;
  label: string;
  agreed: string;
  agreedStatus: BriefContent["price"]["status"];
  refs: SourceRef[];
  observed: string;
  observedBy: "PromiseTrace checks" | "PayPal API" | "PayPal (FIXTURE)" | "Buyer statement" | "Nothing yet";
  result: RowResult;
  buyerResponse: string | null;
};

const CHECK_TO_ROW: Record<Check["result"], RowResult> = { PASS: "MET", FAIL: "NOT_MET", NEEDS_REVIEW: "NEEDS_REVIEW", NOT_CHECKABLE: "NOT_CHECKABLE" };

export async function buildDealView(db: Db, dealId: string, userId: string) {
  const { deal, role } = await loadDealForUser(db, dealId, userId);
  return buildView(db, deal.id, role);
}

export async function buildView(db: Db, dealId: string, role: Role) {
  const st = await versionState(db, dealId);
  const deal = st.deal;
  const [seller, buyer, sources, pay, deliveries, buyerActions, events, aiRuns, objections] = await Promise.all([
    db.user.findUnique({ where: { id: deal.sellerId }, select: { name: true } }),
    deal.buyerId ? db.user.findUnique({ where: { id: deal.buyerId }, select: { name: true } }) : null,
    db.sourceDocument.findMany({ where: { dealId }, orderBy: { label: "asc" } }),
    paymentSummary(db, dealId),
    db.delivery.findMany({ where: { dealId }, orderBy: { number: "asc" }, include: { files: { orderBy: { receivedAt: "asc" } }, checks: true } }),
    db.buyerAction.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } }),
    db.event.findMany({ where: { dealId }, orderBy: { seq: "asc" } }),
    db.aiRun.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } }),
    openObjections(db, dealId),
  ]);

  const working = st.working ? { row: st.working, content: parseContent(st.working) } : null;
  const effective = st.effective ? { row: st.effective, content: parseContent(st.effective) } : null;
  const basis = effective ?? working; // what the requirement table shows
  const facts = await allFileFacts(db, dealId);
  const latestDeliveryAt = deliveries.at(-1)?.submittedAt ?? null;
  const checks = effective ? computeChecks(effective.content, facts, { latestDeliveryAt }) : [];
  const revisionRequests = buyerActions.filter((a) => a.type === "REQUEST_REVISION").length;
  const lastBuyer = (keys: string[]) => {
    const relevant = [...buyerActions].reverse().find((a) => {
      const k = JSON.parse(a.requirementKeys) as string[];
      return k.some((x) => keys.includes(x));
    });
    return relevant ? `${actionLabel(relevant.type)}${relevant.message ? `: "${relevant.message.slice(0, 140)}"` : ""}` : null;
  };

  const rows: RequirementRow[] = [];
  if (basis) {
    const b = basis.content;
    // Price / payment
    const p = pay.latest;
    const paypalLabel = p?.mode === "FIXTURE" ? "PayPal (FIXTURE)" : "PayPal API";
    rows.push({
      key: "price", group: "Payment", label: "Price",
      agreed: b.price.amountMinor !== null && b.price.currency ? formatMoney(b.price.amountMinor, b.price.currency) : "Not agreed",
      agreedStatus: b.price.status, refs: b.price.refs,
      observed: !p ? "No checkout yet" : p.status === "COMPLETED" ? `Capture ${p.captureId} COMPLETED, ${p.grossValue ?? ""} ${p.currency}${p.mode === "FIXTURE" ? " (FIXTURE, not a PayPal transaction)" : ""}` : `PayPal status: ${p.status}${p.statusReason ? ` (${p.statusReason})` : ""}`,
      observedBy: p ? paypalLabel : "Nothing yet",
      result: !p ? "PENDING" : p.status === "COMPLETED" ? "MET" : p.status === "CAPTURE_PENDING" || p.status === "ORDER_CREATED" ? "PENDING" : "NEEDS_REVIEW",
      buyerResponse: lastBuyer(["price"]),
    });
    // Deliverables
    for (const d of b.deliverables) {
      const mine = checks.filter((c) => c.requirementKey.startsWith(`${d.key}:`));
      const agreed = `${d.quantity !== null ? `${d.quantity} × ` : ""}${d.label}${d.formats.length ? ` (${d.formats.map((f) => f.toUpperCase()).join(", ")})` : ""}`;
      if (mine.length === 0) {
        rows.push({ key: d.key, group: "Deliverables", label: d.label, agreed, agreedStatus: d.status, refs: d.refs, observed: effective ? "Nothing delivered yet" : "Checked after payment", observedBy: "Nothing yet", result: "PENDING", buyerResponse: lastBuyer([d.key]) });
      }
      for (const c of mine) {
        rows.push({ key: c.requirementKey, group: "Deliverables", label: c.label, agreed: c.checkType === "FILE_INTEGRITY" ? c.expected : c.requirementKey.endsWith(":any") ? `${agreed} — no file format or count agreed` : `${agreed} — expects ${c.expected}`,
          agreedStatus: d.status, refs: d.refs, observed: c.observed, observedBy: "PromiseTrace checks",
          result: deliveries.length === 0 && c.result === "FAIL" ? "PENDING" : CHECK_TO_ROW[c.result], buyerResponse: lastBuyer([d.key]) });
      }
    }
    // Deadline
    const dc = checks.find((c) => c.requirementKey === "deadline");
    const dl = deadlineInstant(b.deadline);
    rows.push({
      key: "deadline", group: "Timing", label: "Deadline",
      agreed: b.deadline.date ? `${b.deadline.date}${b.deadline.time ? ` ${b.deadline.time}` : " (no time agreed)"} ${b.deadline.timezone ?? "(timezone not agreed)"}${dl ? ` = ${dl.utc.toISOString().replace(/:00\.000Z$/, "Z")}` : ""}` : "Not agreed",
      agreedStatus: b.deadline.status, refs: b.deadline.refs,
      observed: dc?.observed ?? (effective ? "Nothing delivered yet" : "Checked after payment"),
      observedBy: dc ? "PromiseTrace checks" : "Nothing yet",
      result: dc ? (deliveries.length === 0 && dc.result === "NOT_CHECKABLE" && dl ? "PENDING" : CHECK_TO_ROW[dc.result]) : "PENDING",
      buyerResponse: lastBuyer(["deadline"]),
    });
    // Revisions
    const allowed = b.revisionRounds.count;
    rows.push({
      key: "revisions", group: "Timing", label: "Revision rounds",
      agreed: allowed === null ? "Not agreed" : `${allowed} included`, agreedStatus: b.revisionRounds.status, refs: b.revisionRounds.refs,
      observed: `${revisionRequests} revision request${revisionRequests === 1 ? "" : "s"} recorded`,
      observedBy: revisionRequests ? "Buyer statement" : "Nothing yet",
      result: allowed === null ? "NOT_CHECKABLE" : revisionRequests > allowed ? "NEEDS_REVIEW" : revisionRequests === 0 ? "PENDING" : "MET",
      buyerResponse: lastBuyer(["revisions"]),
    });
  }

  const acceptance = [...buyerActions].reverse().find((a) => a.type === "ACCEPT" || a.type === "ACKNOWLEDGE_RECEIPT") ?? null;
  const summary = {
    agreed: st.paid ? `Paid agreement: version ${st.paid.number}${effective && effective.row.id !== st.paid.id ? `, amended by version ${effective.row.number}` : ""}` : st.workingApproved ? `Version ${working!.row.number} approved by both — awaiting payment` : working ? `Version ${working.row.number} — approvals pending` : "No brief yet",
    observed: deliveries.length ? `${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"}, ${facts.length} file(s)` : "Nothing delivered",
    needsReview: rows.filter((r) => r.result === "NOT_MET" || r.result === "NEEDS_REVIEW").length + objections.length,
    met: rows.filter((r) => r.result === "MET").length,
    total: rows.length,
  };

  const sourceTexts = sources.map((s) => ({ label: s.label, text: s.text }));
  const invalidRefs = rows.flatMap((r) => r.refs).filter((r) => !refIsValid(r, sourceTexts)).length;

  return {
    deal: { id: deal.id, title: deal.title, createdAt: deal.createdAt, hasBuyer: !!deal.buyerId, inviteOpen: !!deal.inviteTokenHash },
    role,
    participants: { seller: seller?.name ?? "Seller", buyer: buyer?.name ?? null },
    sources: sources.map((s) => ({ label: s.label, title: s.title, kind: s.kind, text: s.text, sha256: s.sha256, createdAt: s.createdAt })),
    versions: st.versions.map((v) => ({
      id: v.id, number: v.number, kind: v.kind, origin: v.origin, contentHash: v.contentHash, createdAt: v.createdAt, supersededAt: v.supersededAt, lockedAt: v.lockedAt,
      approvals: v.approvals.map((a) => ({ role: a.role, createdAt: a.createdAt, valid: a.contentHash === v.contentHash && !v.supersededAt })),
      approved: st.isApproved(v),
    })),
    working, effective, workingApproved: st.workingApproved, paidVersionId: st.paid?.id ?? null,
    payment: pay,
    deliveries: deliveries.map((d) => ({
      id: d.id, number: d.number, submittedAt: d.submittedAt, note: d.note, versionId: d.versionId,
      files: d.files.map((f) => ({ id: f.id, name: f.originalName, deliverableKey: f.deliverableKey, sizeBytes: f.sizeBytes, sha256: f.sha256, detectedType: f.detectedType, declaredExt: f.declaredExt, widthPx: f.widthPx, heightPx: f.heightPx, safetyNotes: JSON.parse(f.safetyNotes) as string[], receivedAt: f.receivedAt })),
      checks: d.checks.map((c) => ({ requirementKey: c.requirementKey, result: c.result, expected: c.expected, observed: c.observed })),
    })),
    checks,
    buyerActions: buyerActions.map((a) => ({ id: a.id, type: a.type, message: a.message, requirementKeys: JSON.parse(a.requirementKeys) as string[], createdAt: a.createdAt, refersToId: a.refersToId, deliveryId: a.deliveryId })),
    openObjections: objections.map((o) => o.id),
    acceptance: acceptance ? { type: acceptance.type, createdAt: acceptance.createdAt } : null,
    rows, summary, invalidRefs,
    events: events.map((e) => ({ seq: e.seq, type: e.type, kind: e.kind as EventKind, kindLabel: EVENT_KIND_LABEL[e.kind as EventKind], actorRole: e.actorRole, summary: e.summary, createdAt: e.createdAt, hash: e.hash, data: JSON.parse(e.data) as Record<string, unknown> })),
    chainBrokenAt: verifyChain(events),
    aiRuns: aiRuns.map((r) => ({ id: r.id, provider: r.provider, model: r.model, status: r.status, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsdMicros / 1e6, latencyMs: r.latencyMs, createdAt: r.createdAt, error: r.error })),

  };
}

export type DealView = Awaited<ReturnType<typeof buildView>>;

export function actionLabel(type: string): string {
  return ({ ACKNOWLEDGE_RECEIPT: "Acknowledged receipt", ACCEPT: "Accepted", REQUEST_REVISION: "Requested revision", REPORT_PROBLEM: "Reported a problem", WITHDRAW_OBJECTION: "Withdrew objection" } as Record<string, string>)[type] ?? type;
}

/** Portable evidence record. Emails and PayPal payer IDs are excluded; every item says what kind of assertion it is. */
export function evidenceJson(v: DealView) {
  const kindOf = (k: EventKind) => ({ SYSTEM_CONFIRMED: "system_observed", PAYPAL_CONFIRMED: "paypal_api_confirmed", USER_DECLARATION: "participant_declaration", AI_INTERPRETATION: "ai_interpretation" })[k];
  const p = v.payment.latest;
  return {
    format: "promisetrace.evidence.v1",
    generatedAt: new Date().toISOString(),
    disclaimer: "PromiseTrace records what was agreed, paid, delivered and stated. It does not hold funds, decide PayPal claims or guarantee PayPal Seller Protection. File hashes show whether a file changed; they do not prove the work is correct.",
    agreement: { id: v.deal.id, title: v.deal.title, createdAt: v.deal.createdAt, seller: v.participants.seller, buyer: v.participants.buyer },
    sources: v.sources.map((s) => ({ label: s.label, title: s.title, kind: s.kind, sha256: s.sha256, text: s.text })),
    versions: v.versions.map((x) => ({ number: x.number, kind: x.kind, origin: x.origin, contentHash: x.contentHash, createdAt: x.createdAt, superseded: !!x.supersededAt, paidAndLocked: !!x.lockedAt, approvals: x.approvals, approvedByBoth: x.approved })),
    agreedBrief: v.effective?.content ?? v.working?.content ?? null,
    payment: p ? { mode: p.mode, status: p.status, statusReason: p.statusReason, amount: formatMoney(p.amountMinor, p.currency), paypalOrderId: p.paypalOrderId, captureId: p.captureId, invoiceId: p.invoiceId, customId: p.customId, gross: p.grossValue, fee: p.feeValue, net: p.netValue, completedAt: p.completedAt, assertionType: p.mode === "FIXTURE" ? "fixture_not_paypal" : "paypal_api_confirmed" } : null,
    requirements: v.rows.map((r) => ({ key: r.key, label: r.label, agreed: r.agreed, agreedStatus: r.agreedStatus, sourcePassages: r.refs.map((ref) => ({ source: ref.source, start: ref.start, end: ref.end, quote: ref.quote })), observed: r.observed, observedBy: r.observedBy, result: r.result, buyerResponse: r.buyerResponse })),
    deliveries: v.deliveries.map((d) => ({ number: d.number, submittedAt: d.submittedAt, note: d.note ? { text: d.note, assertionType: "participant_declaration" } : null, files: d.files.map((f) => ({ name: f.name, deliverable: f.deliverableKey, sha256: f.sha256, bytes: f.sizeBytes, detectedType: f.detectedType, receivedAt: f.receivedAt, notes: f.safetyNotes })), checksAtSubmission: d.checks })),
    buyerActions: v.buyerActions.map((a) => ({ ...a, assertionType: "participant_declaration" })),
    openObjections: v.openObjections,
    aiRuns: v.aiRuns.map((r) => ({ provider: r.provider, model: r.model, status: r.status, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, latencyMs: r.latencyMs, assertionType: "ai_interpretation" })),
    history: { hashChainIntact: v.chainBrokenAt === null, firstBrokenSeq: v.chainBrokenAt, events: v.events.map((e) => ({ seq: e.seq, at: e.createdAt, type: e.type, assertionType: kindOf(e.kind), actor: e.actorRole, summary: e.summary, hash: e.hash })) },
  };
}
