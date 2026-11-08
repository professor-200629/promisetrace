import type { Db, Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { canonicalJson, randomToken, sha256Hex } from "@/lib/hash";
import { BriefContentSchema, gapQuestions, paymentBlockers, renumberQuestions, type BriefContent } from "@/lib/brief";
import { appendEvent } from "@/lib/services/events";
import { loadDealForUser, requireRole, type Role } from "@/lib/services/access";
import { proposeBrief } from "@/lib/ai/extract";
import { formatMoney } from "@/lib/money";

type VersionRow = { id: string; number: number; kind: string; content: string; contentHash: string; supersededAt: Date | null; lockedAt: Date | null; parentVersionId: string | null; createdAt: Date };

export function parseContent(v: { content: string }): BriefContent {
  return BriefContentSchema.parse(JSON.parse(v.content));
}

export function hashContent(c: BriefContent): string {
  return sha256Hex(canonicalJson(c));
}

// ---------------- deal creation & invites ----------------

export async function createDeal(db: Db, sellerId: string, input: { title: string; sourceTitle: string; sourceKind: "PASTED_BRIEF" | "CONVERSATION" | "PDF_TEXT"; sourceText: string }) {
  const title = input.title.trim().slice(0, 120);
  const text = input.sourceText.replace(/\r\n/g, "\n").trim();
  if (!title) throw new AppError("INVALID", "Give the agreement a title.");
  if (text.length < 20) throw new AppError("INVALID", "Paste the brief or conversation (at least 20 characters).");
  if (text.length > 60_000) throw new AppError("INVALID", "Source is too long for this MVP (60,000 characters max).");
  const inviteToken = randomToken();
  const deal = await db.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: { title, sellerId, inviteTokenHash: sha256Hex(inviteToken), inviteExpiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) },
    });
    const src = await tx.sourceDocument.create({
      data: { dealId: deal.id, label: "S1", kind: input.sourceKind, title: input.sourceTitle.trim().slice(0, 120) || "Pasted brief", text, sha256: sha256Hex(text), addedById: sellerId },
    });
    await appendEvent(tx, { dealId: deal.id, type: "DEAL_CREATED", kind: "SYSTEM_CONFIRMED", actorId: sellerId, actorRole: "SELLER", summary: `Seller created "${title}".` });
    await appendEvent(tx, { dealId: deal.id, type: "SOURCE_ADDED", kind: "USER_DECLARATION", actorId: sellerId, actorRole: "SELLER",
      summary: `Seller added source S1 "${src.title}" (${text.length} characters).`, data: { source: "S1", sha256: src.sha256 } });
    return deal;
  });
  return { deal, inviteToken };
}

export async function regenerateInvite(db: Db, dealId: string, userId: string) {
  const { deal, role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "SELLER", "create invite links");
  if (deal.buyerId) throw new AppError("CONFLICT", "A buyer has already joined this agreement.");
  const token = randomToken();
  await db.deal.update({ where: { id: dealId }, data: { inviteTokenHash: sha256Hex(token), inviteExpiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) } });
  return token;
}

export async function acceptInvite(db: Db, token: string, userId: string) {
  const deal = await db.deal.findUnique({ where: { inviteTokenHash: sha256Hex(token) } });
  if (!deal || deal.deletedAt) throw new AppError("NOT_FOUND", "This invite link is not valid. Ask the seller for a new one.");
  if (deal.inviteExpiresAt && deal.inviteExpiresAt < new Date()) throw new AppError("INVALID", "This invite link has expired. Ask the seller for a new one.");
  if (deal.sellerId === userId) throw new AppError("FORBIDDEN", "You created this agreement as the seller. The buyer must open the link with their own account.");
  if (deal.buyerId && deal.buyerId !== userId) throw new AppError("CONFLICT", "Another buyer already joined this agreement.");
  await db.$transaction(async (tx) => {
    await tx.deal.update({ where: { id: deal.id }, data: { buyerId: userId, inviteTokenHash: null, inviteExpiresAt: null } });
    await appendEvent(tx, { dealId: deal.id, type: "BUYER_JOINED", kind: "SYSTEM_CONFIRMED", actorId: userId, actorRole: "BUYER", summary: "Buyer joined through the private invite link." });
  });
  return deal.id;
}

// ---------------- versions ----------------

export async function listVersions(db: Db | Tx, dealId: string) {
  return db.briefVersion.findMany({ where: { dealId }, orderBy: { number: "asc" }, include: { approvals: true } });
}

export type VersionState = Awaited<ReturnType<typeof versionState>>;

/** Derived agreement state. Nothing here is stored; it is recomputed from immutable rows. */
export async function versionState(db: Db | Tx, dealId: string) {
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
  const versions = await listVersions(db, dealId);
  const working = [...versions].reverse().find((v) => !v.supersededAt) ?? null;
  const isApproved = (v: (typeof versions)[number]) => {
    const valid = v.approvals.filter((a) => a.contentHash === v.contentHash);
    return valid.some((a) => a.userId === deal.sellerId && a.role === "SELLER") && !!deal.buyerId && valid.some((a) => a.userId === deal.buyerId && a.role === "BUYER");
  };
  const paid = versions.find((v) => v.lockedAt) ?? null;
  const approvedAmendments = versions.filter((v) => v.kind === "AMENDMENT" && isApproved(v));
  const effective = approvedAmendments.at(-1) ?? paid;
  return {
    deal, versions, working, paid, effective, isApproved,
    workingApproved: working ? isApproved(working) : false,
  };
}

function markEdits(prev: BriefContent, next: BriefContent, role: Role): { content: BriefContent; changed: string[] } {
  const changed: string[] = [];
  const c = structuredClone(next);
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  if (!same({ a: prev.price.amountMinor, c: prev.price.currency }, { a: c.price.amountMinor, c: c.price.currency })) {
    changed.push("price"); c.price.status = "edited"; c.price.editedBy = role;
  }
  if (!same([prev.deadline.date, prev.deadline.time, prev.deadline.timezone], [c.deadline.date, c.deadline.time, c.deadline.timezone])) {
    changed.push("deadline"); c.deadline.status = "edited"; c.deadline.editedBy = role;
  }
  if (prev.revisionRounds.count !== c.revisionRounds.count) {
    changed.push("revisionRounds"); c.revisionRounds.status = "edited"; c.revisionRounds.editedBy = role;
  }
  for (const d of c.deliverables) {
    const old = prev.deliverables.find((x) => x.key === d.key);
    if (!old) { changed.push(`${d.key} (added)`); d.status = "edited"; d.editedBy = role; continue; }
    if (!same([old.label, old.quantity, old.formats], [d.label, d.quantity, d.formats])) {
      changed.push(d.key); d.status = "edited"; d.editedBy = role;
    }
  }
  for (const old of prev.deliverables) if (!c.deliverables.some((d) => d.key === old.key)) changed.push(`${old.key} (removed)`);
  if (prev.title !== c.title) changed.push("title");
  if (!same(prev.openQuestions.map((q) => q.text), c.openQuestions.map((q) => q.text))) changed.push("openQuestions");
  return { content: c, changed };
}

/**
 * Create the first version from the deal's sources using the configured AI
 * provider (or an empty manual brief if AI is unavailable).
 */
export async function proposeInitialBrief(db: Db, dealId: string, userId: string) {
  const { deal, role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "SELLER", "run extraction");
  const existing = await db.briefVersion.count({ where: { dealId } });
  if (existing > 0) throw new AppError("CONFLICT", "A brief already exists for this agreement.");
  const sources = await db.sourceDocument.findMany({ where: { dealId }, orderBy: { label: "asc" } });
  const outcome = await proposeBrief(db, { dealId, title: deal.title, sources: sources.map((s) => ({ label: s.label, title: s.title, text: s.text })) });
  const content = { ...outcome.brief, title: deal.title };
  if (outcome.status !== "OK") content.openQuestions = renumberQuestions(gapQuestions(content));
  await db.$transaction(async (tx) => {
    const v = await tx.briefVersion.create({
      data: { dealId, number: 1, kind: "ORIGINAL", origin: outcome.status === "OK" ? "AI_PROPOSED" : "MANUAL", content: canonicalJson(content), contentHash: hashContent(content), createdById: userId, aiRunId: outcome.aiRunId },
    });
    if (outcome.status === "OK") {
      const r = outcome.report!;
      await appendEvent(tx, {
        dealId, type: "BRIEF_PROPOSED", kind: "AI_INTERPRETATION", actorRole: "AI",
        summary: `${outcome.provider === "fixture" ? "Rule-based FIXTURE extractor (not AI)" : "AI"} proposed version 1: ${r.claimsAccepted} of ${r.claimsProposed} claims kept with verified passages; ${r.unsupportedClaims.length} dropped; ${r.quotesInvalid.length} quotes not found in the source.`,
        data: { versionId: v.id, aiRunId: outcome.aiRunId, provider: outcome.provider, report: r, costUsd: outcome.costUsd, latencyMs: outcome.latencyMs },
      });
    } else {
      await appendEvent(tx, { dealId, type: "BRIEF_STARTED_MANUALLY", kind: "SYSTEM_CONFIRMED", actorId: userId, actorRole: "SELLER",
        summary: `AI extraction unavailable (${outcome.status}): ${outcome.error ?? ""} Version 1 starts empty for manual entry.`, data: { versionId: v.id, aiRunId: outcome.aiRunId } });
    }
  });
  return outcome;
}

/**
 * Save an edit as a NEW version. Prior approvals stay attached to the old
 * version and therefore stop counting. Paid versions cannot be edited; use
 * an amendment instead.
 */
export async function saveEdit(db: Db, dealId: string, userId: string, baseVersionId: string, nextRaw: unknown) {
  const { role } = await loadDealForUser(db, dealId, userId);
  const parsed = BriefContentSchema.safeParse(nextRaw);
  if (!parsed.success) throw new AppError("INVALID", `Brief is not valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return db.$transaction(async (tx) => {
    const st = await versionState(tx, dealId);
    const base = st.working;
    if (!base || base.id !== baseVersionId) throw new AppError("STALE_VERSION", "Someone saved a newer version while you were editing. Reload to see it.");
    if (base.lockedAt) throw new AppError("LOCKED", "This version was paid for and is locked. Propose an amendment instead.");
    if (base.kind === "AMENDMENT" && st.isApproved(base)) throw new AppError("LOCKED", "This amendment is already agreed by both sides. Start a new amendment instead.");
    const openPayment = await tx.payment.findFirst({ where: { dealId, status: { in: ["CAPTURE_PENDING", "COMPLETED"] } } });
    if (openPayment && base.kind === "ORIGINAL") throw new AppError("LOCKED", "A payment exists for this agreement; the original brief can no longer change.");
    const prev = parseContent(base);
    const { content, changed } = markEdits(prev, parsed.data, role);
    if (base.kind === "AMENDMENT" && st.paid) {
      const paid = parseContent(st.paid);
      if (content.price.amountMinor !== paid.price.amountMinor || content.price.currency !== paid.price.currency) {
        throw new AppError("INVALID", "Amendments cannot change the paid price in this MVP. Agree price changes as a new agreement.");
      }
    }
    if (changed.length === 0) throw new AppError("INVALID", "No changes to save.");
    const hadApprovals = base.approvals.length > 0;
    await tx.briefVersion.update({ where: { id: base.id }, data: { supersededAt: new Date() } });
    const v = await tx.briefVersion.create({
      data: { dealId, number: base.number + 1, kind: base.kind, origin: "EDITED", parentVersionId: base.kind === "AMENDMENT" ? base.parentVersionId : base.id, content: canonicalJson(content), contentHash: hashContent(content), createdById: userId },
    });
    await appendEvent(tx, { dealId, type: "BRIEF_EDITED", kind: "USER_DECLARATION", actorId: userId, actorRole: role,
      summary: `${cap(role)} saved version ${v.number}${base.kind === "AMENDMENT" ? " (amendment)" : ""}; changed: ${changed.join(", ")}.`, data: { fromVersion: base.number, toVersion: v.number, changed, contentHash: v.contentHash } });
    if (hadApprovals) {
      await appendEvent(tx, { dealId, type: "APPROVALS_INVALIDATED", kind: "SYSTEM_CONFIRMED", actorRole: "SYSTEM",
        summary: `Approvals on version ${base.number} no longer count because version ${v.number} changed the brief.`, data: { version: base.number } });
    }
    await tx.payment.updateMany({ where: { dealId, versionId: base.id, status: { in: ["INITIATED", "ORDER_CREATED"] } }, data: { status: "ABANDONED", statusReason: "Brief changed before capture" } });
    return v;
  });
}

export async function approveVersion(db: Db, dealId: string, userId: string, versionId: string, contentHash: string) {
  const { deal, role } = await loadDealForUser(db, dealId, userId);
  if (role === "SELLER" && !deal.buyerId) {
    // seller may approve before the buyer joins; the buyer must approve the same version later
  }
  return db.$transaction(async (tx) => {
    const st = await versionState(tx, dealId);
    const v = st.working;
    if (!v || v.id !== versionId) throw new AppError("STALE_VERSION", "That version is no longer current. Review the latest version before approving.");
    if (v.contentHash !== contentHash) throw new AppError("STALE_VERSION", "The brief changed after you loaded it. Review it again before approving.");
    if (v.lockedAt) throw new AppError("LOCKED", "This version is already paid and locked.");
    const content = parseContent(v);
    if (v.kind === "ORIGINAL") {
      const blockers = paymentBlockers(content);
      if (blockers.length) throw new AppError("INVALID", `Cannot approve yet: ${blockers.join(" ")}`);
    }
    const exists = v.approvals.find((a) => a.userId === userId);
    if (exists) return { alreadyApproved: true };
    await tx.approval.create({ data: { versionId: v.id, userId, role, contentHash: v.contentHash } });
    await appendEvent(tx, { dealId, type: "BRIEF_APPROVED", kind: "USER_DECLARATION", actorId: userId, actorRole: role,
      summary: `${cap(role)} approved version ${v.number}${v.kind === "AMENDMENT" ? " (amendment)" : ""}.`, data: { version: v.number, contentHash: v.contentHash } });
    const after = await versionState(tx, dealId);
    if (after.workingApproved) {
      const price = content.price.amountMinor !== null && content.price.currency ? formatMoney(content.price.amountMinor, content.price.currency) : "no price";
      await appendEvent(tx, { dealId, type: v.kind === "AMENDMENT" ? "AMENDMENT_AGREED" : "AGREEMENT_READY", kind: "SYSTEM_CONFIRMED", actorRole: "SYSTEM",
        summary: v.kind === "AMENDMENT"
          ? `Both participants approved amendment version ${v.number}; delivery is now checked against it.`
          : `Both participants approved version ${v.number} (${price}). Ready for PayPal checkout.`,
        data: { version: v.number, contentHash: v.contentHash } });
    }
    return { alreadyApproved: false };
  });
}

/** After payment: start an amendment draft copied from the effective version. */
export async function startAmendment(db: Db, dealId: string, userId: string) {
  const { role } = await loadDealForUser(db, dealId, userId);
  return db.$transaction(async (tx) => {
    const st = await versionState(tx, dealId);
    if (!st.paid || !st.effective) throw new AppError("INVALID", "Amendments are for paid agreements. Before payment, edit the brief directly.");
    if (st.working && st.working.kind === "AMENDMENT" && !st.isApproved(st.working)) throw new AppError("CONFLICT", "An amendment draft is already open.");
    const max = Math.max(...st.versions.map((v) => v.number));
    const content = parseContent(st.effective);
    const v = await tx.briefVersion.create({
      data: { dealId, number: max + 1, kind: "AMENDMENT", origin: "EDITED", parentVersionId: st.effective.id, content: canonicalJson(content), contentHash: hashContent(content), createdById: userId },
    });
    await appendEvent(tx, { dealId, type: "AMENDMENT_STARTED", kind: "USER_DECLARATION", actorId: userId, actorRole: role,
      summary: `${cap(role)} opened amendment draft version ${v.number} (based on version ${st.effective.number}). The paid version stays unchanged.`, data: { version: v.number } });
    return v;
  });
}

export function cap(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export type { VersionRow };
