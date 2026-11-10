"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { acceptInvite, approveVersion, createDeal, proposeInitialBrief, regenerateInvite, saveEdit, startAmendment } from "@/lib/services/briefs";
import { recordBuyerAction, BUYER_ACTIONS } from "@/lib/services/buyer";
import { loadDealForUser, requireRole } from "@/lib/services/access";
import { getGateway } from "@/lib/services/payments";
import { captureOnAcceptance, releaseHoldToBuyer, sellerCapture } from "@/lib/services/hold";

export type ActionState = { error?: string; ok?: string; version?: number } | null;

const safeNext = (n: FormDataEntryValue | null) => {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/deals";
};

export async function signUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ name: z.string().trim().min(2).max(60), email: z.email().max(200), password: z.string().min(10).max(128) }).safeParse({
    name: form.get("name"), email: form.get("email"), password: form.get("password"),
  });
  if (!parsed.success) return { error: "Enter a name, a valid email and a password of at least 10 characters." };
  try {
    await auth.api.signUpEmail({ body: parsed.data, headers: await headers() });
  } catch (e) {
    return { error: errorMessage(e).includes("exist") ? "An account with that email already exists. Sign in instead." : `Could not create the account: ${errorMessage(e)}` };
  }
  redirect(safeNext(form.get("next")));
}

export async function signInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    return { error: "Email or password is incorrect." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

export async function createDealAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/deals/new");
  let dealId: string;
  try {
    const kind = String(form.get("kind") ?? "CONVERSATION");
    const { deal, inviteToken } = await createDeal(prisma, user.id, {
      title: String(form.get("title") ?? ""),
      sourceTitle: String(form.get("sourceTitle") ?? ""),
      sourceKind: kind === "PASTED_BRIEF" ? "PASTED_BRIEF" : "CONVERSATION",
      sourceText: String(form.get("sourceText") ?? ""),
    });
    dealId = deal.id;
    await setInviteFlash(deal.id, inviteToken);
    await proposeInitialBrief(prisma, deal.id, user.id);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/deals/${dealId}?tab=brief`);
}

async function setInviteFlash(dealId: string, token: string) {
  (await cookies()).set(`pt_invite_${dealId}`, token, {
    httpOnly: true, sameSite: "lax", path: `/deals/${dealId}`, maxAge: 60 * 30,
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
  });
}

export async function regenerateInviteAction(dealId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const token = await regenerateInvite(prisma, dealId, user.id);
    await setInviteFlash(dealId, token);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/deals/${dealId}`);
  return { ok: "New invite link created. Older links no longer work." };
}

export async function acceptInviteAction(token: string): Promise<ActionState> {
  const user = await requireUser(`/invite/${token}`);
  let dealId: string;
  try {
    dealId = await acceptInvite(prisma, token, user.id);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/deals/${dealId}?tab=brief`);
}

export async function saveBriefAction(dealId: string, baseVersionId: string, content: unknown): Promise<ActionState> {
  const user = await requireUser();
  try {
    const v = await saveEdit(prisma, dealId, user.id, baseVersionId, content);
    revalidatePath(`/deals/${dealId}`);
    return { ok: `Saved as version ${v.number}. Earlier approvals no longer count; both sides approve again.`, version: v.number };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function approveAction(dealId: string, versionId: string, contentHash: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const r = await approveVersion(prisma, dealId, user.id, versionId, contentHash);
    revalidatePath(`/deals/${dealId}`);
    return { ok: r.alreadyApproved ? "You had already approved this version." : "Approval recorded." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function retryExtractionAction(dealId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await proposeInitialBrief(prisma, dealId, user.id);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/deals/${dealId}`);
  return { ok: "Extraction finished." };
}

export async function startAmendmentAction(dealId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await startAmendment(prisma, dealId, user.id);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/deals/${dealId}?tab=brief`);
}

export async function buyerAction(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const type = String(form.get("type") ?? "");
  if (!(BUYER_ACTIONS as readonly string[]).includes(type)) return { error: "Choose an action." };
  try {
    await recordBuyerAction(prisma, dealId, user.id, {
      type: type as (typeof BUYER_ACTIONS)[number],
      message: String(form.get("message") ?? ""),
      requirementKeys: form.getAll("req").map(String),
      refersToId: form.get("refersToId") ? String(form.get("refersToId")) : null,
    });
  } catch (e) {
    return { error: errorMessage(e) };
  }
  if (type === "ACCEPT") {
    // Acceptance is recorded first; then the held payment (if any) is captured for the seller.
    try {
      const r = await captureOnAcceptance(prisma, getGateway(), dealId, user.id);
      revalidatePath(`/deals/${dealId}`);
      if (!r) return { ok: "Recorded." };
      if (r.kind === "COMPLETED") return { ok: "Acceptance recorded. PayPal captured the held payment for the seller (capture COMPLETED)." };
      if (r.kind === "PENDING") return { ok: `Acceptance recorded. PayPal reports the capture as PENDING${r.reason ? ` (${r.reason})` : ""}; it is not shown as paid until PayPal completes it.` };
      return { error: `Acceptance recorded, but PayPal did not complete the capture (${"reason" in r ? r.reason ?? r.kind : r.kind}). The payment is not shown as paid.` };
    } catch (e) {
      revalidatePath(`/deals/${dealId}`);
      return { error: `Acceptance recorded, but the held payment was not captured: ${errorMessage(e)} The seller can retry the capture from the Payment tab.` };
    }
  }
  revalidatePath(`/deals/${dealId}`);
  return { ok: "Recorded." };
}

export async function sellerCaptureAction(dealId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const r = await sellerCapture(prisma, getGateway(), dealId, user.id);
    revalidatePath(`/deals/${dealId}`);
    if (r.kind === "COMPLETED") return { ok: "PayPal captured the held payment (capture COMPLETED)." };
    if (r.kind === "PENDING") return { ok: `PayPal reports the capture as PENDING${r.reason ? ` (${r.reason})` : ""}.` };
    return { error: `PayPal did not complete the capture (${"reason" in r ? r.reason ?? r.kind : r.kind}).` };
  } catch (e) {
    revalidatePath(`/deals/${dealId}`);
    return { error: errorMessage(e) };
  }
}

export async function releaseHoldAction(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await releaseHoldToBuyer(prisma, getGateway(), dealId, user.id, String(form.get("reason") ?? ""));
  } catch (e) {
    revalidatePath(`/deals/${dealId}`);
    return { error: errorMessage(e) };
  }
  revalidatePath(`/deals/${dealId}`);
  return { ok: "PayPal released the hold (authorization VOIDED). Nothing was captured." };
}

/** Deletes PromiseTrace's copy of an agreement (files, history, records). PayPal's records are unaffected. */
export async function deleteDealAction(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (form.get("confirm") !== "DELETE") return { error: 'Type DELETE to confirm.' };
  try {
    const { role } = await loadDealForUser(prisma, dealId, user.id);
    requireRole(role, "SELLER", "delete this agreement");
    await prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { dealId } });
      await tx.deal.delete({ where: { id: dealId } });
    });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    return { error: errorMessage(e) };
  }
  redirect("/deals?deleted=1");
}

