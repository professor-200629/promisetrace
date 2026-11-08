import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/route";
import { createCheckout, getGateway } from "@/lib/services/payments";

/** Creates (or reuses) the PayPal order for the approved version. The request body is ignored on purpose: amount and currency come from the database. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, ctx, userId) => {
  const { id } = await ctx.params;
  const r = await createCheckout(prisma, getGateway(), id, userId);
  return NextResponse.json({ orderId: r.orderId, mode: r.mode });
});
