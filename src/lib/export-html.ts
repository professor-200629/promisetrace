import type { evidenceJson } from "@/lib/services/evidence";

type Record_ = ReturnType<typeof evidenceJson>;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LABEL: Record<string, string> = {
  system_observed: "Recorded by PromiseTrace",
  paypal_api_confirmed: "Confirmed by PayPal API",
  participant_declaration: "Stated by a participant",
  ai_interpretation: "AI interpretation",
  fixture_not_paypal: "FIXTURE — not a PayPal transaction",
};

/** Self-contained, script-free, printable evidence record. */
export function renderEvidenceHtml(r: Record_): string {
  const reqRows = r.requirements.map((q) => `
    <tr class="${q.result === "NOT_MET" ? "bad" : q.result === "NEEDS_REVIEW" || q.result === "NOT_CHECKABLE" ? "warn" : ""}">
      <td><strong>${esc(q.label)}</strong><br><code>${esc(q.key)}</code></td>
      <td>${esc(q.agreed)}<br><small>${esc(q.agreedStatus)}</small>${q.sourcePassages.map((p) => `<blockquote>${esc(p.source)} [${p.start}–${p.end}]: “${esc(p.quote)}”</blockquote>`).join("")}</td>
      <td>${esc(q.observed)}<br><small>${esc(q.observedBy)}</small></td>
      <td><strong>${esc(q.result)}</strong></td>
      <td>${esc(q.buyerResponse ?? "—")}</td>
    </tr>`).join("");
  const events = r.history.events.map((e) => `<tr><td>${e.seq}</td><td>${esc(new Date(e.at).toISOString())}</td><td>${esc(LABEL[e.assertionType ?? ""] ?? e.assertionType)}</td><td>${esc(e.summary)}</td><td><code>${esc(e.hash.slice(0, 16))}</code></td></tr>`).join("");
  const p = r.payment;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence record — ${esc(r.agreement.title)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#17212b;max-width:1100px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #dde3e8;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #dde3e8;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f3f5f7}
tr.bad td{background:#fbe6e3}tr.warn td{background:#fdf6e3}blockquote{margin:4px 0;padding-left:8px;border-left:3px solid #e2b200;font-style:italic;color:#4a5560}
code{font:12px ui-monospace,Menlo,monospace}.note{background:#f3f5f7;padding:10px 12px;border-radius:6px}pre{white-space:pre-wrap;background:#f7f8f9;padding:10px;border:1px solid #dde3e8;border-radius:6px}
small{color:#5b6875}.status{padding:10px 12px;border-radius:6px;border:1px solid #e2b200;background:#fdf6e3}.status.ok{border-color:#2e7d4f;background:#e7f4ec}
</style></head><body>
<h1>${esc(r.agreement.title)}</h1>
<p class="status ${r.status.key === "COMPLETE" ? "ok" : ""}"><strong>Status: ${esc(r.status.label)}</strong> — ${esc(r.status.detail)}</p>
<p>Seller: ${esc(r.agreement.seller)} · Buyer: ${esc(r.agreement.buyer ?? "not joined")} · Agreement ID <code>${esc(r.agreement.id)}</code> · Generated ${esc(r.generatedAt)}</p>
<p class="note">${esc(r.disclaimer)}</p>
<h2>Payment</h2>
${p ? `<p><strong>${esc(p.status)}</strong> — ${esc(p.amount)} · ${esc(LABEL[p.assertionType])}<br>${p.flow === "hold_at_checkout_capture_on_acceptance" ? "Held at checkout (PayPal authorization), captured under the payment terms" : "Captured at checkout"}<br>PayPal order <code>${esc(p.paypalOrderId)}</code>${p.authorizationId ? ` · authorization (hold) <code>${esc(p.authorizationId)}</code> ${esc(p.authorizationStatus ?? "")}${p.holdExpiresAt ? `, expires ${esc(new Date(p.holdExpiresAt).toISOString())}` : ""}` : ""} · capture <code>${esc(p.captureId ?? "—")}</code>${p.captureTrigger && p.captureId ? ` (${p.captureTrigger === "BUYER_ACCEPTED" ? "after the buyer accepted" : "after the review window, all checks met"})` : ""} · invoice <code>${esc(p.invoiceId)}</code> · custom_id <code>${esc(p.customId)}</code>${p.gross ? ` · gross/fee/net ${esc(p.gross)}/${esc(p.fee ?? "—")}/${esc(p.net ?? "—")}` : ""}${p.completedAt ? ` · completed ${esc(new Date(p.completedAt).toISOString())}` : ""}</p>` : "<p>No payment.</p>"}
<h2>Requirements: agreed vs observed</h2>
<table><thead><tr><th>Requirement</th><th>Agreed (with source passage)</th><th>Observed</th><th>Result</th><th>Buyer</th></tr></thead><tbody>${reqRows}</tbody></table>
<p><small>Open buyer objections: ${r.openObjections.length}</small></p>
<h2>Deliveries</h2>
${r.deliveries.map((d) => `<h3>Delivery ${d.number} — received ${esc(new Date(d.submittedAt).toISOString())}</h3>${d.note ? `<p>Seller's statement: “${esc(d.note.text)}”</p>` : ""}<table><thead><tr><th>File</th><th>For</th><th>Detected type</th><th>Bytes</th><th>SHA-256</th><th>Notes</th></tr></thead><tbody>${d.files.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.deliverable)}</td><td>${esc(f.detectedType)}</td><td>${f.bytes}</td><td><code>${esc(f.sha256)}</code></td><td>${esc(f.notes.join(" "))}</td></tr>`).join("")}</tbody></table>`).join("") || "<p>None.</p>"}
<h2>Buyer statements</h2>
${r.buyerActions.length ? `<table><thead><tr><th>When</th><th>Action</th><th>Message</th><th>About</th></tr></thead><tbody>${r.buyerActions.map((a) => `<tr><td>${esc(new Date(a.createdAt).toISOString())}</td><td>${esc(a.type)}</td><td>${esc(a.message)}</td><td>${esc(a.requirementKeys.join(", "))}</td></tr>`).join("")}</tbody></table>` : "<p>None.</p>"}
<h2>Brief versions and approvals</h2>
<table><thead><tr><th>Version</th><th>Kind</th><th>Origin</th><th>Content hash</th><th>Approvals</th><th>State</th></tr></thead><tbody>${r.versions.map((v) => `<tr><td>${v.number}</td><td>${esc(v.kind)}</td><td>${esc(v.origin)}</td><td><code>${esc(v.contentHash.slice(0, 20))}…</code></td><td>${v.approvals.map((a) => `${esc(a.role)} ${esc(new Date(a.createdAt).toISOString())}${a.valid ? "" : " (no longer valid)"}`).join("<br>") || "—"}</td><td>${v.paidAndLocked ? "Paid · locked" : v.superseded ? "Superseded" : v.approvedByBoth ? "Approved by both" : "Open"}</td></tr>`).join("")}</tbody></table>
<h2>AI usage</h2>
${r.aiRuns.length ? `<p>${r.aiRuns.map((a) => `${esc(a.provider)} ${esc(a.model)} — ${esc(a.status)}, ${a.inputTokens}+${a.outputTokens} tokens, $${a.costUsd.toFixed(4)}, ${a.latencyMs} ms`).join("<br>")}</p><p><small>AI output is an interpretation. Every kept value was checked by code against a quoted source passage, then approved by both participants.</small></p>` : "<p>No AI calls.</p>"}
<h2>History (hash chain ${r.history.hashChainIntact ? "intact" : `BROKEN at entry ${r.history.firstBrokenSeq}`})</h2>
<table><thead><tr><th>#</th><th>Time (UTC)</th><th>Kind</th><th>Entry</th><th>Hash</th></tr></thead><tbody>${events}</tbody></table>
<h2>Sources (stored unchanged)</h2>
${r.sources.map((s) => `<h3>${esc(s.label)} — ${esc(s.title)}</h3><p><small>sha256 <code>${esc(s.sha256)}</code></small></p><pre>${esc(s.text)}</pre>`).join("")}
</body></html>`;
}
