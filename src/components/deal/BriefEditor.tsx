"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BriefContent, Deliverable, OpenQuestion, SourceRef } from "@/lib/brief";
import { FILE_FORMATS } from "@/lib/brief";
import { PAYPAL_CURRENCIES, minorToValue, parseToMinor } from "@/lib/money";
import { saveBriefAction, type ActionState } from "@/app/actions";
import { Banner, Button, Pill, STATUS_PILL, cx } from "@/components/ui";
import { Feedback } from "@/components/forms";

type Props = {
  dealId: string;
  versionId: string;
  versionNumber: number;
  content: BriefContent;
  editable: boolean;
  lockedReason?: string;
  refLines: Record<string, number>;
};

const TZ = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];
const field = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-700";

export function BriefEditor({ dealId, versionId, versionNumber, content, editable, lockedReason, refLines }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<BriefContent>(() => structuredClone(content));
  const [amount, setAmount] = useState(content.price.amountMinor !== null && content.price.currency ? minorToValue(content.price.amountMinor, content.price.currency) : "");
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(content) || amount !== (content.price.amountMinor !== null && content.price.currency ? minorToValue(content.price.amountMinor, content.price.currency) : ""), [draft, content, amount]);

  const set = (fn: (d: BriefContent) => void) => setDraft((d) => { const c = structuredClone(d); fn(c); return c; });

  const save = () => {
    const next = structuredClone(draft);
    if (amount.trim() === "") next.price.amountMinor = null;
    else {
      if (!next.price.currency) return setState({ error: "Choose a currency for the price." });
      try { next.price.amountMinor = parseToMinor(amount, next.price.currency); } catch (e) { return setState({ error: e instanceof Error ? e.message : "Invalid amount" }); }
    }
    start(async () => {
      const r = await saveBriefAction(dealId, versionId, next);
      setState(r);
      if (r?.ok) router.replace(`/deals/${dealId}?tab=brief&saved=${r.version ?? ""}`);
    });
  };

  const dis = !editable || pending;
  return (
    <div className="space-y-5">
      {!editable && lockedReason && <Banner tone="observed">{lockedReason}</Banner>}
      <label className="block text-sm font-medium">Title
        <input className={field} disabled={dis} value={draft.title} maxLength={120} onChange={(e) => set((d) => { d.title = e.target.value; })} />
      </label>

      <FieldBlock title="Price" status={draft.price.status} editedBy={draft.price.editedBy} refs={draft.price.refs} refLines={refLines} dealId={dealId}>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <label className="text-sm">Amount<input className={field} disabled={dis} inputMode="decimal" value={amount} placeholder="unknown" onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="text-sm">Currency
            <select className={field} disabled={dis} value={draft.price.currency ?? ""} onChange={(e) => set((d) => { d.price.currency = e.target.value || null; })}>
              <option value="">unknown</option>
              {Object.keys(PAYPAL_CURRENCIES).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </FieldBlock>

      <FieldBlock title="Deadline" status={draft.deadline.status} editedBy={draft.deadline.editedBy} refs={draft.deadline.refs} refLines={refLines} dealId={dealId}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Date<input type="date" className={field} disabled={dis} value={draft.deadline.date ?? ""} onChange={(e) => set((d) => { d.deadline.date = e.target.value || null; })} /></label>
          <label className="text-sm">Time (optional)<input type="time" className={field} disabled={dis} value={draft.deadline.time ?? ""} onChange={(e) => set((d) => { d.deadline.time = e.target.value || null; })} /></label>
          <label className="text-sm">Timezone
            <input list="tz-list" className={field} disabled={dis} value={draft.deadline.timezone ?? ""} placeholder="unknown" onChange={(e) => set((d) => { d.deadline.timezone = e.target.value || null; })} />
            <datalist id="tz-list">{TZ.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
        </div>
      </FieldBlock>

      <FieldBlock title="Revision rounds included" status={draft.revisionRounds.status} editedBy={draft.revisionRounds.editedBy} refs={draft.revisionRounds.refs} refLines={refLines} dealId={dealId}>
        <input type="number" min={0} max={20} className={cx(field, "max-w-32")} disabled={dis} value={draft.revisionRounds.count ?? ""} placeholder="unknown"
          onChange={(e) => set((d) => { d.revisionRounds.count = e.target.value === "" ? null : Math.max(0, Math.min(20, Number(e.target.value))); })} />
      </FieldBlock>

      <div>
        <h3 className="text-sm font-semibold">Deliverables</h3>
        <div className="mt-2 space-y-3">
          {draft.deliverables.map((dv, i) => (
            <DeliverableRow key={dv.key} d={dv} disabled={dis} refLines={refLines} dealId={dealId}
              onChange={(nd) => set((d) => { d.deliverables[i] = nd; })}
              onRemove={() => set((d) => { d.deliverables.splice(i, 1); })} />
          ))}
          {editable && (
            <Button type="button" variant="secondary" disabled={dis || draft.deliverables.length >= 12} onClick={() => set((d) => {
              const n = Math.max(0, ...d.deliverables.map((x) => Number(x.key.slice(1)))) + 1;
              d.deliverables.push({ key: `D${n}`, label: "New deliverable", quantity: null, formats: [], refs: [], status: "edited" });
            })}>Add deliverable</Button>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Open questions <span className="font-normal text-muted">— resolve these before approving</span></h3>
        {draft.openQuestions.length === 0 && <p className="mt-1 text-sm text-muted">None.</p>}
        <ul className="mt-2 space-y-2">
          {draft.openQuestions.map((q: OpenQuestion, i) => (
            <li key={q.key} className="flex items-start gap-2">
              <Pill tone={q.origin === "AI" ? "ai" : "review"}>{q.origin === "AI" ? "AI question" : "Gap found by checks"}</Pill>
              <input aria-label={`Question ${q.key}`} className={cx(field, "mt-0")} disabled={dis} value={q.text} onChange={(e) => set((d) => { d.openQuestions[i]!.text = e.target.value; })} />
              {editable && <Button type="button" variant="ghost" disabled={dis} onClick={() => set((d) => { d.openQuestions.splice(i, 1); })} aria-label={`Mark ${q.key} resolved`}>Resolved</Button>}
            </li>
          ))}
        </ul>
      </div>

      {editable && (
        <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 px-5 py-3 backdrop-blur">
          <Button type="button" onClick={save} disabled={!dirty || pending}>{pending ? "Saving…" : `Save as version ${versionNumber + 1}`}</Button>
          {dirty ? <span className="text-xs text-review">Unsaved changes. Saving creates a new version and both sides must approve again.</span> : <span className="text-xs text-muted">No unsaved changes.</span>}
          <Feedback state={state} />
        </div>
      )}
    </div>
  );
}

function FieldBlock({ title, status, editedBy, refs, refLines, dealId, children }: { title: string; status: string; editedBy?: string; refs: SourceRef[]; refLines: Record<string, number>; dealId: string; children: React.ReactNode }) {
  const p = STATUS_PILL[status] ?? STATUS_PILL.unknown!;
  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
        {title} <Pill tone={p.tone}>{status === "edited" && editedBy ? `Edited by ${editedBy.toLowerCase()}` : p.label}</Pill>
      </legend>
      {children}
      <Refs refs={refs} refLines={refLines} dealId={dealId} edited={status === "edited"} />
    </fieldset>
  );
}

function Refs({ refs, refLines, dealId, edited }: { refs: SourceRef[]; refLines: Record<string, number>; dealId: string; edited?: boolean }) {
  if (refs.length === 0) return <p className="mt-2 text-xs text-muted">No source passage supports this value.</p>;
  return (
    <div className="mt-2 space-y-1">
      {edited && <p className="text-xs text-observed">Changed after extraction. The passage below is what the source originally said.</p>}
      {refs.map((r) => (
        <p key={`${r.source}-${r.start}`} className="text-xs text-slate-600">
          <a className="mr-1 rounded border border-amber-300 bg-amber-50 px-1 font-mono text-[11px] text-amber-900" href={`/deals/${dealId}?tab=sources#ref-${r.source}-${r.start}`}>{r.source} · line {refLines[`${r.source}-${r.start}`] ?? "?"}</a>
          <span className="italic">“{r.quote}”</span>
        </p>
      ))}
    </div>
  );
}

function DeliverableRow({ d, disabled, onChange, onRemove, refLines, dealId }: { d: Deliverable; disabled: boolean; onChange: (d: Deliverable) => void; onRemove: () => void; refLines: Record<string, number>; dealId: string }) {
  const p = STATUS_PILL[d.status] ?? STATUS_PILL.unknown!;
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">{d.key}</span>
        <Pill tone={p.tone}>{d.status === "edited" && d.editedBy ? `Edited by ${d.editedBy.toLowerCase()}` : p.label}</Pill>
        {!disabled && <Button type="button" variant="ghost" className="ml-auto" onClick={onRemove}>Remove</Button>}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_7rem]">
        <label className="text-sm">What is delivered<input className={field} disabled={disabled} value={d.label} maxLength={120} onChange={(e) => onChange({ ...d, label: e.target.value })} /></label>
        <label className="text-sm">Quantity<input type="number" min={1} max={100} className={field} disabled={disabled} value={d.quantity ?? ""} placeholder="—" onChange={(e) => onChange({ ...d, quantity: e.target.value === "" ? null : Math.max(1, Math.min(100, Number(e.target.value))) })} /></label>
      </div>
      <fieldset className="mt-3">
        <legend className="text-sm">File formats</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {FILE_FORMATS.map((f) => (
            <label key={f} className={cx("flex items-center gap-1 rounded border px-2 py-1 text-xs", d.formats.includes(f) ? "border-ink bg-slate-100" : "border-line")}>
              <input type="checkbox" disabled={disabled} checked={d.formats.includes(f)} onChange={(e) => onChange({ ...d, formats: e.target.checked ? [...d.formats, f] : d.formats.filter((x) => x !== f) })} />
              {f.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>
      <Refs refs={d.refs} refLines={refLines} dealId={dealId} edited={d.status === "edited"} />
    </div>
  );
}
