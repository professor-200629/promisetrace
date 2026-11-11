import { Card } from "@/components/ui";
import { env } from "@/lib/env";
import { paymentTerms } from "@/lib/payment-terms";

export default function About() {
  const terms = paymentTerms(env().REVIEW_WINDOW_DAYS);
  return (
    <div className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">How PromiseTrace works, and what it does not do</h1>
      <Card title="Who it is for">
        <p>An independent digital-service seller (for example a designer in India) and an overseas client who agree a specific piece of work over chat or email and pay through PayPal. Misunderstandings usually come from what was said in passing: which file formats, how many concepts, which timezone the deadline uses.</p>
      </Card>
      <Card title="What each part relies on">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>AI (Claude, via the Anthropic API)</strong> proposes the structured brief and clarification questions. It must quote the source for every value; our code checks that the quote exists and mentions that value, or the value stays unknown. AI never decides whether a delivery is acceptable.</li>
          <li><strong>Deterministic code</strong> checks money arithmetic, PayPal status and reconciliation fields, file types (from file contents), counts, the deadline in the agreed timezone, and revision counts.</li>
          <li><strong>People</strong> approve the brief (both sides, same version) and decide whether the work is satisfactory. A download is never treated as acceptance.</li>
          <li><strong>PayPal</strong> is the source of truth for payment. At checkout PayPal places a hold (authorization) for the approved price; the agreement counts as funded only when PayPal returns it as CREATED with the expected amount. {terms.short} The seller can cancel and release the hold; the buyer can release it if the deadline passes with nothing delivered. A payment is shown as paid only when PayPal returns a COMPLETED capture with the expected amount and identifiers. A hold lasts up to 29 days. {terms.timing} Reauthorization is not built.</li>
        </ul>
      </Card>
      <Card title="Limits">
        <ul className="list-disc space-y-2 pl-5">
          <li>PromiseTrace never holds funds itself: a payment hold is a PayPal authorization on the buyer&apos;s payment method, captured or released through PayPal&apos;s API. It does not lift PayPal account holds on a seller&apos;s balance, decide PayPal claims or guarantee Seller Protection. PayPal India&apos;s Seller Protection does not cover &quot;Significantly Not as Described&quot; claims; a record here does not change that.</li>
          <li>Complaints recorded here are messages between the two parties, not PayPal disputes. Official PayPal dispute notifications, when received by verified webhook, are labelled as such.</li>
          <li>File hashes show whether a file changed later. They do not show that the work is good or that it fulfils the brief.</li>
          <li>This build uses the PayPal sandbox and ordinary single-merchant Checkout: payments go to the one merchant account configured on the server. A product for many sellers would need PayPal&apos;s partner (platform) onboarding.</li>
          <li>Indian sellers can only receive international (not domestic INR) payments through PayPal, and need PAN verification, a bank account and a purpose code. A sandbox success says nothing about production eligibility.</li>
          <li>Sources are pasted text. PDF import, other languages and scope-change suggestions are not built.</li>
        </ul>
      </Card>
      <Card title="Data handling">
        <p>Sources, versions, files and history are stored in the app database and visible only to the two participants. Exports omit email addresses and PayPal payer IDs. The seller can delete an agreement and its files at any time; this does not affect PayPal&apos;s records. Demo data in this project is fictional.</p>
      </Card>
    </div>
  );
}
