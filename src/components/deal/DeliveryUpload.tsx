"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";

type D = { key: string; label: string; formats: string[]; quantity: number | null };

export function DeliveryUpload({ dealId, deliverables, maxMb, maxTotalBytes }: { dealId: string; deliverables: D[]; maxMb: number; maxTotalBytes: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "agreed" | "bad" | "review"; text: string } | null>(null);
  const totalMb = (maxTotalBytes / 1048576).toFixed(1).replace(/\.0$/, "");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        const fd = new FormData(e.currentTarget);
        const total = [...fd.values()].reduce((n, v) => n + (typeof v === "string" ? 0 : v.size), 0);
        if (total > maxTotalBytes) {
          setMsg({ tone: "bad", text: `These files add up to ${(total / 1048576).toFixed(1)} MB. One delivery can be at most ${totalMb} MB in total on this host; send the rest as a second delivery.` });
          return;
        }
        setBusy(true);
        try {
          const r = await fetch(`/api/deals/${dealId}/deliveries`, { method: "POST", body: fd });
          if (r.status === 413) throw new Error(`The host refused the upload as too large. Keep one delivery under ${totalMb} MB in total.`);
          const j = (await r.json().catch(() => ({}))) as { error?: string; summary?: { pass: number; fail: number; review: number; notCheckable: number }; missing?: string[] };
          if (!r.ok) throw new Error(j.error ?? `Upload failed (HTTP ${r.status})`);
          const s = j.summary!;
          setMsg(s.fail > 0
            ? { tone: "bad", text: `Delivery recorded. Not met yet: ${j.missing!.join("; ")}.` }
            : { tone: s.review > 0 ? "review" : "agreed", text: `Delivery recorded. ${s.pass} checks met${s.review ? `, ${s.review} need review` : ""}${s.notCheckable ? `, ${s.notCheckable} for the buyer to confirm` : ""}.` });
          (e.target as HTMLFormElement).reset();
          router.refresh();
        } catch (err) {
          setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Upload failed" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {deliverables.map((d) => (
        <label key={d.key} className="block rounded-lg border border-line p-3 text-sm">
          <span className="font-medium">{d.key} · {d.label}</span>
          <span className="ml-2 text-xs text-muted">promised: {d.quantity ? `${d.quantity} × ` : ""}{d.formats.length ? d.formats.map((f) => f.toUpperCase()).join(", ") : "no format specified"}</span>
          <input type="file" name={`file:${d.key}`} multiple accept=".png,.jpg,.jpeg,.svg,.pdf,.zip" className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2" />
        </label>
      ))}
      <label className="block text-sm font-medium">Note to the buyer (optional, recorded as your statement)
        <textarea name="note" rows={2} maxLength={2000} className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Uploading and checking…" : "Submit delivery"}</Button>
        <span className="text-xs text-muted">PNG, JPEG, SVG, PDF or ZIP, up to {maxMb} MB each and {totalMb} MB per delivery. Types are read from file contents. Files are private to this agreement.</span>
      </div>
      <div aria-live="polite">{msg && <Banner tone={msg.tone}>{msg.text}</Banner>}</div>
    </form>
  );
}
