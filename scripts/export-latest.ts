/**
 * Writes the most recent agreement's evidence record (JSON + HTML) to
 * docs/sample-evidence/, exactly as the in-app export would produce it.
 *
 *   npx tsx scripts/export-latest.ts                       # latest agreement -> northwind-live-sandbox.*
 *   npx tsx scripts/export-latest.ts <dealId> <basename>   # a specific agreement -> <basename>.*
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { buildView, evidenceJson } from "../src/lib/services/evidence";
import { renderEvidenceHtml } from "../src/lib/export-html";

async function main() {
  const [dealId, basename = "northwind-live-sandbox"] = process.argv.slice(2);
  if (!/^[a-z0-9-]+$/i.test(basename)) throw new Error("basename may contain only letters, digits and dashes");
  const deal = dealId
    ? await prisma.deal.findUnique({ where: { id: dealId } })
    : await prisma.deal.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
  if (!deal) return console.log("No agreements in this database.");
  const view = await buildView(prisma, deal.id, "BUYER");
  const record = evidenceJson(view);
  const dir = path.resolve(import.meta.dirname, "..", "docs", "sample-evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${basename}.json`), JSON.stringify(record, null, 2));
  writeFileSync(path.join(dir, `${basename}.html`), renderEvidenceHtml(record));
  console.log(`exported "${deal.title}" (${record.history.events.length} events, chain intact: ${record.history.hashChainIntact}) to ${path.relative(process.cwd(), dir)}`);
}

main().finally(() => prisma.$disconnect());
