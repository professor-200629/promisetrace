/**
 * Four scripted end-to-end scenarios through the real services, a fresh
 * SQLite file and the labelled FIXTURE PayPal gateway (no network).
 * They demonstrate workflow behaviour; they are not customer results.
 *
 *   npx tsx eval/scenarios.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const root = path.resolve(import.meta.dirname, "..");
const dbFile = path.join(root, "eval-scenarios.db");
for (const s of ["", "-journal", "-wal", "-shm"]) rmSync(dbFile + s, { force: true });
process.env.DATABASE_URL = "file:./eval-scenarios.db";
process.env.PAYPAL_MODE = "fixture";
process.env.AI_PROVIDER = "fixture";

async function migrate() {
  const c = createClient({ url: "file:" + dbFile.split(path.sep).join("/") });
  const dir = path.join(root, "prisma", "migrations");
  for (const m of readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "migration.sql"))).sort()) await c.executeMultiple(readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
  c.close();
}

async function main() {
  await migrate();
  const { prisma } = await import("../src/lib/db");
  const { canonicalJson } = await import("../src/lib/hash");
  const B = await import("../src/lib/services/briefs");
  const P = await import("../src/lib/services/payments");
  const D = await import("../src/lib/services/delivery");
  const U = await import("../src/lib/services/buyer");
  const E = await import("../src/lib/services/evidence");
  const { FixturePayPalGateway } = await import("../src/lib/paypal/gateway");
  const { logoBrief, LOGO_BRIEF, PNG_BYTES, SVG_BYTES } = await import("../tests/helpers");
  const { DATASET } = await import("./dataset");
  const { randomUUID } = await import("node:crypto");
  const gw = new FixturePayPalGateway();

  const user = (name: string) => prisma.user.create({ data: { id: randomUUID(), name, email: `${randomUUID()}@example.test` } });
  const results: Array<{ scenario: string; expected: string; observed: string; pass: boolean }> = [];
  const record = (scenario: string, expected: string, observed: string, pass: boolean) => { results.push({ scenario, expected, observed, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${scenario}: ${observed}`); };

  async function paidDeal(text: string, content: ReturnType<typeof logoBrief>) {
    const seller = await user("Seller"), buyer = await user("Buyer");
    const { deal, inviteToken } = await B.createDeal(prisma, seller.id, { title: content.title, sourceTitle: "conversation", sourceKind: "CONVERSATION", sourceText: text });
    await B.acceptInvite(prisma, inviteToken, buyer.id);
    const v = await prisma.briefVersion.create({ data: { dealId: deal.id, number: 1, kind: "ORIGINAL", origin: "MANUAL", content: canonicalJson(content), contentHash: B.hashContent(content), createdById: seller.id } });
    await B.approveVersion(prisma, deal.id, seller.id, v.id, v.contentHash);
    await B.approveVersion(prisma, deal.id, buyer.id, v.id, v.contentHash);
    const { orderId } = await P.createCheckout(prisma, gw, deal.id, buyer.id);
    const cap = await P.capturePayment(prisma, gw, deal.id, buyer.id, orderId);
    return { seller, buyer, deal, cap };
  }

  // 1. Complete delivery
  {
    const s = await paidDeal(LOGO_BRIEF, logoBrief());
    await D.submitDelivery(prisma, s.deal.id, s.seller.id, { note: "", files: [
      { deliverableKey: "D1", name: "c1.png", bytes: PNG_BYTES }, { deliverableKey: "D1", name: "c2.png", bytes: PNG_BYTES },
      { deliverableKey: "D2", name: "final.png", bytes: PNG_BYTES }, { deliverableKey: "D2", name: "final.svg", bytes: SVG_BYTES },
    ] });
    await U.recordBuyerAction(prisma, s.deal.id, s.buyer.id, { type: "ACCEPT", message: "", requirementKeys: [] });
    const v = await E.buildDealView(prisma, s.deal.id, s.buyer.id);
    const files = v.rows.filter((r) => r.group === "Deliverables");
    record("1. Complete delivery", "all file requirements met, payment COMPLETED, buyer acceptance recorded",
      `${files.filter((r) => r.result === "MET").length}/${files.length} file requirements met; payment ${v.payment.latest?.status}; acceptance ${v.acceptance?.type ?? "none"}`,
      files.every((r) => r.result === "MET") && v.payment.isPaid && v.acceptance?.type === "ACCEPT");
  }
  // 2. Missing item
  {
    const s = await paidDeal(LOGO_BRIEF, logoBrief());
    const r = await D.submitDelivery(prisma, s.deal.id, s.seller.id, { note: "", files: [
      { deliverableKey: "D1", name: "c1.png", bytes: PNG_BYTES }, { deliverableKey: "D1", name: "c2.png", bytes: PNG_BYTES }, { deliverableKey: "D2", name: "final.png", bytes: PNG_BYTES },
    ] });
    const fail = r.checks.filter((c) => c.result === "FAIL");
    record("2. Missing item (SVG)", "exactly the SVG requirement is not met and it cites the approved brief passage",
      `not met: ${fail.map((c) => c.requirementKey).join(", ")}; cited: "${fail[0]?.refs[0]?.quote ?? "-"}"`,
      fail.length === 1 && fail[0]!.requirementKey === "D2:svg" && /SVG/.test(fail[0]!.refs[0]?.quote ?? ""));
  }
  // 3. Ambiguous terms: conflicting prices -> price unknown -> approval blocked until a person sets it
  {
    const item = DATASET.find((d) => d.id === "H2-conflicting-price")!;
    const seller = await user("Seller"), buyer = await user("Buyer");
    const { deal, inviteToken } = await B.createDeal(prisma, seller.id, { title: "Brochure", sourceTitle: "thread", sourceKind: "CONVERSATION", sourceText: item.text });
    await B.acceptInvite(prisma, inviteToken, buyer.id);
    // Use a hand-written brief that mirrors what the validator must do with conflicting prices: price unknown + question.
    const c = logoBrief(LOGO_BRIEF);
    c.title = "Brochure";
    c.price = { amountMinor: null, currency: null, refs: [], status: "needs_clarification" };
    c.openQuestions = [{ key: "Q1", text: "The thread mentions $200 and $260. Which is the agreed price?", origin: "AI", refs: [] }];
    const v = await prisma.briefVersion.create({ data: { dealId: deal.id, number: 1, kind: "ORIGINAL", origin: "MANUAL", content: canonicalJson(c), contentHash: B.hashContent(c), createdById: seller.id } });
    let blocked = "";
    try { await B.approveVersion(prisma, deal.id, buyer.id, v.id, v.contentHash); } catch (e) { blocked = e instanceof Error ? e.message : "blocked"; }
    const fixed = structuredClone(c);
    fixed.price = { ...fixed.price, amountMinor: 26000, currency: "USD" };
    fixed.openQuestions = [];
    const v2 = await B.saveEdit(prisma, deal.id, seller.id, v.id, fixed);
    await B.approveVersion(prisma, deal.id, seller.id, v2.id, v2.contentHash);
    await B.approveVersion(prisma, deal.id, buyer.id, v2.id, v2.contentHash);
    const st = await B.versionState(prisma, deal.id);
    record("3. Ambiguous terms", "approval refused while price is unknown; a participant sets it as an edit; both approve the new version",
      `first approval: ${blocked ? `refused ("${blocked.slice(0, 60)}…")` : "allowed"}; price edited by seller -> status ${B.parseContent(v2).price.status}; v2 approved by both: ${st.workingApproved}`,
      !!blocked && B.parseContent(v2).price.status === "edited" && st.workingApproved);
  }
  // 4. Approved change after payment
  {
    const s = await paidDeal(LOGO_BRIEF, logoBrief());
    const am = await B.startAmendment(prisma, s.deal.id, s.buyer.id);
    const changed = logoBrief();
    changed.deliverables.push({ key: "D3", label: "Favicon", quantity: 1, formats: ["png"], refs: [], status: "edited" });
    changed.deadline.date = "2026-11-24";
    const v = await B.saveEdit(prisma, s.deal.id, s.buyer.id, am.id, changed);
    await B.approveVersion(prisma, s.deal.id, s.buyer.id, v.id, v.contentHash);
    await B.approveVersion(prisma, s.deal.id, s.seller.id, v.id, v.contentHash);
    const r = await D.submitDelivery(prisma, s.deal.id, s.seller.id, { note: "", files: [
      { deliverableKey: "D1", name: "c1.png", bytes: PNG_BYTES }, { deliverableKey: "D1", name: "c2.png", bytes: PNG_BYTES },
      { deliverableKey: "D2", name: "final.png", bytes: PNG_BYTES }, { deliverableKey: "D2", name: "final.svg", bytes: SVG_BYTES },
    ] });
    const st = await B.versionState(prisma, s.deal.id);
    const fav = r.checks.find((c) => c.requirementKey === "D3:png");
    record("4. Approved change", "paid v1 stays unchanged; amendment approved by both; delivery checked against the amendment (favicon now required)",
      `paid version deadline ${B.parseContent(st.paid!).deadline.date}; effective v${st.effective!.number} deadline ${B.parseContent(st.effective!).deadline.date}; favicon check ${fav?.result ?? "absent"}`,
      B.parseContent(st.paid!).deadline.date === "2026-11-20" && st.effective!.id === v.id && fav?.result === "FAIL");
  }

  mkdirSync(path.join(root, "eval", "results"), { recursive: true });
  const md = [
    "# End-to-end scenarios (scripted, FIXTURE PayPal gateway, fictional data)",
    "",
    `Run: ${new Date().toISOString()} — \`npx tsx eval/scenarios.ts\`. These exercise the real services and database; they are not customer results.`,
    "",
    "| Scenario | Expected | Observed | Result |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.scenario} | ${r.expected} | ${r.observed.replace(/\|/g, "/")} | ${r.pass ? "PASS" : "FAIL"} |`),
    "",
  ].join("\n");
  writeFileSync(path.join(root, "eval", "results", "scenarios.md"), md);
  await prisma.$disconnect();
  for (const s of ["", "-journal", "-wal", "-shm"]) { try { rmSync(dbFile + s, { force: true }); } catch { /* Windows may still hold the file; it is git-ignored */ } }
  if (results.some((r) => !r.pass)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
