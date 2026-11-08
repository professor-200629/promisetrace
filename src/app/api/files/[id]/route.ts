import { prisma } from "@/lib/db";
import { route } from "@/lib/route";
import { readFileForUser } from "@/lib/services/delivery";

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", pdf: "application/pdf", zip: "application/zip", svg: "image/svg+xml" };

/**
 * Private download. Always served as an attachment with a sandboxing CSP and
 * nosniff, so SVG/PDF content is never rendered or executed in the app's
 * origin. Downloads are not recorded as acceptance.
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx, userId) => {
  const { id } = await ctx.params;
  const file = await readFileForUser(prisma, id, userId);
  const safeName = file.originalName.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(file.blob!.data), {
    headers: {
      "Content-Type": MIME[file.detectedType] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}, { mutating: false });
