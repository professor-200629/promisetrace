/**
 * One real AI extraction of the fictional demo conversation, to prove the
 * runtime AI configuration. Costs one API call (logged below).
 *
 *   npm run ai:check
 */
import "dotenv/config";
import { aiSetup } from "../src/lib/env";
import { extractWithAnthropic } from "../src/lib/ai/providers";
import { validateExtraction } from "../src/lib/ai/validate";
import { costMicros } from "../src/lib/ai/extract";
import { DEMO_CONVERSATION } from "../src/lib/demo";
import { minorToValue } from "../src/lib/money";

async function main() {
  const s = aiSetup();
  if (s.state !== "ready") {
    console.log(`SETUP NEEDED: AI is ${s.state}. Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY in .env.`);
    process.exit(2);
  }
  const sources = [{ label: "S1", title: "demo", text: DEMO_CONVERSATION }];
  const t0 = Date.now();
  const r = await extractWithAnthropic(sources);
  const ms = Date.now() - t0;
  if (!r.ok) {
    console.log(`FAILED (${r.status}): ${r.error}`);
    process.exit(1);
  }
  const { brief, report } = validateExtraction(r.output, sources);
  console.log(`model ${r.model} · ${ms} ms · ${r.inputTokens} in + ${r.outputTokens} out tokens · ~$${(costMicros(r.inputTokens, r.outputTokens) / 1e6).toFixed(4)}`);
  console.log(`price: ${brief.price.amountMinor !== null && brief.price.currency ? `${minorToValue(brief.price.amountMinor, brief.price.currency)} ${brief.price.currency}` : "unknown"} [${brief.price.status}]`);
  console.log(`deadline: ${brief.deadline.date ?? "?"} ${brief.deadline.time ?? ""} ${brief.deadline.timezone ?? "(no timezone)"} [${brief.deadline.status}]`);
  console.log(`revisions: ${brief.revisionRounds.count ?? "unknown"} [${brief.revisionRounds.status}]`);
  for (const d of brief.deliverables) console.log(`deliverable ${d.key}: ${d.quantity ?? "?"} × ${d.label} (${d.formats.join(", ") || "no formats"}) [${d.status}] ← "${d.refs[0]?.quote ?? ""}"`);
  for (const q of brief.openQuestions) console.log(`question (${q.origin}): ${q.text}`);
  console.log(`validation: ${report.claimsAccepted}/${report.claimsProposed} claims kept, ${report.unsupportedClaims.length} dropped, ${report.quotesInvalid.length}/${report.quotesTotal} quotes not found`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
