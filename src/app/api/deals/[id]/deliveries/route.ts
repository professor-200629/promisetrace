import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { route } from "@/lib/route";
import { AppError } from "@/lib/errors";
import { submitDelivery, type UploadInput } from "@/lib/services/delivery";
import { summarizeChecks } from "@/lib/services/checks";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx, userId) => {
  const { id } = await ctx.params;
  const e = env();
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > e.MAX_UPLOAD_BYTES * e.MAX_FILES_PER_DELIVERY + 64 * 1024) throw new AppError("INVALID", "Upload is too large.");
  const form = await req.formData();
  const files: UploadInput[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("file:") || typeof value === "string") continue;
    if (value.size === 0) continue;
    if (value.size > e.MAX_UPLOAD_BYTES) throw new AppError("INVALID", `${value.name} is larger than the upload limit.`);
    files.push({ deliverableKey: name.slice(5), name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  const { checks } = await submitDelivery(prisma, id, userId, { note: String(form.get("note") ?? ""), files });
  return NextResponse.json({ summary: summarizeChecks(checks), missing: checks.filter((c) => c.result === "FAIL").map((c) => c.label) });
});
