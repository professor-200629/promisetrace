/**
 * Writes the most recent agreement's evidence record (JSON + HTML) to
 * docs/sample-evidence/, exactly as the in-app export would produce it.
 *
 *   npx tsx scripts/export-latest.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { buildView, evidenceJson } from "../src/lib/services/evidence";
import { renderEvidenceHtml } from "../src/lib/export-html";

async function main() {
  const deal = await prisma.deal.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
  if (!deal) return console.log("No agreements in this database.");
  const view = await buildView(prisma, deal.id, "BUYER");
  const record = evidenceJson(view);
  const dir = path.resolve(import.meta.dirname, "..", "docs", "sample-evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "northwind-live-sandbox.json"), JSON.stringify(record, null, 2));
  writeFileSync(path.join(dir, "northwind-live-sandbox.html"), renderEvidenceHtml(record));
  console.log(`exported "${deal.title}" (${record.history.events.length} events, chain intact: ${record.history.hashChainIntact}) to ${path.relative(process.cwd(), dir)}`);
}

main().finally(() => prisma.$disconnect());
