import {
  type BriefContent,
  type Deliverable,
  type SourceRef,
  FILE_FORMATS,
  gapQuestions,
  isValidTimeZone,
  renumberQuestions,
  BriefContentSchema,
} from "@/lib/brief";
import { isSupportedCurrency, parseToMinor, minorToValue } from "@/lib/money";
import {
  locateQuote,
  passageMentionsAmount,
  passageMentionsFormat,
  passageMentionsNumber,
  type SourceText,
} from "@/lib/sources";
import type { AiExtraction } from "@/lib/ai/extraction-schema";

export type ValidationReport = {
  quotesTotal: number;
  quotesInvalid: Array<{ field: string; source: string; quote: string }>;
  claimsProposed: number;
  claimsAccepted: number;
  unsupportedClaims: Array<{ field: string; value: string; reason: string }>;
  clarificationsFromAi: number;
  clarificationsFromChecks: number;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const TZ_HINTS = /\b(utc|gmt|ist|et|est|edt|ct|cst|cdt|mt|mst|mdt|pt|pst|pdt|bst|cet|cest|aest|aedt|jst|sgt|eastern|central|mountain|pacific|time|timezone|zone)\b/i;
const CURRENCY_SYMBOLS: Record<string, string[]> = {
  USD: ["$", "usd", "us$", "dollar"], EUR: ["€", "eur", "euro"], GBP: ["£", "gbp", "pound"],
  JPY: ["¥", "jpy", "yen"], CAD: ["cad", "c$"], AUD: ["aud", "a$"], SGD: ["sgd", "s$"],
};

/**
 * Turn raw model output into a BriefContent the app can trust:
 * every kept value has at least one passage that (a) really exists in the
 * source and (b) literally mentions that value. Everything else is dropped to
 * null/unknown and recorded in the report.
 */
export function validateExtraction(ai: AiExtraction, sources: SourceText[]): { brief: BriefContent; report: ValidationReport } {
  const report: ValidationReport = {
    quotesTotal: 0, quotesInvalid: [], claimsProposed: 0, claimsAccepted: 0,
    unsupportedClaims: [], clarificationsFromAi: 0, clarificationsFromChecks: 0,
  };

  const resolve = (field: string, quotes: Array<{ source: string; text: string }>): SourceRef[] => {
    const refs: SourceRef[] = [];
    for (const q of quotes.slice(0, 8)) {
      report.quotesTotal++;
      const src = sources.find((s) => s.label === q.source) ?? (sources.length === 1 ? sources[0] : undefined);
      const ref = src ? locateQuote(src, q.text) : null;
      if (!ref) report.quotesInvalid.push({ field, source: q.source, quote: q.text.slice(0, 200) });
      else if (!refs.some((r) => r.start === ref.start && r.end === ref.end && r.source === ref.source)) refs.push(ref);
    }
    return refs.slice(0, 6);
  };
  const reject = (field: string, value: string, reason: string) => report.unsupportedClaims.push({ field, value, reason });
  const joined = (refs: SourceRef[]) => refs.map((r) => r.quote).join(" \n ");

  // ---- price
  const priceRefs = resolve("price", ai.price.quotes);
  let price: BriefContent["price"] = { amountMinor: null, currency: null, refs: priceRefs, status: "unknown" };
  if (ai.price.amount !== null || ai.price.currency !== null) {
    report.claimsProposed++;
    const cur = ai.price.currency?.trim().toUpperCase() ?? null;
    let minor: number | null = null;
    let problem: string | null = null;
    if (!cur) problem = "currency not stated";
    else if (!isSupportedCurrency(cur)) problem = cur === "INR" ? "INR cannot be used: PayPal India accounts cannot receive domestic INR payments" : `${cur} is not a PayPal Checkout currency`;
    else if (ai.price.amount === null) problem = "amount not stated";
    else {
      try { minor = parseToMinor(ai.price.amount, cur); } catch { problem = `amount "${ai.price.amount}" is not a valid ${cur} amount`; }
    }
    if (!problem && minor !== null && cur) {
      const text = joined(priceRefs).toLowerCase();
      if (priceRefs.length === 0) problem = "no verifiable source passage";
      else if (!passageMentionsAmount(text, minorToValue(minor, cur))) problem = "quoted passages do not mention this amount";
      else if (!(CURRENCY_SYMBOLS[cur] ?? [cur.toLowerCase()]).some((s) => text.includes(s))) problem = "quoted passages do not mention this currency";
    }
    if (problem) reject("price", `${ai.price.amount ?? "?"} ${cur ?? "?"}`, problem);
    else {
      report.claimsAccepted++;
      price = { amountMinor: minor, currency: cur, refs: priceRefs, status: ai.price.clarity === "stated" ? "sourced" : "needs_clarification" };
    }
  } else if (ai.price.clarity === "unclear") price.status = "needs_clarification";

  // ---- deadline
  const dlRefs = resolve("deadline", ai.deadline.quotes);
  const deadline: BriefContent["deadline"] = { date: null, time: null, timezone: null, refs: dlRefs, status: "unknown" };
  const dlText = joined(dlRefs).toLowerCase();
  if (ai.deadline.date) {
    report.claimsProposed++;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ai.deadline.date.trim());
    const valid = m && !Number.isNaN(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) && +m[2]! >= 1 && +m[2]! <= 12 && +m[3]! >= 1 && +m[3]! <= 31;
    if (!valid) reject("deadline.date", ai.deadline.date, "not a valid YYYY-MM-DD date");
    else if (dlRefs.length === 0) reject("deadline.date", ai.deadline.date, "no verifiable source passage");
    else {
      const day = Number(m[3]);
      const month = Number(m[2]);
      const mentionsDay = passageMentionsNumber(dlText, day) || new RegExp(`\\b${day}(st|nd|rd|th)\\b`).test(dlText);
      const mentionsMonth = dlText.includes(MONTHS[month - 1]!) || dlText.includes(MONTHS[month - 1]!.slice(0, 3)) || new RegExp(`\\b0?${month}[/.-]`).test(dlText) || new RegExp(`[/.-]0?${month}\\b`).test(dlText);
      if (!mentionsDay || !mentionsMonth) reject("deadline.date", ai.deadline.date, "quoted passages do not state this day and month");
      else {
        report.claimsAccepted++;
        deadline.date = ai.deadline.date.trim();
        deadline.status = ai.deadline.clarity === "stated" ? "sourced" : "needs_clarification";
      }
    }
  } else if (ai.deadline.clarity === "unclear" || dlRefs.length > 0) deadline.status = "needs_clarification";

  if (deadline.date && ai.deadline.time) {
    report.claimsProposed++;
    const tm = /^(\d{2}):(\d{2})$/.exec(ai.deadline.time.trim());
    const h = tm ? Number(tm[1]) : -1;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    if (!tm || h > 23 || Number(tm[2]) > 59) reject("deadline.time", ai.deadline.time, "not a valid HH:MM time");
    else if (!passageMentionsNumber(dlText, h) && !passageMentionsNumber(dlText, h12) && !/\b(noon|midnight)\b/.test(dlText)) reject("deadline.time", ai.deadline.time, "quoted passages do not state this time");
    else { report.claimsAccepted++; deadline.time = ai.deadline.time.trim(); }
  }
  if (deadline.date && ai.deadline.timezone) {
    report.claimsProposed++;
    const tz = ai.deadline.timezone.trim();
    const city = tz.split("/").pop()!.replace(/_/g, " ").toLowerCase();
    if (!isValidTimeZone(tz)) reject("deadline.timezone", tz, "not a valid IANA timezone");
    else if (!dlText.includes(city) && !TZ_HINTS.test(dlText)) reject("deadline.timezone", tz, "quoted passages do not name a timezone or city");
    else { report.claimsAccepted++; deadline.timezone = tz; }
  }
  if (deadline.date && !deadline.timezone && deadline.status === "sourced") deadline.status = "needs_clarification";

  // ---- revision rounds
  const rvRefs = resolve("revisionRounds", ai.revision_rounds.quotes);
  let revisionRounds: BriefContent["revisionRounds"] = { count: null, refs: rvRefs, status: "unknown" };
  if (ai.revision_rounds.count !== null) {
    report.claimsProposed++;
    const n = ai.revision_rounds.count;
    const text = joined(rvRefs);
    if (n < 0 || n > 20) reject("revisionRounds", String(n), "implausible count");
    else if (rvRefs.length === 0) reject("revisionRounds", String(n), "no verifiable source passage");
    else if (!passageMentionsNumber(text, n) && !(n === 0 && /\bno revisions?\b/i.test(text)) && !(n === 1 && /\b(a|one) (round|revision)\b/i.test(text))) reject("revisionRounds", String(n), "quoted passages do not mention this number");
    else {
      report.claimsAccepted++;
      revisionRounds = { count: n, refs: rvRefs, status: ai.revision_rounds.clarity === "stated" ? "sourced" : "needs_clarification" };
    }
  } else if (ai.revision_rounds.clarity === "unclear") revisionRounds.status = "needs_clarification";

  // ---- deliverables
  const deliverables: Deliverable[] = [];
  ai.deliverables.slice(0, 12).forEach((d, i) => {
    const field = `deliverables[${i}]`;
    report.claimsProposed++;
    const refs = resolve(field, d.quotes);
    if (refs.length === 0) {
      reject(field, d.label, "no verifiable source passage");
      return;
    }
    report.claimsAccepted++;
    const text = joined(refs);
    let quantity: number | null = null;
    if (d.quantity !== null) {
      report.claimsProposed++;
      if (d.quantity > 0 && d.quantity <= 100 && passageMentionsNumber(text, d.quantity)) { quantity = d.quantity; report.claimsAccepted++; }
      else reject(`${field}.quantity`, String(d.quantity), "quoted passages do not mention this number");
    }
    const formats: Deliverable["formats"] = [];
    for (const raw of d.formats) {
      report.claimsProposed++;
      const f = raw.trim().toLowerCase().replace(/^\./, "").replace(/^jpg$/, "jpeg");
      if (!(FILE_FORMATS as readonly string[]).includes(f)) { reject(`${field}.formats`, raw, "unsupported format name"); continue; }
      if (!passageMentionsFormat(text, f)) { reject(`${field}.formats`, raw, "quoted passages do not name this format"); continue; }
      if (!formats.includes(f as Deliverable["formats"][number])) { formats.push(f as Deliverable["formats"][number]); report.claimsAccepted++; }
    }
    deliverables.push({
      key: `D${deliverables.length + 1}`,
      label: d.label.trim().slice(0, 120) || `Deliverable ${deliverables.length + 1}`,
      quantity,
      formats,
      refs,
      status: d.clarity === "stated" && (quantity !== null || formats.length > 0) ? "sourced" : "needs_clarification",
    });
  });

  // ---- questions
  const aiQs = ai.open_questions.slice(0, 8).map((q, i) => ({
    text: q.question.trim().slice(0, 300),
    origin: "AI" as const,
    refs: resolve(`open_questions[${i}]`, q.quotes).slice(0, 4),
  })).filter((q) => q.text.length > 0);
  report.clarificationsFromAi = aiQs.length;

  const draft: BriefContent = {
    title: ai.title.trim().slice(0, 120) || "Untitled purchase",
    price, deadline, revisionRounds, deliverables, openQuestions: [],
  };
  const checkQs = gapQuestions(draft).filter((cq) => !aiQs.some((aq) => similar(aq.text, cq.text)));
  report.clarificationsFromChecks = checkQs.length;
  draft.openQuestions = renumberQuestions([...aiQs, ...checkQs]);

  return { brief: BriefContentSchema.parse(draft), report };
}

function similar(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wa = words(a), wb = words(b);
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common >= 2 && common / Math.min(wa.size || 1, wb.size || 1) >= 0.5;
}
