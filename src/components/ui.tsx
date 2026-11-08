import Link from "next/link";
import type { ReactNode } from "react";
import type { SourceRef } from "@/lib/brief";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, children, className, actions, id }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "agreed" | "observed" | "review" | "bad" | "ai" | "neutral";
const TONE: Record<Tone, string> = {
  agreed: "bg-agreed-bg text-agreed border-agreed/20",
  observed: "bg-observed-bg text-observed border-observed/20",
  review: "bg-review-bg text-review border-review/25",
  bad: "bg-bad-bg text-bad border-bad/20",
  ai: "bg-ai-bg text-ai border-ai/20",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone])}>
      {children}
    </span>
  );
}

export const RESULT_PILL: Record<string, { tone: Tone; label: string }> = {
  MET: { tone: "agreed", label: "Met" },
  NOT_MET: { tone: "bad", label: "Not met" },
  NEEDS_REVIEW: { tone: "review", label: "Needs review" },
  PENDING: { tone: "neutral", label: "Pending" },
  NOT_CHECKABLE: { tone: "review", label: "Buyer to confirm" },
};

export const STATUS_PILL: Record<string, { tone: Tone; label: string }> = {
  sourced: { tone: "agreed", label: "From source" },
  unknown: { tone: "neutral", label: "Unknown" },
  needs_clarification: { tone: "review", label: "Needs clarification" },
  edited: { tone: "observed", label: "Edited" },
};

export const KIND_PILL: Record<string, { tone: Tone; label: string }> = {
  SYSTEM_CONFIRMED: { tone: "observed", label: "Recorded by PromiseTrace" },
  PAYPAL_CONFIRMED: { tone: "agreed", label: "Confirmed by PayPal API" },
  USER_DECLARATION: { tone: "neutral", label: "Stated by a participant" },
  AI_INTERPRETATION: { tone: "ai", label: "AI interpretation" },
};

export function SourceChips({ refs, dealId, lineFor }: { refs: SourceRef[]; dealId: string; lineFor: (r: SourceRef) => number }) {
  if (refs.length === 0) return <span className="text-xs text-muted">No source passage</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((r) => (
        <Link
          key={`${r.source}-${r.start}`}
          href={`/deals/${dealId}?tab=sources#ref-${r.source}-${r.start}`}
          title={`“${r.quote}”`}
          className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 hover:bg-amber-100"
        >
          {r.source} · line {lineFor(r)}
        </Link>
      ))}
    </span>
  );
}

export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="mt-1 border-l-2 border-amber-300 pl-2 text-xs italic text-slate-600">“{children}”</blockquote>;
}

export function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <div className={cx("rounded-lg border px-4 py-3 text-sm", TONE[tone])}>{children}</div>;
}

export function Button({ children, variant = "primary", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const v = {
    primary: "bg-ink text-white hover:bg-slate-800 disabled:bg-slate-400",
    secondary: "border border-line bg-white text-ink hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-bad text-white hover:bg-red-800 disabled:bg-slate-400",
    ghost: "text-observed hover:underline",
  }[variant];
  return (
    <button {...rest} className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed", v, className)}>
      {children}
    </button>
  );
}

export function fmtTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function shortHash(h: string) {
  return `${h.slice(0, 10)}…`;
}
