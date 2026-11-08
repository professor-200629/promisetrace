/**
 * Synthetic extraction benchmark (NOT customer validation).
 *
 *   npx tsx eval/run-eval.ts --provider fixture            # rule-based baseline, free, offline
 *   npx tsx eval/run-eval.ts --provider anthropic --runs 1 # real model; costs API credit
 *
 * Writes eval/results/<provider>-<timestamp>.json and prints a summary.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATASET, type Labelled } from "./dataset";
import { extractWithAnthropic, extractWithFixture } from "../src/lib/ai/providers";
import { validateExtraction } from "../src/lib/ai/validate";
import { costMicros } from "../src/lib/ai/extract";
import type { BriefContent } from "../src/lib/brief";

const args = process.argv.slice(2);
const provider = (args[args.indexOf("--provider") + 1] ?? "fixture") as "fixture" | "anthropic";
const runs = Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 1);

type Score = { tp: number; predicted: number; expected: number; wrongKept: string[]; missed: string[] };

function scalar(name: string, pred: unknown, exp: unknown, s: Score) {
  const p = pred ?? null, e = exp ?? null;
  if (e !== null) s.expected++;
  if (p !== null) s.predicted++;
  if (p !== null && e !== null && JSON.stringify(p) === JSON.stringify(e)) s.tp++;
  else {
    if (p !== null) s.wrongKept.push(`${name}=${JSON.stringify(p)} (expected ${JSON.stringify(e)})`);
    if (e !== null) s.missed.push(`${name}=${JSON.stringify(e)}`);
  }
}

function scoreBrief(b: BriefContent, item: Labelled): Score {
  const s: Score = { tp: 0, predicted: 0, expected: 0, wrongKept: [], missed: [] };
  const x = item.expected;
  scalar("price", b.price.amountMinor !== null && b.price.currency ? { a: b.price.amountMinor, c: b.price.currency } : null, x.price ? { a: x.price.amountMinor, c: x.price.currency } : null, s);
  scalar("deadline.date", b.deadline.date, x.deadlineDate, s);
  scalar("deadline.time", b.deadline.time, x.deadlineTime, s);
  scalar("deadline.timezone", b.deadline.timezone, x.deadlineTimezone, s);
  scalar("revisionRounds", b.revisionRounds.count, x.revisionRounds, s);

  // Deliverables: greedy match by format overlap, then score each format and quantity as a fact.
  const pool = x.deliverables.map((d, i) => ({ ...d, i, used: false }));
  for (const d of b.deliverables) {
    let best: (typeof pool)[number] | null = null, bestScore = -1;
    for (const e of pool) {
      if (e.used) continue;
      const inter = d.formats.filter((f) => e.formats.includes(f)).length;
      const sc = inter * 2 + (d.quantity !== null && d.quantity === e.quantity ? 1 : 0) + (d.formats.length === 0 && e.formats.length === 0 ? 1 : 0);
      if (sc > bestScore) { best = e; bestScore = sc; }
    }
    if (best && bestScore > 0) best.used = true; else best = null;
    for (const f of d.formats) {
      s.predicted++;
      if (best?.formats.includes(f)) s.tp++; else s.wrongKept.push(`${d.label}.format=${f}`);
    }
    if (d.quantity !== null) {
      s.predicted++;
      if (best && best.quantity === d.quantity) s.tp++; else s.wrongKept.push(`${d.label}.quantity=${d.quantity}`);
    }
  }
  for (const e of x.deliverables) {
    s.expected += e.formats.length + (e.quantity !== null ? 1 : 0);
  }
  return s;
}

function flagged(b: BriefContent, field: Labelled["ambiguous"][number]): boolean {
  const q = b.openQuestions.map((x) => x.text.toLowerCase()).join(" | ");
  switch (field) {
    case "price": return b.price.amountMinor === null || b.price.status !== "sourced";
    case "deadline": return b.deadline.date === null || b.deadline.status !== "sourced";
    case "timezone": return b.deadline.timezone === null;
    case "revisions": return b.revisionRounds.count === null || b.revisionRounds.status !== "sourced";
    case "formats": return b.deliverables.some((d) => d.formats.length === 0) || /format/.test(q);
    case "quantity": return b.deliverables.some((d) => d.quantity === null && d.status !== "sourced") || /how many|number of|couple/.test(q);
  }
}

async function main() {
  const rows: Array<Record<string, unknown>> = [];
  for (let r = 0; r < runs; r++) {
    for (const item of DATASET) {
      const sources = [{ label: "S1", title: item.id, text: item.text }];
      const t0 = Date.now();
      const res = provider === "anthropic" ? await extractWithAnthropic(sources) : await extractWithFixture(sources);
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        rows.push({ run: r, id: item.id, split: item.split, status: res.status, error: res.error, latencyMs, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
        console.log(`${item.id}: ${res.status} ${res.error}`);
        continue;
      }
      const { brief, report } = validateExtraction(res.output, sources.map((s) => ({ label: s.label, text: s.text })));
      const s = scoreBrief(brief, item);
      const amb = item.ambiguous.map((f) => ({ field: f, flagged: flagged(brief, f) }));
      const aiQuestions = brief.openQuestions.filter((q) => q.origin === "AI").length;
      rows.push({
        run: r, id: item.id, split: item.split, status: "OK", model: res.model, latencyMs, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        costUsd: costMicros(res.inputTokens, res.outputTokens) / 1e6, tp: s.tp, predicted: s.predicted, expected: s.expected,
        wrongKept: s.wrongKept, missed: s.missed, invalidQuotes: report.quotesInvalid.length, quotesTotal: report.quotesTotal,
        droppedByValidator: report.unsupportedClaims.length, dropped: report.unsupportedClaims, ambiguity: amb, aiQuestions, cleanBrief: item.ambiguous.length === 0,
      });
      console.log(`${item.id.padEnd(24)} P ${s.predicted ? (s.tp / s.predicted).toFixed(2) : "  - "} R ${(s.tp / s.expected).toFixed(2)} invalidQuotes ${report.quotesInvalid.length} dropped ${report.unsupportedClaims.length} amb ${amb.filter((a) => a.flagged).length}/${amb.length} ${latencyMs}ms`);
    }
  }
  const summarize = (split?: string) => {
    const ok = rows.filter((x) => x.status === "OK" && (!split || x.split === split));
    const sum = (k: string) => ok.reduce((n, x) => n + (x[k] as number), 0);
    const amb = ok.flatMap((x) => x.ambiguity as Array<{ flagged: boolean }>);
    return {
      briefs: ok.length,
      failures: rows.filter((x) => x.status !== "OK" && (!split || x.split === split)).length,
      precision: sum("predicted") ? +(sum("tp") / sum("predicted")).toFixed(3) : null,
      recall: sum("expected") ? +(sum("tp") / sum("expected")).toFixed(3) : null,
      wrongFactsKept: ok.reduce((n, x) => n + (x.wrongKept as string[]).length, 0),
      invalidQuotes: sum("invalidQuotes"),
      quotesTotal: sum("quotesTotal"),
      claimsDroppedByValidator: sum("droppedByValidator"),
      ambiguityFlagged: `${amb.filter((a) => a.flagged).length}/${amb.length}`,
      aiQuestionsOnCleanBriefs: ok.filter((x) => x.cleanBrief).reduce((n, x) => n + (x.aiQuestions as number), 0),
      meanLatencyMs: ok.length ? Math.round(sum("latencyMs") / ok.length) : null,
      totalCostUsd: +ok.reduce((n, x) => n + ((x.costUsd as number) ?? 0), 0).toFixed(4),
      tokens: { input: sum("inputTokens"), output: sum("outputTokens") },
    };
  };
  const out = {
    label: "SYNTHETIC BENCHMARK — fictional, hand-labelled briefs; not customer validation",
    provider, model: provider === "anthropic" ? process.env.AI_MODEL ?? "claude-opus-5-5" : "rule-based-fixture",
    effort: provider === "anthropic" ? process.env.AI_EFFORT ?? "low" : null,
    runs, ranAt: new Date().toISOString(),
    summary: { all: summarize(), tuning: summarize("tuning"), heldout: summarize("heldout") },
    rows,
  };
  const dir = path.join(import.meta.dirname, "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${provider}-${out.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\nSUMMARY", JSON.stringify(out.summary, null, 2));
  console.log(`written ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
