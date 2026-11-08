import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiSetup, paypalSetup } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness + configuration check (no secrets). Also called once a day by the
 * Vercel cron in vercel.json so a free hosted database never goes idle during
 * the judging period.
 */
export async function GET() {
  const started = Date.now();
  let db = "ok";
  try {
    await prisma.user.count();
  } catch {
    db = "error";
  }
  return NextResponse.json(
    { status: db === "ok" ? "ok" : "degraded", db, paypal: paypalSetup().state, ai: aiSetup().state, ms: Date.now() - started },
    { status: db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
