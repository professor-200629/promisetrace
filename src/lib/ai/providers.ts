import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "@/lib/env";
import {
  AiExtractionSchema,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserMessage,
  type AiExtraction,
} from "@/lib/ai/extraction-schema";

export type ProviderResult =
  | { ok: true; output: AiExtraction; inputTokens: number; outputTokens: number; model: string; provider: "anthropic" | "fixture" }
  | { ok: false; status: "INVALID_OUTPUT" | "ERROR" | "REFUSED"; error: string; inputTokens: number; outputTokens: number; model: string; provider: "anthropic" | "fixture" };

export type SourceForAi = { label: string; title: string; text: string };

/** Real model call through the official Anthropic SDK with structured output. */
export async function extractWithAnthropic(sources: SourceForAi[]): Promise<ProviderResult> {
  const e = env();
  const model = e.AI_MODEL;
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 180_000 });
  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: e.AI_MAX_OUTPUT_TOKENS,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildExtractionUserMessage(sources) }],
      output_config: { effort: e.AI_EFFORT, format: betaZodOutputFormat(AiExtractionSchema) },
      // Server-side refusal fallback (routes a policy decline to another model inside the same call).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const usage = { inputTokens: response.usage.input_tokens ?? 0, outputTokens: response.usage.output_tokens ?? 0 };
    if (response.stop_reason === "refusal") {
      return { ok: false, status: "REFUSED", error: "The model declined this request. Fill the brief in manually.", ...usage, model: response.model, provider: "anthropic" };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, status: "INVALID_OUTPUT", error: "Model output was cut off at the token limit.", ...usage, model: response.model, provider: "anthropic" };
    }
    const parsed = response.parsed_output;
    if (!parsed) return { ok: false, status: "INVALID_OUTPUT", error: "Model output did not match the schema.", ...usage, model: response.model, provider: "anthropic" };
    const check = AiExtractionSchema.safeParse(parsed);
    if (!check.success) return { ok: false, status: "INVALID_OUTPUT", error: "Model output failed server-side validation.", ...usage, model: response.model, provider: "anthropic" };
    return { ok: true, output: check.data, ...usage, model: response.model, provider: "anthropic" };
  } catch (err) {
    let msg = "AI request failed.";
    if (err instanceof Anthropic.AuthenticationError) msg = "The Anthropic API key was rejected.";
    else if (err instanceof Anthropic.PermissionDeniedError) msg = "The Anthropic API key lacks permission for this model.";
    else if (err instanceof Anthropic.RateLimitError) msg = "Anthropic rate limit reached. Try again in a minute.";
    else if (err instanceof Anthropic.BadRequestError) msg = /credit/i.test(err.message) ? "The Anthropic account has no remaining API credit." : `Anthropic rejected the request: ${err.message.slice(0, 200)}`;
    else if (err instanceof Anthropic.APIError) msg = `Anthropic API error ${err.status ?? ""}`.trim();
    else if (err instanceof Error) msg = err.message.slice(0, 200);
    return { ok: false, status: "ERROR", error: msg, inputTokens: 0, outputTokens: 0, model, provider: "anthropic" };
  }
}

/**
 * Offline fixture: a small rule-based extractor. It is NOT AI, it is labelled
 * "fixture" everywhere it appears, and it doubles as the regex baseline in the
 * synthetic evaluation.
 */
export async function extractWithFixture(sources: SourceForAi[]): Promise<ProviderResult> {
  return { ok: true, output: ruleBasedExtract(sources), inputTokens: 0, outputTokens: 0, model: "rule-based-fixture", provider: "fixture" };
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function ruleBasedExtract(sources: SourceForAi[]): AiExtraction {
  const out: AiExtraction = {
    title: sources[0]?.title?.slice(0, 80) || "Purchase",
    price: { amount: null, currency: null, clarity: "not_stated", quotes: [] },
    deadline: { date: null, time: null, timezone: null, clarity: "not_stated", quotes: [] },
    revision_rounds: { count: null, clarity: "not_stated", quotes: [] },
    deliverables: [],
    open_questions: [],
  };
  for (const s of sources) {
    const sentences = s.text.split(/(?<=[.!?\n])/).map((x) => x.trim()).filter(Boolean);
    for (const sent of sentences) {
      const low = sent.toLowerCase();
      const pm = /(?:(US\$|\$|USD|EUR|€|GBP|£)\s?(\d[\d,]*(?:\.\d{1,2})?))|(?:(\d[\d,]*(?:\.\d{1,2})?)\s?(USD|EUR|GBP|dollars))/i.exec(sent);
      if (pm && out.price.amount === null) {
        const amt = (pm[2] ?? pm[3] ?? "").replace(/,/g, "");
        const sym = (pm[1] ?? pm[4] ?? "").toUpperCase();
        const cur = sym.includes("€") || sym === "EUR" ? "EUR" : sym.includes("£") || sym === "GBP" ? "GBP" : "USD";
        out.price = { amount: amt, currency: cur, clarity: /usd|eur|gbp|€|£|us\$/i.test(sym) ? "stated" : "unclear", quotes: [{ source: s.label, text: sent }] };
      }
      const rv = /(\d+|one|two|three|four|five)\s+(?:rounds? of\s+)?revisions?|(\d+|one|two|three|four|five)\s+revision rounds?/i.exec(sent);
      if (rv && out.revision_rounds.count === null) {
        const w = (rv[1] ?? rv[2] ?? "").toLowerCase();
        out.revision_rounds = { count: WORD_NUM[w] ?? Number(w), clarity: "stated", quotes: [{ source: s.label, text: sent }] };
      }
      const dm = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")}),?\\s+(\\d{4})`, "i").exec(sent);
      if (dm && out.deadline.date === null && /(due|deadline|by|deliver)/i.test(low)) {
        const monthName = (dm[1] ?? dm[5] ?? "").toLowerCase();
        const day = Number(dm[2] ?? dm[4]);
        const year = Number(dm[3] ?? dm[6]);
        const mm = String(MONTHS.indexOf(monthName) + 1).padStart(2, "0");
        out.deadline.date = `${year}-${mm}-${String(day).padStart(2, "0")}`;
        out.deadline.clarity = "stated";
        out.deadline.quotes.push({ source: s.label, text: sent });
        const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(sent);
        if (tm) {
          let h = Number(tm[1]) % 12;
          if (tm[3]!.toLowerCase() === "pm") h += 12;
          out.deadline.time = `${String(h).padStart(2, "0")}:${tm[2] ?? "00"}`;
        }
        if (/new york|eastern|\bet\b|\best\b/i.test(sent)) out.deadline.timezone = "America/New_York";
        else if (/\bist\b|india/i.test(sent)) out.deadline.timezone = "Asia/Kolkata";
        else if (/london|\bgmt\b|\bbst\b/i.test(sent)) out.deadline.timezone = "Europe/London";
        else if (/\butc\b/i.test(sent)) out.deadline.timezone = "UTC";
      }
      const fm = sent.match(/\b(png|svg|pdf|jpe?g|zip)\b/gi);
      const qm = /\b(\d+|one|two|three|four|five)\s+([a-z]+\s)?(concepts?|logos?|variations?|options?|banners?|icons?|pages?|illustrations?)\b/i.exec(sent);
      if (fm || qm) {
        const formats = [...new Set((fm ?? []).map((f) => f.toLowerCase().replace("jpg", "jpeg")))];
        const qty = qm ? WORD_NUM[qm[1]!.toLowerCase()] ?? Number(qm[1]) : null;
        const label = qm ? `${qm[3]!.charAt(0).toUpperCase()}${qm[3]!.slice(1)}` : "Final files";
        if (!/revision/i.test(low) || fm) {
          out.deliverables.push({ label, quantity: qty, formats, clarity: "stated", quotes: [{ source: s.label, text: sent }] });
        }
      }
    }
  }
  if (out.price.amount === null) out.open_questions.push({ question: "What is the agreed price?", quotes: [] });
  return out;
}
