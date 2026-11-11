// Records the demo journey on the hosted sandbox demo as two people (seller and buyer), with a
// visible cursor, and writes a marks.json with the time of every step for editing.
// Fictional demo accounts, PayPal sandbox and PayPal's published test card only. No real money.
//   node scripts/demo-video/record.mjs <outDir>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BASE, SELLER, BUYER, CURSOR_SCRIPT, signIn, findCardFrame, fillCardForm } from "./common.mjs";

const outDir = path.resolve(process.argv[2]);
fs.mkdirSync(outDir, { recursive: true });
const files = path.resolve(import.meta.dirname, "..", "..", "demo-files");
const size = { width: 1280, height: 720 };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
const t0 = {};
const marks = [];
const mark = (who, label) => { marks.push({ who, label, t: +((Date.now() - t0[who]) / 1000).toFixed(2) }); console.log(who, label); };

async function person(who) {
  const ctx = await browser.newContext({ viewport: size, locale: "en-US", timezoneId: "America/Los_Angeles", userAgent: UA, recordVideo: { dir: path.join(outDir, who), size } });
  await ctx.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });");
  await ctx.addInitScript(CURSOR_SCRIPT);
  ctx.setDefaultNavigationTimeout(90_000);
  ctx.setDefaultTimeout(45_000);
  const page = await ctx.newPage();
  t0[who] = Date.now();
  return { ctx, page };
}

const s = await person("S");
const b = await person("B");
const S = s.page, B = b.page;
const hold = (p, ms) => p.waitForTimeout(ms);
async function glide(p, locator) { // move the cursor visibly onto an element
  const box = await locator.boundingBox();
  if (box) await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}
async function scrollBy(p, dy, steps = 12) {
  for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, dy / steps); await p.waitForTimeout(40); }
}

let dealId = "";
try {
  // 1. Landing page (seller)
  await S.goto(BASE);
  await hold(S, 800);
  mark("S", "landing_start");
  await hold(S, 2500);
  await scrollBy(S, 380);
  await hold(S, 2500);
  mark("S", "landing_end");

  // 2. Seller pastes the conversation; Claude proposes the brief
  await signIn(S, SELLER, "/deals/new");
  await hold(S, 600);
  mark("S", "create_start");
  await glide(S, S.getByRole("button", { name: "Use the fictional logo example" }));
  await S.getByRole("button", { name: "Use the fictional logo example" }).click();
  await hold(S, 1200);
  await S.locator('input[name="title"]').click();
  await S.locator('input[name="title"]').pressSequentially("Northwind Coffee logo package", { delay: 35 });
  await S.locator('input[name="sourceTitle"]').click();
  await S.locator('input[name="sourceTitle"]').pressSequentially("Email thread with Alex", { delay: 30 });
  await hold(S, 600);
  await glide(S, S.getByRole("button", { name: "Create and propose brief" }));
  await S.getByRole("button", { name: "Create and propose brief" }).click();
  mark("S", "create_wait");
  await S.waitForURL(/\/deals\/[^/]+\?tab=brief/, { timeout: 120_000 });
  dealId = new URL(S.url()).pathname.split("/").pop();
  await S.getByText(/Proposed by .*AI interpretation/).waitFor({ timeout: 30_000 });
  mark("S", "brief_start");
  await hold(S, 1500);
  await scrollBy(S, 520, 16);
  await hold(S, 1500);
  const chip = S.getByRole("link", { name: /S1 · line/ }).first();
  await chip.scrollIntoViewIfNeeded();
  await glide(S, chip);
  await hold(S, 1800);
  await scrollBy(S, 420, 14);
  await hold(S, 1500);
  await S.getByRole("link", { name: "Sources", exact: true }).click();
  await S.getByText(/Highlighted passages are the exact text/).waitFor();
  await hold(S, 3000);
  mark("S", "brief_end");

  // 3. Buyer joins by the private link; both approve the same version
  await S.goto(`${BASE}/deals/${dealId}?tab=brief`);
  const invite = await S.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).find((v) => v.includes("/invite/")));
  mark("S", "invite_start");
  await glide(S, S.getByRole("button", { name: "Copy" }));
  await hold(S, 2000);
  mark("S", "invite_end");
  await signIn(B, BUYER, new URL(invite).pathname);
  await hold(B, 500);
  mark("B", "join_start");
  await hold(B, 1500);
  await glide(B, B.getByRole("button", { name: "Join this agreement as the buyer" }));
  await B.getByRole("button", { name: "Join this agreement as the buyer" }).click();
  await B.getByRole("button", { name: "Approve version 1" }).waitFor({ timeout: 30_000 });
  await hold(B, 1200);
  await glide(B, B.getByRole("button", { name: "Approve version 1" }));
  await B.getByRole("button", { name: "Approve version 1" }).click();
  await B.getByText(/Waiting for the seller to approve/).waitFor({ timeout: 30_000 });
  await hold(B, 1800);
  mark("B", "join_end");
  await S.goto(`${BASE}/deals/${dealId}?tab=brief`);
  await hold(S, 800);
  mark("S", "approve_start");
  await glide(S, S.getByRole("button", { name: "Approve version 1" }));
  await S.getByRole("button", { name: "Approve version 1" }).click();
  await S.getByText(/approved by both/).first().waitFor({ timeout: 30_000 });
  await hold(S, 2200);
  mark("S", "approve_end");

  // 4. Buyer pays: PayPal holds the money (authorization), nothing is captured
  await B.goto(`${BASE}/deals/${dealId}?tab=payment`);
  await B.frameLocator('iframe[title*="PayPal" i]').first().locator('[data-funding-source="card"]').first().waitFor({ timeout: 30_000 });
  await hold(B, 1000);
  // The buyer reads the payment terms (review period, seller-capture conditions) before authorizing.
  const terms = B.getByTestId("payment-terms");
  await terms.scrollIntoViewIfNeeded();
  mark("B", "terms_start");
  await glide(B, terms.getByText(/Payment terms: read before you pay/));
  await hold(B, 1500);
  await glide(B, terms.locator("li").nth(1));
  await hold(B, 4500);
  mark("B", "terms_end");
  mark("B", "pay_start");
  await hold(B, 800);
  const cardBtn = B.frameLocator('iframe[title*="PayPal" i]').first().locator('[data-funding-source="card"]').first();
  await glide(B, cardBtn);
  await cardBtn.click();
  const cf = await findCardFrame(B, 30_000);
  if (!cf) throw new Error("PayPal card fields did not appear");
  await hold(B, 1200);
  // PayPal's published sandbox test Mastercard; the test Visa 4012 8888 8888 1881 was being declined by the sandbox on 11 Nov after heavy reuse.
  await fillCardForm(cf, "5555555555554444");
  await hold(B, 900);
  await cf.getByRole("button", { name: /Pay/ }).click();
  mark("B", "pay_wait");
  await B.getByText(/PayPal holds 300\.00 USD for this agreement/).waitFor({ timeout: 90_000 });
  await hold(B, 600);
  mark("B", "held_start");
  await B.getByText("PayPal holds 300.00 USD for this agreement.").scrollIntoViewIfNeeded();
  await scrollBy(B, -2000, 4);
  await hold(B, 2500);
  await scrollBy(B, 480, 14);
  await hold(B, 3500);
  mark("B", "held_end");

  // 5. Seller delivers concepts + final PNG, forgets the SVG
  await S.goto(`${BASE}/deals/${dealId}?tab=delivery`);
  await hold(S, 800);
  mark("S", "deliver_start");
  const fileInputs = S.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles([path.join(files, "concept-a.png"), path.join(files, "concept-b.png")]);
  await hold(S, 700);
  await fileInputs.nth(1).setInputFiles([path.join(files, "northwind-final.png")]);
  await hold(S, 700);
  await S.locator('textarea[name="note"]').click();
  await S.locator('textarea[name="note"]').pressSequentially("Final logo attached.", { delay: 35 });
  await glide(S, S.getByRole("button", { name: "Submit delivery" }));
  await S.getByRole("button", { name: "Submit delivery" }).click();
  await S.getByText(/Delivery recorded\. Not met yet/).waitFor({ timeout: 60_000 });
  await hold(S, 2500);
  await S.getByRole("link", { name: "Overview", exact: true }).click();
  const svgRow = S.locator("tr", { hasText: "SVG" }).filter({ hasText: "Not met" }).first();
  await svgRow.waitFor({ timeout: 30_000 });
  await svgRow.scrollIntoViewIfNeeded();
  await hold(S, 800);
  await glide(S, svgRow.getByRole("link", { name: /S1 · line/ }).first());
  await hold(S, 3500);
  mark("S", "deliver_end");

  // 5b. While the SVG is missing the seller cannot capture the held money alone
  await S.goto(`${BASE}/deals/${dealId}?tab=payment`);
  await hold(S, 900);
  mark("S", "blocked_start");
  await glide(S, S.getByTestId("agreement-status"));
  await hold(S, 1800);
  const capReason = S.getByText(/not met or flagged for review/).first();
  await capReason.scrollIntoViewIfNeeded();
  await glide(S, capReason);
  await hold(S, 3500);
  mark("S", "blocked_end");

  // 6. Buyer reports the problem, tied to that requirement
  await B.goto(`${BASE}/deals/${dealId}?tab=delivery`);
  await hold(B, 800);
  mark("B", "object_start");
  await B.getByLabel(/Report a problem/).check();
  await hold(B, 500);
  await B.getByRole("checkbox", { name: /^D2/ }).check();
  await B.locator('textarea[name="message"]').click();
  await B.locator('textarea[name="message"]').pressSequentially("The SVG file we agreed on is missing.", { delay: 30 });
  await glide(B, B.getByRole("button", { name: "Record my response" }));
  await B.getByRole("button", { name: "Record my response" }).click();
  await B.getByText("Recorded.").waitFor({ timeout: 30_000 });
  await hold(B, 1800);
  mark("B", "object_end");

  // 7. Seller adds the SVG: every checkable item is met
  await S.goto(`${BASE}/deals/${dealId}?tab=delivery`);
  await hold(S, 800);
  mark("S", "fix_start");
  await S.locator('input[type="file"]').nth(1).setInputFiles([path.join(files, "northwind-final.svg")]);
  await hold(S, 700);
  await glide(S, S.getByRole("button", { name: "Submit delivery" }));
  await S.getByRole("button", { name: "Submit delivery" }).click();
  await S.getByText(/Delivery recorded\. \d+ checks met/).waitFor({ timeout: 60_000 });
  await hold(S, 2500);
  mark("S", "fix_end");

  // 8. Buyer accepts: PayPal captures the held payment
  await B.goto(`${BASE}/deals/${dealId}?tab=delivery`);
  await hold(B, 800);
  mark("B", "accept_start");
  await B.getByLabel(/^Accept/).check();
  await hold(B, 900);
  const acceptBtn = B.getByRole("button", { name: /Accept and capture the held 300\.00 USD/ });
  await glide(B, acceptBtn);
  await hold(B, 600);
  await acceptBtn.click();
  await B.getByText(/PayPal captured the held payment/).waitFor({ timeout: 90_000 });
  await hold(B, 2200);
  await B.goto(`${BASE}/deals/${dealId}?tab=payment`);
  await hold(B, 1500);
  await scrollBy(B, 300, 10);
  await hold(B, 3500);
  mark("B", "accept_end");

  // 8b. The buyer withdraws the objection; captured + accepted + nothing open = Complete
  await B.goto(`${BASE}/deals/${dealId}?tab=delivery`);
  await hold(B, 800);
  mark("B", "withdraw_start");
  await B.getByLabel(/Withdraw an objection/).check();
  await hold(B, 500);
  await B.getByLabel("Message (optional)").click();
  await B.getByLabel("Message (optional)").pressSequentially("SVG received, thanks.", { delay: 30 });
  await glide(B, B.getByRole("button", { name: "Record my response" }));
  await B.getByRole("button", { name: "Record my response" }).click();
  await B.getByText("Recorded.").waitFor({ timeout: 30_000 });
  await hold(B, 1200);
  mark("B", "withdraw_end");
  await B.goto(`${BASE}/deals/${dealId}?tab=overview`);
  await B.getByTestId("complete-banner").waitFor({ timeout: 30_000 });
  await hold(B, 800);
  mark("B", "complete_start");
  await glide(B, B.getByTestId("agreement-status"));
  await hold(B, 1500);
  const viewRecord = B.getByTestId("complete-banner").getByRole("link", { name: "View evidence record" });
  await glide(B, viewRecord);
  await hold(B, 2500);
  mark("B", "complete_end");

  // 8c. The exported evidence record, opened in the same tab so it stays in this recording
  const recordHref = await viewRecord.getAttribute("href");
  const recordRes = await B.goto(`${BASE}${recordHref}`);
  if (!recordRes || recordRes.status() !== 200) throw new Error(`evidence record returned ${recordRes?.status()}`);
  await B.getByText(/Status: Complete/).waitFor({ timeout: 30_000 });
  await hold(B, 1000);
  mark("B", "evidence_start");
  await hold(B, 2500);
  for (let i = 0; i < 9; i++) { await scrollBy(B, 300, 12); await hold(B, 900); }
  await hold(B, 1500);
  mark("B", "evidence_end");

  // 9. History and export
  await B.goto(`${BASE}/deals/${dealId}?tab=record`);
  await hold(B, 1200);
  mark("B", "record_start");
  await hold(B, 1500);
  for (let i = 0; i < 6; i++) { await scrollBy(B, 330, 12); await hold(B, 700); }
  await hold(B, 800);
  await scrollBy(B, -5000, 6);
  await glide(B, B.getByRole("link", { name: "Download HTML record" }));
  await hold(B, 2500);
  mark("B", "record_end");
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  await S.screenshot({ path: path.join(outDir, "fail-seller.png") }).catch(() => {});
  await B.screenshot({ path: path.join(outDir, "fail-buyer.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  const sv = S.video(), bv = B.video();
  await s.ctx.close();
  await b.ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(outDir, "marks.json"), JSON.stringify({ dealId, marks, videos: { S: await sv.path(), B: await bv.path() } }, null, 2));
  console.log("deal", dealId, "videos", await sv.path(), await bv.path());
}
