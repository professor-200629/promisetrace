import type { SourceRef } from "@/lib/brief";

export type SourceText = { label: string; text: string };

/**
 * Locate a quoted passage in a source. Exact match first; then a tolerant
 * match that ignores differences in whitespace and quote characters, mapped
 * back to offsets in the ORIGINAL text so highlights stay accurate.
 * Returns null when the passage is not in the source (an invalid reference).
 */
export function locateQuote(source: SourceText, quote: string): SourceRef | null {
  const q = quote.trim();
  if (q.length < 3) return null;
  const exact = source.text.indexOf(q);
  if (exact >= 0) return { source: source.label, start: exact, end: exact + q.length, quote: q };

  const { norm, map } = normalizeWithMap(source.text);
  const nq = normalizeWithMap(q).norm;
  if (nq.length < 3) return null;
  const at = norm.indexOf(nq);
  if (at < 0) return null;
  const start = map[at]!;
  const end = map[at + nq.length - 1]! + 1;
  return { source: source.label, start, end, quote: source.text.slice(start, end) };
}

function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]!;
    if (/\s/.test(ch)) {
      if (lastWasSpace || norm.length === 0) continue;
      ch = " ";
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
      if ("‘’‛`".includes(ch)) ch = "'";
      else if ("“”‟".includes(ch)) ch = '"';
      else if ("–—".includes(ch)) ch = "-";
      ch = ch.toLowerCase();
    }
    norm += ch;
    map.push(i);
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

/** Re-check a stored reference against its source text (used by exports and tests). */
export function refIsValid(ref: SourceRef, sources: SourceText[]): boolean {
  const s = sources.find((x) => x.label === ref.source);
  if (!s) return false;
  return ref.end <= s.text.length && ref.start < ref.end && s.text.slice(ref.start, ref.end) === ref.quote;
}

/** 1-based line number of an offset, for human-readable citations ("S1 line 4"). */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  single: 1, a: 1, an: 1, double: 2, twice: 2, once: 1, both: 2, pair: 2,
};

/** True when the passage literally mentions the number (as digits or as an English word). */
export function passageMentionsNumber(passage: string, n: number): boolean {
  const p = passage.toLowerCase();
  if (new RegExp(`(^|[^\\d.])${n}([^\\d]|$)`).test(p)) return true;
  for (const [w, v] of Object.entries(NUMBER_WORDS)) {
    if (v === n && w.length > 2 && new RegExp(`\\b${w}\\b`).test(p)) return true;
  }
  return false;
}

/** True when the passage mentions the money amount, e.g. "$300", "300 USD", "USD 300.00", "300.00". */
export function passageMentionsAmount(passage: string, value: string): boolean {
  const p = passage.replace(/,/g, "");
  const [whole, frac] = value.split(".");
  const variants = new Set([value, whole!]);
  if (frac && /^0+$/.test(frac)) variants.add(whole!);
  for (const v of variants) {
    if (new RegExp(`(^|[^\\d])${v.replace(".", "\\.")}([^\\d]|$)`).test(p)) return true;
  }
  return false;
}

const FORMAT_ALIASES: Record<string, string[]> = {
  png: ["png"], svg: ["svg", "vector"], pdf: ["pdf"], jpeg: ["jpeg", "jpg"], zip: ["zip"],
  ai: ["illustrator", ".ai", " ai "], eps: ["eps"], psd: ["psd", "photoshop"], fig: ["figma", ".fig"],
  mp4: ["mp4"], docx: ["docx", "word document"], txt: ["txt", "plain text"],
};

export function passageMentionsFormat(passage: string, format: string): boolean {
  const p = ` ${passage.toLowerCase()} `;
  return (FORMAT_ALIASES[format] ?? [format]).some((a) => p.includes(a));
}
