import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

export default async function Home() {
  if (await currentUser()) redirect("/deals");
  return (
    <div className="space-y-12">
      <section className="max-w-3xl pt-6">
        <p className="text-sm font-medium text-agreed">For independent designers, developers and writers paid by overseas clients</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Agree the work. Get paid through PayPal. Show what was delivered.</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          PromiseTrace turns a client conversation into a brief both sides approve, ties a PayPal checkout to that exact version, checks the
          delivered files against each promised item, and keeps one history where every statement points back to its source.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/sign-up" className="rounded-lg bg-ink px-5 py-3 text-sm font-medium text-white">Create a seller or buyer account</Link>
          <Link href="/about" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-medium">How it works and its limits</Link>
        </div>
      </section>
      <ol className="grid gap-4 md:grid-cols-4">
        {[
          ["1. Paste the brief", "AI proposes deliverables, formats, price, deadline and revisions. Every claim must quote the source, or it stays unknown."],
          ["2. Both approve", "Seller and buyer approve the same version. Any edit before payment creates a new version and resets approvals."],
          ["3. Pay with PayPal", "Checkout is created on the server from the approved price. Only a COMPLETED capture marks it paid."],
          ["4. Deliver and review", "Uploads are checked by code for promised formats, counts and the deadline. The buyer accepts, asks for a revision or objects."],
        ].map(([t, d]) => (
          <li key={t} className="rounded-xl border border-line bg-white p-4">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
          </li>
        ))}
      </ol>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-agreed/20 bg-agreed-bg p-4 text-sm"><strong className="text-agreed">Agreed</strong><p className="mt-1 text-slate-700">What both people approved, linked to the exact sentence it came from.</p></div>
        <div className="rounded-xl border border-observed/20 bg-observed-bg p-4 text-sm"><strong className="text-observed">Observed</strong><p className="mt-1 text-slate-700">What PromiseTrace recorded or PayPal&apos;s API confirmed: payment status, files, hashes, times.</p></div>
        <div className="rounded-xl border border-review/25 bg-review-bg p-4 text-sm"><strong className="text-review">Needs review</strong><p className="mt-1 text-slate-700">Anything missing, ambiguous, not checkable by code, or disputed by the buyer.</p></div>
      </section>
    </div>
  );
}
