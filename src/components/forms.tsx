"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { signInAction, signUpAction, createDealAction, acceptInviteAction, approveAction, regenerateInviteAction, startAmendmentAction, retryExtractionAction } from "@/app/actions";
import { Button, Banner } from "@/components/ui";

export function Submit({ children, variant, pendingText }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? pendingText ?? "Working…" : children}
    </Button>
  );
}

export function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div aria-live="polite" className="mt-3">
      {state.error && <Banner tone="bad">{state.error}</Banner>}
      {state.ok && <Banner tone="agreed">{state.ok}</Banner>}
    </div>
  );
}

const input = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-inner focus:border-slate-400";

export function AuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next: string }) {
  const [state, action] = useActionState(mode === "sign-in" ? signInAction : signUpAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {mode === "sign-up" && (
        <label className="block text-sm font-medium">Display name
          <input name="name" required minLength={2} maxLength={60} autoComplete="name" className={input} />
        </label>
      )}
      <label className="block text-sm font-medium">Email
        <input name="email" type="email" required autoComplete="email" className={input} />
      </label>
      <label className="block text-sm font-medium">Password
        <input name="password" type="password" required minLength={10} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} className={input} />
        {mode === "sign-up" && <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>}
      </label>
      <Submit pendingText={mode === "sign-in" ? "Signing in…" : "Creating account…"}>{mode === "sign-in" ? "Sign in" : "Create account"}</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function NewDealForm({ sample }: { sample: string }) {
  const [state, action] = useActionState(createDealAction, null);
  const [text, setText] = useState("");
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Agreement title
          <input name="title" required maxLength={120} placeholder="Northwind Coffee logo package" className={input} />
        </label>
        <label className="block text-sm font-medium">Source label
          <input name="sourceTitle" maxLength={120} placeholder="Email thread with Alex, 6 Nov" className={input} />
        </label>
      </div>
      <fieldset className="text-sm">
        <legend className="font-medium">What are you pasting?</legend>
        <div className="mt-1 flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" name="kind" value="CONVERSATION" defaultChecked /> A client conversation</label>
          <label className="flex items-center gap-2"><input type="radio" name="kind" value="PASTED_BRIEF" /> A written brief</label>
        </div>
      </fieldset>
      <label className="block text-sm font-medium">Brief or conversation text
        <textarea name="sourceText" required minLength={20} maxLength={60000} rows={12} value={text} onChange={(e) => setText(e.target.value)} className={`${input} font-mono`} placeholder="Paste the messages where you and the client agreed the work…" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Submit pendingText="Reading the brief…">Create and propose brief</Submit>
        <Button type="button" variant="secondary" onClick={() => setText(sample)}>Use the fictional logo example</Button>
        <span className="text-xs text-muted">The text is stored as the source. Pasted content is treated as data, never as instructions.</span>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action] = useActionState(async () => acceptInviteAction(token), null);
  return (
    <form action={action}>
      <Submit pendingText="Joining…">Join this agreement as the buyer</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function ApproveForm({ dealId, versionId, contentHash, label }: { dealId: string; versionId: string; contentHash: string; label: string }) {
  const [state, action] = useActionState(async () => approveAction(dealId, versionId, contentHash), null);
  return (
    <form action={action}>
      <Submit pendingText="Recording approval…">{label}</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function InviteRegenerate({ dealId }: { dealId: string }) {
  const [state, action] = useActionState(async () => regenerateInviteAction(dealId), null);
  return (
    <form action={action}>
      <Submit variant="secondary" pendingText="Creating…">Create a new invite link</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function AmendmentForm({ dealId }: { dealId: string }) {
  const [state, action] = useActionState(async () => startAmendmentAction(dealId), null);
  return (
    <form action={action}>
      <Submit variant="secondary" pendingText="Opening…">Propose an amendment</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function RetryExtraction({ dealId }: { dealId: string }) {
  const [state, action] = useActionState(async () => retryExtractionAction(dealId), null);
  return (
    <form action={action}>
      <Submit variant="secondary" pendingText="Extracting…">Run extraction</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium text-muted">{label}</label>
      <div className="mt-1 flex gap-2">
        <input readOnly value={value} className={`${input} mt-0 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
