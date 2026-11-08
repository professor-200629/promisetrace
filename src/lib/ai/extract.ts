import type { Db } from "@/lib/db";
import { aiSetup, env } from "@/lib/env";
import { emptyBrief, type BriefContent } from "@/lib/brief";
import { extractWithAnthropic, extractWithFixture, type SourceForAi } from "@/lib/ai/providers";
import { validateExtraction, type ValidationReport } from "@/lib/ai/validate";

export type ExtractionOutcome = {
  aiRunId: string;
  provider: "anthropic" | "fixture";
  status: "OK" | "INVALID_OUTPUT" | "ERROR" | "REFUSED" | "BUDGET_BLOCKED" | "NOT_CONFIGURED";
  brief: BriefContent;
  report: ValidationReport | null;
  error?: string;
  costUsd: number;
  latencyMs: number;
};

export function costMicros(inputTokens: number, outputTokens: number): number {
  const e = env();
  return Math.round(inputTokens * e.AI_PRICE_INPUT_PER_MTOK + outputTokens * e.AI_PRICE_OUTPUT_PER_MTOK);
}

/**
 * Propose a structured brief from the deal's sources. Enforces the daily call
 * budget and input size cap, logs tokens/cost/latency in AiRun, and always
 * returns something the seller can edit (an empty brief on failure).
 */
export async function proposeBrief(db: Db, args: { dealId: string | null; title: string; sources: SourceForAi[]; purpose?: "EXTRACT_BRIEF" | "EVAL" }): Promise<ExtractionOutcome> {
  const e = env();
  const setup = aiSetup();
  const started = Date.now();
  const totalChars = args.sources.reduce((n, s) => n + s.text.length, 0);

  const log = async (data: { provider: string; model: string; status: string; inputTokens?: number; outputTokens?: number; validation?: unknown; error?: string }) =>
    db.aiRun.create({
      data: {
        dealId: args.dealId,
        purpose: args.purpose ?? "EXTRACT_BRIEF",
        provider: data.provider,
        model: data.model,
        status: data.status,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        costUsdMicros: costMicros(data.inputTokens ?? 0, data.outputTokens ?? 0),
        latencyMs: Date.now() - started,
        validation: JSON.stringify(data.validation ?? {}),
        error: data.error ?? null,
      },
    });

  const fail = async (status: ExtractionOutcome["status"], provider: "anthropic" | "fixture", model: string, error: string, tokens?: { inputTokens: number; outputTokens: number }) => {
    const run = await log({ provider, model, status, ...tokens, error });
    return { aiRunId: run.id, provider, status, brief: emptyBrief(args.title), report: null, error, costUsd: run.costUsdMicros / 1e6, latencyMs: run.latencyMs };
  };

  if (setup.state === "missing_credentials") {
    return fail("NOT_CONFIGURED", "anthropic", setup.model, "ANTHROPIC_API_KEY is not set. Fill the brief manually, or configure the key (see README).");
  }
  if (totalChars > e.AI_MAX_INPUT_CHARS) {
    return fail("BUDGET_BLOCKED", setup.provider, setup.model, `Sources are ${totalChars} characters; the configured limit is ${e.AI_MAX_INPUT_CHARS}.`);
  }
  if (setup.provider === "anthropic") {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const used = await db.aiRun.count({ where: { provider: "anthropic", createdAt: { gte: since }, status: { notIn: ["BUDGET_BLOCKED", "NOT_CONFIGURED"] } } });
    if (used >= e.AI_DAILY_CALL_LIMIT) {
      return fail("BUDGET_BLOCKED", "anthropic", setup.model, `Daily AI call limit (${e.AI_DAILY_CALL_LIMIT}) reached. Fill the brief manually or raise AI_DAILY_CALL_LIMIT.`);
    }
  }

  const result = setup.provider === "anthropic" ? await extractWithAnthropic(args.sources) : await extractWithFixture(args.sources);
  if (!result.ok) return fail(result.status, result.provider, result.model, result.error, result);

  const { brief, report } = validateExtraction(result.output, args.sources);
  const run = await log({ provider: result.provider, model: result.model, status: "OK", inputTokens: result.inputTokens, outputTokens: result.outputTokens, validation: { report, raw: result.output } });
  return { aiRunId: run.id, provider: result.provider, status: "OK", brief, report, costUsd: run.costUsdMicros / 1e6, latencyMs: run.latencyMs };
}
