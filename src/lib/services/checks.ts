import { CHECKABLE_FORMATS, deadlineInstant, type BriefContent, type SourceRef } from "@/lib/brief";

export type CheckResultValue = "PASS" | "FAIL" | "NEEDS_REVIEW" | "NOT_CHECKABLE";

export type FileFact = {
  id: string;
  deliverableKey: string;
  originalName: string;
  detectedType: string;
  declaredExt: string;
  safetyNotes: string[];
  deliveryNumber: number;
  receivedAt: Date;
  sha256: string;
};

export type Check = {
  requirementKey: string; // e.g. "D2:svg", "D1:count", "deadline"
  checkType: "FILE_FORMAT" | "FILE_COUNT" | "DEADLINE" | "FILE_INTEGRITY";
  result: CheckResultValue;
  label: string;
  expected: string;
  observed: string;
  refs: SourceRef[];
  fileIds: string[];
};

/**
 * Pure, deterministic checks of everything delivered so far against the
 * agreed brief. No AI is involved. These checks establish what files were
 * received and when; they do not establish quality or that the work is
 * what the buyer wanted.
 */
export function computeChecks(brief: BriefContent, files: FileFact[], at: { latestDeliveryAt: Date | null }): Check[] {
  const checks: Check[] = [];
  for (const d of brief.deliverables) {
    const mine = files.filter((f) => f.deliverableKey === d.key);
    if (d.formats.length > 0) {
      for (const fmt of d.formats) {
        const need = d.quantity ?? 1;
        const key = `${d.key}:${fmt}`;
        if (!CHECKABLE_FORMATS.has(fmt)) {
          checks.push({ requirementKey: key, checkType: "FILE_FORMAT", result: "NOT_CHECKABLE", label: `${d.label}: ${fmt.toUpperCase()}`,
            expected: `${need} × ${fmt.toUpperCase()}`, observed: `PromiseTrace cannot identify .${fmt} files from their contents; the buyer must confirm.`, refs: d.refs, fileIds: [] });
          continue;
        }
        const matching = mine.filter((f) => f.detectedType === fmt);
        const result: CheckResultValue = matching.length >= need ? "PASS" : "FAIL";
        checks.push({
          requirementKey: key, checkType: "FILE_FORMAT", result, label: `${d.label}: ${fmt.toUpperCase()}`,
          expected: `${need} × ${fmt.toUpperCase()} file${need > 1 ? "s" : ""}`,
          observed: matching.length === 0 ? `No ${fmt.toUpperCase()} file received for this item` : `${matching.length} × ${fmt.toUpperCase()} received (${matching.map((f) => `${f.originalName}, delivery ${f.deliveryNumber}`).join("; ")})`,
          refs: d.refs, fileIds: matching.map((f) => f.id),
        });
      }
    } else if (d.quantity !== null) {
      const result: CheckResultValue = mine.length >= d.quantity ? "PASS" : "FAIL";
      checks.push({ requirementKey: `${d.key}:count`, checkType: "FILE_COUNT", result, label: `${d.label}: count`,
        expected: `${d.quantity} file${d.quantity > 1 ? "s" : ""}`, observed: `${mine.length} file${mine.length === 1 ? "" : "s"} received`, refs: d.refs, fileIds: mine.map((f) => f.id) });
    } else {
      checks.push({ requirementKey: `${d.key}:any`, checkType: "FILE_COUNT", result: "NOT_CHECKABLE", label: d.label,
        expected: "Not specified as files or counts", observed: `${mine.length} file(s) attached; the buyer decides whether this is met.`, refs: d.refs, fileIds: mine.map((f) => f.id) });
    }
    const flagged = mine.filter((f) => f.safetyNotes.length > 0);
    if (flagged.length > 0) {
      checks.push({ requirementKey: `${d.key}:integrity`, checkType: "FILE_INTEGRITY", result: "NEEDS_REVIEW", label: `${d.label}: file contents`,
        expected: "Files whose contents match their names, without active content",
        observed: flagged.map((f) => `${f.originalName}: ${f.safetyNotes.join(" ")}`).join(" | "), refs: [], fileIds: flagged.map((f) => f.id) });
    }
  }

  const dl = deadlineInstant(brief.deadline);
  if (!dl) {
    checks.push({ requirementKey: "deadline", checkType: "DEADLINE", result: "NOT_CHECKABLE", label: "Deadline",
      expected: brief.deadline.date ? `${brief.deadline.date} (timezone not agreed)` : "No deadline agreed", observed: "Cannot compare without an agreed date and timezone.", refs: brief.deadline.refs, fileIds: [] });
  } else {
    const fileChecks = checks.filter((c) => c.checkType === "FILE_FORMAT" || c.checkType === "FILE_COUNT");
    const allFilesPresent = fileChecks.length > 0 && fileChecks.every((c) => c.result === "PASS" || c.result === "NOT_CHECKABLE");
    // The moment the last required file arrived (or the latest delivery if still incomplete).
    const relevant = fileChecks.flatMap((c) => c.fileIds).map((id) => files.find((f) => f.id === id)!).filter(Boolean);
    const completedAt = allFilesPresent && relevant.length > 0 ? new Date(Math.max(...relevant.map((f) => f.receivedAt.getTime()))) : null;
    const expected = `By ${dl.utc.toISOString().replace(".000Z", "Z")} (${brief.deadline.date}${brief.deadline.time ? ` ${brief.deadline.time}` : " end of day"} ${brief.deadline.timezone})${dl.assumedTime ? " — no time agreed, end of day assumed" : ""}`;
    let result: CheckResultValue;
    let observed: string;
    if (completedAt) {
      result = completedAt <= dl.utc ? "PASS" : "FAIL";
      observed = `All checkable files present at ${completedAt.toISOString().replace(/\.\d{3}Z$/, "Z")} (server time)${result === "FAIL" ? " — after the deadline" : ""}`;
    } else if (at.latestDeliveryAt) {
      const late = new Date() > dl.utc;
      result = late ? "FAIL" : "NEEDS_REVIEW";
      observed = late ? "Deadline passed with promised files still missing" : "Some promised files are still missing; deadline not yet reached";
    } else {
      const late = new Date() > dl.utc;
      result = late ? "FAIL" : "NOT_CHECKABLE";
      observed = late ? "Deadline passed with no delivery" : "Nothing delivered yet";
    }
    if (dl.assumedTime && result === "PASS") result = "PASS";
    checks.push({ requirementKey: "deadline", checkType: "DEADLINE", result, label: "Deadline", expected, observed, refs: brief.deadline.refs, fileIds: [] });
  }
  return checks;
}

export function summarizeChecks(checks: Check[]) {
  return {
    pass: checks.filter((c) => c.result === "PASS").length,
    fail: checks.filter((c) => c.result === "FAIL").length,
    review: checks.filter((c) => c.result === "NEEDS_REVIEW").length,
    notCheckable: checks.filter((c) => c.result === "NOT_CHECKABLE").length,
  };
}
