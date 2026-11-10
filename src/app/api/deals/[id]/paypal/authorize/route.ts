import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { route } from "@/lib/route";
import { AppError } from "@/lib/errors";
import { authorizePayment, getGateway } from "@/lib/services/payments";

const Body = z.object({ orderId: z.string().min(5).max(64).regex(/^[A-Za-z0-9-]+$/) });

/** After the buyer approves in the PayPal window: place the hold (authorize). Nothing is captured here. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx, userId) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new AppError("INVALID", "Missing PayPal order id.");
  const r = await authorizePayment(prisma, getGateway(), id, userId, parsed.data.orderId);
  return NextResponse.json({ outcome: r.kind, reason: "reason" in r ? r.reason : undefined });
});
