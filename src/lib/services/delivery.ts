import type { Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { sha256Hex } from "@/lib/hash";
import { ACCEPTED_TYPES, inspectFile } from "@/lib/files/inspect";
import { appendEvent } from "@/lib/services/events";
import { loadDealForUser, requireRole } from "@/lib/services/access";
import { parseContent, versionState } from "@/lib/services/briefs";
import { paymentSummary } from "@/lib/services/payments";
import { computeChecks, summarizeChecks, type FileFact } from "@/lib/services/checks";

export type UploadInput = { deliverableKey: string; name: string; bytes: Uint8Array };

export async function allFileFacts(db: Db, dealId: string): Promise<FileFact[]> {
  const files = await db.deliveryFile.findMany({ where: { delivery: { dealId } }, include: { delivery: { select: { number: true } } }, orderBy: { receivedAt: "asc" } });
  return files.map((f) => ({
    id: f.id, deliverableKey: f.deliverableKey, originalName: f.originalName, detectedType: f.detectedType, declaredExt: f.declaredExt,
    safetyNotes: JSON.parse(f.safetyNotes) as string[], deliveryNumber: f.delivery.number, receivedAt: f.receivedAt, sha256: f.sha256,
  }));
}

/**
 * Seller submits files for a paid agreement. Files are type-checked from their
 * bytes, hashed, stored privately, and the deterministic checks are
 * snapshotted against the effective (paid or amended) brief.
 */
export async function submitDelivery(db: Db, dealId: string, userId: string, input: { note: string; files: UploadInput[] }) {
  const e = env();
  const { role } = await loadDealForUser(db, dealId, userId);
  requireRole(role, "SELLER", "submit deliveries");
  const pay = await paymentSummary(db, dealId);
  if (!pay.isPaid) {
    throw new AppError("NOT_APPROVED", pay.latest?.status === "CAPTURE_PENDING" ? "Payment is still pending at PayPal. Deliver after PayPal completes it." : "Deliveries open after a COMPLETED PayPal capture.");
  }
  const st = await versionState(db, dealId);
  if (!st.effective) throw new AppError("INVALID", "No paid agreement found.");
  const brief = parseContent(st.effective);
  if (input.files.length === 0) throw new AppError("INVALID", "Attach at least one file.");
  if (input.files.length > e.MAX_FILES_PER_DELIVERY) throw new AppError("INVALID", `At most ${e.MAX_FILES_PER_DELIVERY} files per delivery.`);
  const keys = new Set(brief.deliverables.map((d) => d.key));

  const prepared = input.files.map((f) => {
    if (!keys.has(f.deliverableKey)) throw new AppError("INVALID", `Unknown deliverable ${f.deliverableKey}.`);
    if (f.bytes.byteLength === 0) throw new AppError("INVALID", `${f.name} is empty.`);
    if (f.bytes.byteLength > e.MAX_UPLOAD_BYTES) throw new AppError("INVALID", `${f.name} is larger than ${Math.round(e.MAX_UPLOAD_BYTES / 1048576)} MB.`);
    const name = f.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "file";
    const insp = inspectFile(name, f.bytes);
    if (!ACCEPTED_TYPES.includes(insp.detectedType)) throw new AppError("INVALID", `${name}: only PNG, JPEG, SVG, PDF and ZIP files are accepted (content not recognised).`);
    return { ...f, name, insp, sha256: sha256Hex(f.bytes) };
  });

  const note = input.note.trim().slice(0, 2000);
  const delivery = await db.$transaction(async (tx) => {
    const n = (await tx.delivery.count({ where: { dealId } })) + 1;
    const d = await tx.delivery.create({ data: { dealId, number: n, versionId: st.effective!.id, note, submittedById: userId } });
    for (const p of prepared) {
      const file = await tx.deliveryFile.create({
        data: { deliveryId: d.id, deliverableKey: p.deliverableKey, originalName: p.name, sizeBytes: p.bytes.byteLength, sha256: p.sha256,
          detectedType: p.insp.detectedType, declaredExt: p.insp.declaredExt, widthPx: p.insp.widthPx, heightPx: p.insp.heightPx, safetyNotes: JSON.stringify(p.insp.safetyNotes) },
      });
      await tx.fileBlob.create({ data: { fileId: file.id, data: Buffer.from(p.bytes) } });
    }
    await appendEvent(tx, {
      dealId, type: "DELIVERY_SUBMITTED", kind: "SYSTEM_CONFIRMED", actorId: userId, actorRole: "SELLER",
      summary: `Seller submitted delivery ${n} with ${prepared.length} file(s): ${prepared.map((p) => `${p.name} (${p.insp.detectedType.toUpperCase()}, ${p.deliverableKey})`).join(", ")}.`,
      data: { delivery: n, files: prepared.map((p) => ({ name: p.name, sha256: p.sha256, detectedType: p.insp.detectedType, deliverable: p.deliverableKey, bytes: p.bytes.byteLength })), againstVersion: st.effective!.number },
    });
    if (note) {
      await appendEvent(tx, { dealId, type: "SELLER_NOTE", kind: "USER_DECLARATION", actorId: userId, actorRole: "SELLER", summary: `Seller's note with delivery ${n}: "${note.slice(0, 300)}"`, data: { delivery: n } });
    }
    return d;
  });

  const facts = await allFileFacts(db, dealId);
  const checks = computeChecks(brief, facts, { latestDeliveryAt: delivery.submittedAt });
  const sum = summarizeChecks(checks);
  await db.$transaction(async (tx) => {
    await tx.checkResult.createMany({
      data: checks.map((c) => ({ deliveryId: delivery.id, requirementKey: c.requirementKey, checkType: c.checkType, result: c.result, expected: c.expected, observed: c.observed })),
    });
    const missing = checks.filter((c) => c.result === "FAIL").map((c) => c.label);
    await appendEvent(tx, {
      dealId, type: "CHECKS_RECORDED", kind: "SYSTEM_CONFIRMED", actorRole: "SYSTEM",
      summary: `Automatic checks after delivery ${delivery.number} (against version ${st.effective!.number}): ${sum.pass} met, ${sum.fail} not met${missing.length ? ` (${missing.join("; ")})` : ""}, ${sum.review} need review, ${sum.notCheckable} not checkable by code.`,
      data: { delivery: delivery.number, checks: checks.map((c) => ({ key: c.requirementKey, result: c.result, observed: c.observed })) },
    });
  });
  return { delivery, checks };
}

export async function readFileForUser(db: Db, fileId: string, userId: string) {
  const file = await db.deliveryFile.findUnique({ where: { id: fileId }, include: { delivery: true, blob: true } });
  if (!file || !file.blob) throw new AppError("NOT_FOUND", "File not found.");
  await loadDealForUser(db, file.delivery.dealId, userId); // throws NOT_FOUND for outsiders
  return file;
}
