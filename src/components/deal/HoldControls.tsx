"use client";

import { useActionState } from "react";
import { releaseHoldAction, sellerCaptureAction, type ActionState } from "@/app/actions";
import { Feedback, Submit } from "@/components/forms";

type Permission = { allowed: boolean; reason: string };

/** Seller: capture the held payment (when the rules allow) or cancel the job. Buyer: release the hold after a missed deadline. */
export function HoldControls({ dealId, role, amountLabel, sellerCapture, sellerVoid, buyerVoid }: {
  dealId: string; role: "SELLER" | "BUYER"; amountLabel: string; sellerCapture: Permission; sellerVoid: Permission; buyerVoid: Permission;
}) {
  const [capState, capAction] = useActionState<ActionState, FormData>(async () => sellerCaptureAction(dealId), null);
  const [relState, relAction] = useActionState(releaseHoldAction.bind(null, dealId), null);
  const release = role === "SELLER" ? sellerVoid : buyerVoid;
  return (
    <div className="space-y-5">
      {role === "SELLER" && (
        <form action={capAction} className="space-y-2">
          <p className="text-sm font-medium">Capture the held {amountLabel}</p>
          <p className="text-xs text-muted">{sellerCapture.reason}</p>
          {sellerCapture.allowed && <Submit pendingText="Asking PayPal…">Capture {amountLabel} now</Submit>}
          <Feedback state={capState} />
        </form>
      )}
      <form action={relAction} className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-medium">{role === "SELLER" ? "Cancel the job and release the hold" : "Release the hold back to you"}</p>
        <p className="text-xs text-muted">{release.reason}</p>
        {release.allowed && (
          <>
            <label className="block text-xs">{role === "SELLER" ? "Why (recorded in the history, required)" : "Note (optional, recorded in the history)"}
              <input name="reason" maxLength={500} required={role === "SELLER"} minLength={role === "SELLER" ? 5 : undefined} className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <Submit variant="danger" pendingText="Asking PayPal…">Release the hold (nothing is charged)</Submit>
          </>
        )}
        <Feedback state={relState} />
      </form>
    </div>
  );
}
