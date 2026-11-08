import { prisma } from "@/lib/db";
import { route } from "@/lib/route";
import { buildDealView, evidenceJson } from "@/lib/services/evidence";
import { renderEvidenceHtml } from "@/lib/export-html";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, ctx, userId) => {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "html";
  const view = await buildDealView(prisma, id, userId);
  const record = evidenceJson(view);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `promisetrace-${view.deal.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${stamp}`;
  if (format === "json") {
    return new Response(JSON.stringify(record, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.json"`, "Cache-Control": "private, no-store" },
    });
  }
  return new Response(renderEvidenceHtml(record), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.html"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
    },
  });
}, { mutating: false });
