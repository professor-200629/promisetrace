import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { buildDealView, actionLabel, type DealView } from "@/lib/services/evidence";
import { lineOf } from "@/lib/sources";
import { env, paypalSetup, aiSetup } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { deadlineInstant, paymentBlockers, type SourceRef } from "@/lib/brief";
import { Banner, Card, KIND_PILL, Pill, RESULT_PILL, SourceChips, cx, fmtTime, shortHash } from "@/components/ui";
import { ApproveForm, AmendmentForm, CopyField, InviteRegenerate, RetryExtraction } from "@/components/forms";
import { BriefEditor } from "@/components/deal/BriefEditor";
import { PayPalCheckout } from "@/components/deal/PayPalCheckout";
import { DeliveryUpload } from "@/components/deal/DeliveryUpload";
import { BuyerResponse, DeleteDeal } from "@/components/deal/BuyerResponse";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["brief", "Brief & approval"],
  ["payment", "Payment"],
  ["delivery", "Delivery"],
  ["record", "History & export"],
  ["sources", "Sources"],
] as const;

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string }> }) {
  const { id } = await params;
  const { tab: rawTab, saved } = await searchParams;
  const tab = TABS.some(([k]) => k === rawTab) ? rawTab! : "overview";
  const user = await requireUser(`/deals/${id}`);
  let view: DealView;
  try {
    view = await buildDealView(prisma, id, user.id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const inviteToken = (await cookies()).get(`pt_invite_${id}`)?.value ?? null;
  const lineFor = (r: SourceRef) => lineOf(view.sources.find((s) => s.label === r.source)?.text ?? "", r.start);
  const next = nextStep(view);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Agreement · you are the {view.role.toLowerCase()}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{view.deal.title}</h1>
          <p className="text-sm text-muted">Seller {view.participants.seller} · Buyer {view.participants.buyer ?? "not joined yet"}</p>
        </div>
        <a href={`/api/deals/${id}/export?format=html`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">Export evidence record</a>
      </div>

      <StatusTiles view={view} />

      {next && (
        <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3", next.mine ? "border-ink bg-white" : "border-line bg-slate-50")}>
          <p className="text-sm"><span className="font-semibold">{next.mine ? "Your next step: " : "Waiting: "}</span>{next.text}</p>
          {next.tab && next.tab !== tab && <Link href={`/deals/${id}?tab=${next.tab}`} className="rounded-lg bg-ink px-3 py-2 text-sm text-white">Go</Link>}
        </div>
      )}

      <nav aria-label="Agreement sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/deals/${id}?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === k ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>

      <div className="fade-in">
        {tab === "overview" && <Overview view={view} lineFor={lineFor} />}
        {tab === "brief" && <BriefTab view={view} inviteToken={inviteToken} lineFor={lineFor} saved={saved && /^\d+$/.test(saved) ? Number(saved) : null} />}
        {tab === "payment" && <PaymentTab view={view} />}
        {tab === "delivery" && <DeliveryTab view={view} />}
        {tab === "record" && <RecordTab view={view} />}
        {tab === "sources" && <SourcesTab view={view} />}
      </div>
    </div>
  );
}

function StatusTiles({ view }: { view: DealView }) {
  const p = view.payment.latest;
  const paidText = view.payment.isPaid ? (p?.mode === "FIXTURE" ? "Paid — FIXTURE, not a PayPal transaction" : "Paid — PayPal sandbox capture COMPLETED") : p ? `Payment: ${p.status.replace(/_/g, " ").toLowerCase()}` : "Not paid";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-agreed/25 bg-agreed-bg p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-agreed">Agreed</p>
        <p className="mt-1 text-sm font-medium">{view.summary.agreed}</p>
        <p className="mt-1 text-xs text-slate-600">{paidText}</p>
      </div>
      <div className="rounded-xl border border-observed/25 bg-observed-bg p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-observed">Observed</p>
        <p className="mt-1 text-sm font-medium">{view.summary.observed}</p>
        <p className="mt-1 text-xs text-slate-600">{view.summary.met} of {view.summary.total} requirements met · {view.acceptance ? `buyer ${actionLabel(view.acceptance.type).toLowerCase()}` : "no buyer acceptance yet"}</p>
      </div>
      <div className={cx("rounded-xl border p-4", view.summary.needsReview > 0 ? "border-review/30 bg-review-bg" : "border-line bg-white")}>
        <p className={cx("text-xs font-semibold uppercase tracking-wide", view.summary.needsReview > 0 ? "text-review" : "text-muted")}>Needs review</p>
        <p className="mt-1 text-sm font-medium">{view.summary.needsReview === 0 ? "Nothing flagged" : `${view.summary.needsReview} item${view.summary.needsReview === 1 ? "" : "s"}`}</p>
        <p className="mt-1 text-xs text-slate-600">{view.openObjections.length} open buyer objection{view.openObjections.length === 1 ? "" : "s"}</p>
      </div>
    </div>
  );
}

function nextStep(v: DealView): { text: string; mine: boolean; tab?: string } | null {
  const seller = v.role === "SELLER";
  if (!v.working && !v.effective) return { text: seller ? "Run extraction or enter the brief." : "The seller has not proposed a brief yet.", mine: seller, tab: "brief" };
  if (!v.deal.hasBuyer) return { text: seller ? "Share the private invite link with your client." : "", mine: seller, tab: "brief" };
  const w = v.working;
  if (w && !v.workingApproved && !w.row.lockedAt) {
    const mine = v.versions.find((x) => x.id === w.row.id)?.approvals.some((a) => a.role === v.role && a.valid);
    return mine
      ? { text: `You approved version ${w.row.number}. Waiting for the ${seller ? "buyer" : "seller"} to approve the same version.`, mine: false, tab: "brief" }
      : { text: `Review and approve version ${w.row.number}${w.row.kind === "AMENDMENT" ? " (amendment)" : ""}.`, mine: true, tab: "brief" };
  }
  const p = v.payment.latest;
  if (!v.payment.isPaid) {
    if (p?.status === "CAPTURE_PENDING") return { text: "PayPal reports the payment as pending. Deliveries open once PayPal completes it.", mine: false, tab: "payment" };
    if (p && ["REFUNDED", "REVERSED", "PARTIALLY_REFUNDED"].includes(p.status)) return { text: `PayPal reports this payment ${p.status.toLowerCase()}.`, mine: false, tab: "payment" };
    return seller ? { text: "Waiting for the buyer to pay through PayPal.", mine: false, tab: "payment" } : { text: "Pay for the approved brief with PayPal (sandbox).", mine: true, tab: "payment" };
  }
  if (v.deliveries.length === 0) return seller ? { text: "Upload the promised files.", mine: true, tab: "delivery" } : { text: "Waiting for the seller to deliver.", mine: false, tab: "delivery" };
  const notMet = v.rows.filter((r) => r.result === "NOT_MET");
  if (notMet.length) return seller ? { text: `Not met yet: ${notMet.map((r) => r.label).join("; ")}. Upload the missing items.`, mine: true, tab: "delivery" } : { text: `Not met yet: ${notMet.map((r) => r.label).join("; ")}. You can report a problem or wait for the seller.`, mine: true, tab: "delivery" };
  if (!v.acceptance || v.acceptance.type !== "ACCEPT") return seller ? { text: "All checkable items are present. Waiting for the buyer's response.", mine: false, tab: "delivery" } : { text: "Review the delivery and record your response.", mine: true, tab: "delivery" };
  if (v.openObjections.length) return { text: "The buyer accepted, but an objection is still open.", mine: !seller, tab: "delivery" };
  return { text: "Delivered, checked and accepted. Export the record for your files.", mine: false, tab: "record" };
}

function Overview({ view, lineFor }: { view: DealView; lineFor: (r: SourceRef) => number }) {
  if (view.rows.length === 0) return <Card><p className="text-sm text-muted">No brief yet.</p></Card>;
  return (
    <div className="space-y-4">
      <Card title="Requirement by requirement" actions={<span className="text-xs text-muted">Basis: {view.effective ? `paid${view.effective.row.kind === "AMENDMENT" ? " + amended" : ""} version ${view.effective.row.number}` : `proposed version ${view.working?.row.number ?? "?"} (not yet paid)`}</span>}>
        <p className="mb-3 text-xs text-muted"><strong className="text-agreed">Agreed</strong> = in the approved brief, linked to the source sentence. <strong className="text-observed">Observed</strong> = recorded by PromiseTrace&apos;s code or confirmed by PayPal&apos;s API. Results never come from the AI.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Requirement</th>
                <th className="py-2 pr-3 font-medium">Agreed</th>
                <th className="py-2 pr-3 font-medium">Observed</th>
                <th className="py-2 pr-3 font-medium">Result</th>
                <th className="py-2 font-medium">Buyer</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => {
                const res = RESULT_PILL[r.result]!;
                return (
                  <tr key={r.key} className={cx("border-b border-line align-top", r.result === "NOT_MET" && "bg-bad-bg/40")}>
                    <td className="py-3 pr-3"><div className="font-medium">{r.label}</div><div className="font-mono text-[11px] text-muted">{r.key}</div></td>
                    <td className="py-3 pr-3"><div>{r.agreed}</div><div className="mt-1"><SourceChips refs={r.refs} dealId={view.deal.id} lineFor={lineFor} /></div>{r.agreedStatus !== "sourced" && <div className="mt-1 text-[11px] text-review">{r.agreedStatus === "edited" ? "Edited after extraction" : r.agreedStatus === "unknown" ? "Not stated in the source" : "Ambiguous in the source"}</div>}</td>
                    <td className="py-3 pr-3"><div>{r.observed}</div><div className="mt-1 text-[11px] text-muted">{r.observedBy}</div></td>
                    <td className="py-3 pr-3"><Pill tone={res.tone}>{res.label}</Pill></td>
                    <td className="py-3 text-xs text-slate-700">{r.buyerResponse ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {view.openObjections.length > 0 && (
        <Card title="Open buyer objections">
          <ul className="space-y-2 text-sm">
            {view.buyerActions.filter((a) => view.openObjections.includes(a.id)).map((a) => (
              <li key={a.id} className="rounded-lg border border-review/30 bg-review-bg p-3"><Pill tone="review">{actionLabel(a.type)}</Pill> <span className="ml-1">“{a.message}”</span> <span className="block text-xs text-muted">{fmtTime(a.createdAt)} · stays open until the buyer withdraws it</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BriefTab({ view, inviteToken, lineFor, saved }: { view: DealView; inviteToken: string | null; lineFor: (r: SourceRef) => number; saved: number | null }) {
  const w = view.working;
  const refLines: Record<string, number> = {};
  const all = w ? [w.content.price.refs, w.content.deadline.refs, w.content.revisionRounds.refs, ...w.content.deliverables.map((d) => d.refs), ...w.content.openQuestions.map((q) => q.refs)].flat() : [];
  for (const r of all) refLines[`${r.source}-${r.start}`] = lineFor(r);
  const wv = w ? view.versions.find((x) => x.id === w.row.id) : null;
  const approvedByMe = wv?.approvals.some((a) => a.role === view.role && a.valid);
  const isLockedOriginal = !!w?.row.lockedAt;
  const isAgreedAmendment = w?.row.kind === "AMENDMENT" && wv?.approved;
  const editable = !!w && !isLockedOriginal && !isAgreedAmendment && !(view.payment.latest && ["CAPTURE_PENDING"].includes(view.payment.latest.status));
  const blockers = w && w.row.kind === "ORIGINAL" ? paymentBlockers(w.content) : [];
  const lastRun = view.aiRuns.at(-1);
  const appUrl = env().APP_URL;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {saved !== null && w?.row.number === saved && <Banner tone="agreed">Saved as version {saved}. Earlier approvals no longer count; both sides approve this version again.</Banner>}
        {!view.deal.hasBuyer && view.role === "SELLER" && (
          <Card title="Invite the buyer">
            {inviteToken ? <CopyField label="Private invite link (single use, expires in 14 days). Shown once — copy it now." value={`${appUrl}/invite/${inviteToken}`} /> : <p className="text-sm text-muted">The invite link is shown only right after it is created.</p>}
            <div className="mt-3"><InviteRegenerate dealId={view.deal.id} /></div>
          </Card>
        )}
        {!w ? (
          <Card title="No brief yet"><RetryExtraction dealId={view.deal.id} /></Card>
        ) : (
          <Card title={`Version ${w.row.number}${w.row.kind === "AMENDMENT" ? " — amendment draft" : ""}`} actions={<span className="font-mono text-xs text-muted" title={w.row.contentHash}>hash {shortHash(w.row.contentHash)}</span>}>
            {lastRun && w.row.number === 1 && w.row.kind === "ORIGINAL" && (
              <div className="mb-4">
                <Banner tone={lastRun.provider === "fixture" ? "review" : "ai"}>
                  {lastRun.status === "OK" ? (
                    <>Proposed by {lastRun.provider === "fixture" ? "the rule-based FIXTURE extractor (not AI)" : `${lastRun.model} (AI interpretation)`}. Values without a verified source passage were left unknown. Check every field before approving.{lastRun.provider !== "fixture" && ` ${lastRun.inputTokens + lastRun.outputTokens} tokens, about $${lastRun.costUsd.toFixed(4)}, ${(lastRun.latencyMs / 1000).toFixed(1)} s.`}</>
                  ) : (
                    <>AI extraction did not run ({lastRun.status}): {lastRun.error} Fill in the brief by hand.</>
                  )}
                </Banner>
              </div>
            )}
            <BriefEditor key={w.row.id} dealId={view.deal.id} versionId={w.row.id} versionNumber={Math.max(...view.versions.map((x) => x.number))} content={w.content} editable={editable} refLines={refLines}
              lockedReason={isLockedOriginal ? "This version is the paid agreement and cannot change. Use “Propose an amendment” to agree a change; the paid record stays as it is." : isAgreedAmendment ? "Both sides agreed this amendment. Start a new amendment for further changes." : undefined} />
          </Card>
        )}
      </div>
      <aside className="space-y-4">
        {w && wv && (
          <Card title="Approvals">
            <ul className="space-y-2 text-sm">
              {(["SELLER", "BUYER"] as const).map((role) => {
                const a = wv.approvals.find((x) => x.role === role && x.valid);
                return <li key={role} className="flex items-center justify-between gap-2"><span>{role === "SELLER" ? view.participants.seller : view.participants.buyer ?? "Buyer (not joined)"}</span>{a ? <Pill tone="agreed">Approved {fmtTime(a.createdAt).slice(5, 16)}</Pill> : <Pill>Not yet</Pill>}</li>;
              })}
            </ul>
            <p className="mt-3 text-xs text-muted">An approval applies to this exact version (hash {shortHash(w.row.contentHash)}). Any edit before payment creates a new version and needs new approvals.</p>
            {blockers.length > 0 && <div className="mt-3"><Banner tone="review">{blockers.join(" ")}</Banner></div>}
            {!isLockedOriginal && !wv.approved && !approvedByMe && blockers.length === 0 && view.deal.hasBuyer && (
              <div className="mt-3"><ApproveForm dealId={view.deal.id} versionId={w.row.id} contentHash={w.row.contentHash} label={`Approve version ${w.row.number}`} /></div>
            )}
            {!view.deal.hasBuyer && <p className="mt-3 text-xs text-muted">Approval opens once the buyer has joined.</p>}
            {w.content.openQuestions.length > 0 && !wv.approved && <p className="mt-3 text-xs text-review">{w.content.openQuestions.length} open question(s). Resolve them in the brief, or approve knowingly.</p>}
          </Card>
        )}
        {view.paidVersionId && (!w || w.row.lockedAt || (w.row.kind === "AMENDMENT" && view.versions.find((x) => x.id === w.row.id)?.approved)) && (
          <Card title="Change after payment"><p className="mb-3 text-sm text-muted">Paid agreements are never edited. An amendment is a new version both sides approve; delivery is then checked against it.</p><AmendmentForm dealId={view.deal.id} /></Card>
        )}
        <Card title="Versions">
          <ol className="space-y-2 text-xs">
            {[...view.versions].reverse().map((v) => (
              <li key={v.id} className="rounded-lg border border-line p-2">
                <div className="flex flex-wrap items-center gap-1"><strong>v{v.number}</strong> <Pill>{v.kind === "AMENDMENT" ? "Amendment" : "Original"}</Pill> <Pill tone={v.origin === "AI_PROPOSED" ? "ai" : "neutral"}>{v.origin === "AI_PROPOSED" ? "Proposed" : v.origin === "EDITED" ? "Edited" : "Manual"}</Pill>
                  {v.lockedAt && <Pill tone="agreed">Paid · locked</Pill>}{v.approved && !v.lockedAt && <Pill tone="agreed">Approved by both</Pill>}{v.supersededAt && <Pill>Superseded</Pill>}</div>
                <div className="mt-1 text-muted">{fmtTime(v.createdAt)} · {shortHash(v.contentHash)}</div>
              </li>
            ))}
          </ol>
        </Card>
      </aside>
    </div>
  );
}

function PaymentTab({ view }: { view: DealView }) {
  const setup = paypalSetup();
  const w = view.working;
  const p = view.payment.latest;
  const canPay = view.role === "BUYER" && w && w.row.kind === "ORIGINAL" && !w.row.lockedAt && view.workingApproved && !view.payment.isPaid && p?.status !== "CAPTURE_PENDING";
  const price = w?.content.price;
  const amountLabel = price?.amountMinor != null && price.currency ? formatMoney(price.amountMinor, price.currency) : "";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        {setup.state === "missing_credentials" && <Banner tone="bad"><strong>PayPal sandbox is not configured.</strong> Add {setup.missing.join(" and ")} to .env (see Setup status). Checkout is disabled; nothing is simulated.</Banner>}
        {p && (
          <Card title="Payment record" actions={<Pill tone={p.mode === "FIXTURE" ? "review" : "agreed"}>{p.mode === "FIXTURE" ? "FIXTURE — not PayPal" : "Confirmed with PayPal sandbox API"}</Pill>}>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Status</dt><dd><strong>{p.status}</strong>{p.statusReason ? ` — ${p.statusReason}` : ""}</dd>
              <dt className="text-muted">Amount</dt><dd>{formatMoney(p.amountMinor, p.currency)} (from approved version hash {shortHash(p.versionHash)})</dd>
              <dt className="text-muted">PayPal order</dt><dd className="font-mono text-xs">{p.paypalOrderId ?? "—"}</dd>
              <dt className="text-muted">Capture</dt><dd className="font-mono text-xs">{p.captureId ?? "—"} {p.captureStatus ? `(${p.captureStatus})` : ""}</dd>
              <dt className="text-muted">Invoice / custom ID</dt><dd className="font-mono text-xs">{p.invoiceId} · {p.customId}</dd>
              {p.grossValue && <><dt className="text-muted">Gross / fee / net</dt><dd>{p.grossValue} / {p.feeValue ?? "—"} / {p.netValue ?? "—"} {p.currency}</dd></>}
              {p.completedAt && <><dt className="text-muted">Completed</dt><dd>{fmtTime(p.completedAt)}</dd></>}
            </dl>
          </Card>
        )}
        {canPay && setup.state !== "missing_credentials" && (
          <Card title="Pay with PayPal">
            <PayPalCheckout dealId={view.deal.id} clientId={setup.state === "ready" ? env().PAYPAL_CLIENT_ID ?? null : null} currency={price!.currency!} mode={setup.state === "ready" ? "sandbox" : "fixture"} amountLabel={amountLabel} />
          </Card>
        )}
        {!canPay && !view.payment.isPaid && (
          <Card><p className="text-sm text-muted">{view.role === "SELLER" ? "Only the buyer can start checkout, after both of you approve the same version." : !view.workingApproved ? "Checkout opens after both of you approve the same version of the brief." : p?.status === "CAPTURE_PENDING" ? "PayPal reports this payment as pending. PromiseTrace updates when PayPal sends a verified webhook or the capture is re-checked." : "Checkout is not available for this version."}</p></Card>
        )}
      </div>
      <aside className="space-y-3 text-sm text-muted">
        <Card title="How payment is verified">
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li>The order is created on the server with the price, currency and version from the database. The browser cannot change them.</li>
            <li>Approving in the PayPal window is not payment. Only a capture that PayPal returns as COMPLETED, with the exact amount, currency, custom ID and invoice ID, marks the agreement paid.</li>
            <li>PENDING, DECLINED, REFUNDED and REVERSED are shown as such and are never treated as paid.</li>
            <li>Create and capture calls carry a PayPal-Request-Id, so a retried click cannot create a second order or capture.</li>
            <li>A screenshot of a payment is not evidence here; only PayPal API responses and signed webhooks are.</li>
          </ul>
        </Card>
        <p className="text-xs">This is ordinary single-merchant PayPal Checkout in the sandbox. PromiseTrace never holds funds, and its records do not decide PayPal claims or Seller Protection.</p>
      </aside>
    </div>
  );
}

function DeliveryTab({ view }: { view: DealView }) {
  const e = env();
  const brief = view.effective?.content;
  const requirementOptions = brief ? [...brief.deliverables.map((d) => ({ key: d.key, label: `${d.key} ${d.label}` })), { key: "deadline", label: "Deadline" }, { key: "revisions", label: "Revisions" }] : [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        {view.role === "SELLER" && view.payment.isPaid && brief && (
          <Card title="Submit a delivery"><DeliveryUpload dealId={view.deal.id} deliverables={brief.deliverables.map((d) => ({ key: d.key, label: d.label, formats: d.formats, quantity: d.quantity }))} maxMb={Math.round(e.MAX_UPLOAD_BYTES / 1048576)} /></Card>
        )}
        {!view.payment.isPaid && <Card><p className="text-sm text-muted">Deliveries open after PayPal confirms a COMPLETED capture.</p></Card>}
        {[...view.deliveries].reverse().map((d) => (
          <Card key={d.id} title={`Delivery ${d.number}`} actions={<span className="text-xs text-muted">received {fmtTime(d.submittedAt)} (server time)</span>}>
            {d.note && <p className="mb-3 text-sm"><Pill>Seller&apos;s statement</Pill> <span className="ml-1">“{d.note}”</span></p>}
            <ul className="space-y-2">
              {d.files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm">
                  <span className="font-mono text-xs text-muted">{f.deliverableKey}</span>
                  <span className="font-medium">{f.name}</span>
                  <Pill tone={f.detectedType === f.declaredExt ? "observed" : "review"}>content: {f.detectedType.toUpperCase()}</Pill>
                  {f.widthPx && <span className="text-xs text-muted">{f.widthPx}×{f.heightPx}px</span>}
                  <span className="text-xs text-muted">{(f.sizeBytes / 1024).toFixed(1)} KB · sha256 {shortHash(f.sha256)}</span>
                  <a className="ml-auto text-xs underline" href={`/api/files/${f.id}`}>Download</a>
                  {f.safetyNotes.length > 0 && <p className="w-full text-xs text-review">{f.safetyNotes.join(" ")}</p>}
                </li>
              ))}
            </ul>
            <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Checks recorded at submission ({d.checks.filter((c) => c.result === "FAIL").length} not met)</summary>
              <ul className="mt-2 space-y-1">{d.checks.map((c) => <li key={c.requirementKey}><Pill tone={RESULT_PILL[c.result === "PASS" ? "MET" : c.result === "FAIL" ? "NOT_MET" : c.result]!.tone}>{c.result}</Pill> <span className="font-mono">{c.requirementKey}</span> — {c.observed}</li>)}</ul>
            </details>
          </Card>
        ))}
      </div>
      <aside className="space-y-4">
        {view.role === "BUYER" && view.deliveries.length > 0 && (
          <Card title="Respond"><BuyerResponse dealId={view.deal.id} requirements={requirementOptions} objections={view.buyerActions.filter((a) => view.openObjections.includes(a.id)).map((a) => ({ id: a.id, label: `${actionLabel(a.type)}: ${a.message.slice(0, 60)}` }))} /></Card>
        )}
        <Card title="Buyer responses">
          {view.buyerActions.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="space-y-2 text-sm">{view.buyerActions.map((a) => <li key={a.id}><Pill tone={a.type === "ACCEPT" ? "agreed" : a.type === "REQUEST_REVISION" || a.type === "REPORT_PROBLEM" ? (view.openObjections.includes(a.id) ? "review" : "neutral") : "neutral"}>{actionLabel(a.type)}{(a.type === "REQUEST_REVISION" || a.type === "REPORT_PROBLEM") && !view.openObjections.includes(a.id) ? " (withdrawn)" : ""}</Pill>{a.message && <span className="ml-1">“{a.message}”</span>}<span className="block text-xs text-muted">{fmtTime(a.createdAt)}</span></li>)}</ul>
          )}
        </Card>
      </aside>
    </div>
  );
}

function RecordTab({ view }: { view: DealView }) {
  const ai = aiSetup();
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card title="History" actions={view.chainBrokenAt === null ? <Pill tone="agreed">Hash chain intact ({view.events.length} entries)</Pill> : <Pill tone="bad">Chain broken at entry {view.chainBrokenAt}</Pill>}>
        <ol className="relative space-y-3 border-l border-line pl-4">
          {view.events.map((e) => {
            const k = KIND_PILL[e.kind]!;
            return (
              <li key={e.seq} className="relative">
                <span aria-hidden className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span className="font-mono">#{e.seq}</span><span>{fmtTime(e.createdAt)}</span><Pill tone={k.tone}>{k.label}</Pill><span className="font-mono">{e.type}</span></div>
                <p className="mt-0.5 text-sm">{e.summary}</p>
              </li>
            );
          })}
        </ol>
      </Card>
      <aside className="space-y-4">
        <Card title="Export">
          <div className="flex flex-col gap-2 text-sm">
            <a className="rounded-lg bg-ink px-3 py-2 text-center text-white" href={`/api/deals/${view.deal.id}/export?format=html`}>Download HTML record</a>
            <a className="rounded-lg border border-line px-3 py-2 text-center" href={`/api/deals/${view.deal.id}/export?format=json`}>Download JSON record</a>
          </div>
          <p className="mt-2 text-xs text-muted">Exports contain names, sources, hashes and PayPal IDs, but no emails or PayPal payer IDs. A hash chain shows whether entries were altered afterwards; it does not prove that a statement is true.</p>
        </Card>
        <Card title="AI usage">
          {view.aiRuns.length === 0 ? <p className="text-sm text-muted">No AI calls.</p> : <ul className="space-y-1 text-xs">{view.aiRuns.map((r) => <li key={r.id}>{fmtTime(r.createdAt).slice(0, 16)} · {r.provider === "fixture" ? "fixture (not AI)" : r.model} · {r.status} · {r.inputTokens}+{r.outputTokens} tokens · ${r.costUsd.toFixed(4)} · {(r.latencyMs / 1000).toFixed(1)}s</li>)}</ul>}
          <p className="mt-2 text-xs text-muted">Current provider: {ai.state === "ready" ? ai.model : ai.state}.</p>
        </Card>
        {view.role === "SELLER" && (
          <Card title="Delete"><DeleteDeal dealId={view.deal.id} /><p className="mt-2 text-xs text-muted">Unpaid agreements older than the retention period are removed by <code>npm run retention</code>.</p></Card>
        )}
      </aside>
    </div>
  );
}

function SourcesTab({ view }: { view: DealView }) {
  const content = view.effective?.content ?? view.working?.content;
  const refs: SourceRef[] = content ? [content.price.refs, content.deadline.refs, content.revisionRounds.refs, ...content.deliverables.map((d) => d.refs), ...content.openQuestions.map((q) => q.refs)].flat() : [];
  return (
    <div className="space-y-4">
      {view.sources.map((s) => {
        const mine = refs.filter((r) => r.source === s.label);
        let offset = 0;
        const lines = s.text.split("\n").map((t) => { const l = { text: t, start: offset }; offset += t.length + 1; return l; });
        return (
          <Card key={s.label} title={`${s.label} · ${s.title}`} actions={<span className="font-mono text-xs text-muted" title={s.sha256}>sha256 {shortHash(s.sha256)} · added {fmtTime(s.createdAt)}</span>}>
            <p className="mb-2 text-xs text-muted">Highlighted passages are the exact text each brief value points to. This source is stored unchanged.</p>
            <div className="overflow-x-auto rounded-lg border border-line bg-slate-50 p-3 font-mono text-[13px] leading-6">
              {lines.map((l, i) => (
                <div key={i} className="flex">
                  <span aria-hidden className="w-10 shrink-0 select-none pr-3 text-right text-slate-400">{i + 1}</span>
                  <span className="whitespace-pre-wrap break-words">{renderLine(l.text, l.start, mine)}</span>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {content && deadlineInstant(content.deadline) && <p className="text-xs text-muted">Deadline in UTC: {deadlineInstant(content.deadline)!.utc.toISOString()}</p>}
    </div>
  );
}

function renderLine(text: string, lineStart: number, refs: SourceRef[]) {
  const lineEnd = lineStart + text.length;
  const cuts = new Set<number>([lineStart, lineEnd]);
  for (const r of refs) {
    if (r.end <= lineStart || r.start >= lineEnd) continue;
    cuts.add(Math.max(r.start, lineStart));
    cuts.add(Math.min(r.end, lineEnd));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const seg = text.slice(a - lineStart, b - lineStart);
    const covering = refs.filter((r) => r.start < b && r.end > a);
    if (covering.length === 0) out.push(<span key={a}>{seg}</span>);
    else {
      const anchor = refs.find((r) => r.start === a);
      out.push(<mark key={a} id={anchor ? `ref-${anchor.source}-${anchor.start}` : undefined} className="mark-ref text-inherit" title={covering.map((r) => `“${r.quote}”`).join("\n")}>{seg}</mark>);
    }
  }
  return out.length ? out : " ";
}
