"use client";

import { useActionState, useState } from "react";
import { buyerAction, deleteDealAction } from "@/app/actions";
import { Feedback, Submit } from "@/components/forms";

const OPTIONS = [
  { value: "ACKNOWLEDGE_RECEIPT", label: "Acknowledge receipt", help: "I received the files. This is not acceptance." },
  { value: "ACCEPT", label: "Accept", help: "The delivery meets what we agreed." },
  { value: "REQUEST_REVISION", label: "Request a revision", help: "Counts against the included revision rounds." },
  { value: "REPORT_PROBLEM", label: "Report a problem", help: "Something promised is missing or wrong. Stays open until you withdraw it." },
];

export function BuyerResponse({ dealId, requirements, objections, heldAmount }: { dealId: string; requirements: Array<{ key: string; label: string }>; objections: Array<{ id: string; label: string }>; heldAmount: string | null }) {
  const [state, action] = useActionState(buyerAction.bind(null, dealId), null);
  const [type, setType] = useState("ACKNOWLEDGE_RECEIPT");
  const [localError, setLocalError] = useState<string | null>(null);
  const options = OPTIONS.map((o) => (o.value === "ACCEPT" && heldAmount ? { ...o, help: `The delivery meets what we agreed. PayPal then captures the held ${heldAmount}.` } : o));
  const objection = type === "REQUEST_REVISION" || type === "REPORT_PROBLEM";
  return (
    <form
      action={action}
      className="space-y-4"
      onSubmit={(e) => {
        // Check here first: a rejected form action resets the fields, which would wipe what the buyer typed.
        const fd = new FormData(e.currentTarget);
        const problem = !objection ? null
          : fd.getAll("req").length === 0 ? "Choose which agreed requirement this is about, so the seller knows what to fix."
          : String(fd.get("message") ?? "").trim().length < 5 ? "Describe what needs to change so the seller can respond." : null;
        setLocalError(problem);
        if (problem) e.preventDefault();
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium">Your response to the latest delivery</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[...options, ...(objections.length ? [{ value: "WITHDRAW_OBJECTION", label: "Withdraw an objection", help: "Close one of your open objections." }] : [])].map((o) => (
            <label key={o.value} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${type === o.value ? "border-ink bg-slate-50" : "border-line"}`}>
              <input type="radio" name="type" value={o.value} checked={type === o.value} onChange={() => setType(o.value)} />
              <span><span className="font-medium">{o.label}</span><span className="block text-xs text-muted">{o.help}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {type === "WITHDRAW_OBJECTION" && (
        <label className="block text-sm">Objection
          <select name="refersToId" className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm">
            {objections.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )}
      <fieldset>
        <legend className="text-sm">Which requirements does this concern? {type === "REQUEST_REVISION" || type === "REPORT_PROBLEM" ? "(choose at least one)" : "(optional)"}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {requirements.map((r) => (
            <label key={r.key} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs">
              <input type="checkbox" name="req" value={r.key} /> {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">Message {type === "REQUEST_REVISION" || type === "REPORT_PROBLEM" ? "(required)" : "(optional)"}
        <textarea name="message" rows={3} maxLength={2000} className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      <Submit pendingText={type === "ACCEPT" && heldAmount ? "Recording and asking PayPal to capture…" : "Recording…"}>{type === "ACCEPT" && heldAmount ? `Accept and capture the held ${heldAmount}` : "Record my response"}</Submit>
      <p className="text-xs text-muted">Your response is stored as your statement in the agreement history. Opening or downloading files is never treated as acceptance. Complaints recorded here are not PayPal disputes.</p>
      {localError ? <Feedback state={{ error: localError }} /> : <Feedback state={state} />}
    </form>
  );
}

export function DeleteDeal({ dealId }: { dealId: string }) {
  const [state, action] = useActionState(deleteDealAction.bind(null, dealId), null);
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm">Type DELETE to remove this agreement, its sources, files and history from PromiseTrace
        <input name="confirm" autoComplete="off" className="mt-1 block w-48 rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      <Submit variant="danger" pendingText="Deleting…">Delete agreement data</Submit>
      <Feedback state={state} />
    </form>
  );
}
