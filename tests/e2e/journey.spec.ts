import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

// Throwaway local test accounts, generated per run (never real credentials).
const pw = () => `e2e-${randomBytes(9).toString("base64url")}`;
const mail = (who: string) => `${who}-${randomBytes(4).toString("hex")}@example.test`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 2, 0, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#2a6"/></svg>');

async function signUp(browser: Browser, name: string, next = "/deals") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/sign-up?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Email").fill(mail(name.split(" ")[0]!.toLowerCase()));
  await page.getByLabel("Password").fill(pw());
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-up"));
  return page;
}

async function tab(page: Page, dealUrl: string, name: string) {
  await page.goto(`${dealUrl}?tab=${name}`);
}

test("seller and buyer agree, pay (fixture), catch the missing SVG, fix it and keep a verifiable record", async ({ browser }) => {
  // --- Seller creates the agreement from the fictional conversation
  const seller = await signUp(browser, "Priya Seller");
  await seller.goto("/deals/new");
  await seller.getByLabel("Agreement title").fill("Northwind Coffee logo package");
  await seller.getByRole("button", { name: "Use the fictional logo example" }).click();
  await seller.getByRole("button", { name: "Create and propose brief" }).click();
  await seller.waitForURL(/\/deals\/[^/?]+\?tab=brief/);
  const dealUrl = seller.url().split("?")[0]!;
  await expect(seller.getByText("rule-based FIXTURE extractor (not AI)")).toBeVisible();
  const invite = await seller.locator('input[readonly]').first().inputValue();
  expect(invite).toMatch(/\/invite\//);

  // --- Buyer joins through the private invite link
  const invitePath = new URL(invite).pathname;
  const buyer = await signUp(browser, "Alex Buyer", invitePath);
  await buyer.getByRole("button", { name: "Join this agreement as the buyer" }).click();
  await buyer.waitForURL(/tab=brief/);
  await expect(buyer.getByRole("heading", { name: "Northwind Coffee logo package" })).toBeVisible();

  // --- Buyer edits before approving: a new version is created
  await buyer.getByRole("spinbutton").first().waitFor();
  await buyer.getByLabel("Title").fill("Northwind Coffee logo package (final)");
  await buyer.getByRole("button", { name: /Save as version 2/ }).click();
  await expect(buyer.getByText(/Saved as version 2/)).toBeVisible();

  // --- Both approve version 2
  await buyer.reload();
  await buyer.getByRole("button", { name: "Approve version 2" }).click();
  await expect(buyer.getByText(/You approved version 2. Waiting for the seller/)).toBeVisible();
  await tab(seller, dealUrl, "brief");
  await seller.getByRole("button", { name: "Approve version 2" }).click();
  await expect(seller.getByText(/Waiting for the buyer to pay/)).toBeVisible();

  // --- Seller cannot pay; buyer pays through the labelled fixture checkout
  await tab(seller, dealUrl, "payment");
  await expect(seller.getByText(/Only the buyer can start checkout/)).toBeVisible();
  await tab(buyer, dealUrl, "payment");
  await expect(buyer.getByText("FIXTURE checkout.")).toBeVisible();
  await buyer.getByRole("button", { name: /Simulate a hold of 300.00 USD/ }).click();
  await expect(buyer.getByText("FIXTURE — not PayPal")).toBeVisible();
  await expect(buyer.getByText(/PayPal holds 300.00 USD for this agreement/)).toBeVisible();

  // --- Seller delivers concepts + final PNG but forgets the SVG
  await tab(seller, dealUrl, "delivery");
  const inputs = seller.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles([{ name: "concept-a.png", mimeType: "image/png", buffer: PNG }, { name: "concept-b.png", mimeType: "image/png", buffer: PNG }]);
  await inputs.nth(1).setInputFiles([{ name: "northwind-final.png", mimeType: "image/png", buffer: PNG }]);
  await seller.getByLabel(/Note to the buyer/).fill("Final logo attached.");
  await seller.getByRole("button", { name: "Submit delivery" }).click();
  await expect(seller.getByText(/Delivery recorded\. Not met yet: .*SVG/)).toBeVisible();

  // --- The overview shows the missing SVG linked to the source passage
  await tab(buyer, dealUrl, "overview");
  const svgRow = buyer.locator("tr", { hasText: "SVG" }).filter({ hasText: "Not met" });
  await expect(svgRow).toBeVisible();
  await expect(svgRow.getByRole("link", { name: /S1 · line/ })).toBeVisible();

  // --- Buyer objects; acknowledgement is recorded separately from acceptance
  await tab(buyer, dealUrl, "delivery");
  await buyer.getByLabel(/Report a problem/).check();
  await buyer.getByLabel("Message (required)").fill("The SVG file we agreed on is missing.");
  await buyer.getByRole("button", { name: "Record my response" }).click();
  await expect(buyer.getByText("Recorded.")).toBeVisible();

  // --- Seller adds the SVG; every checkable item is now met
  await tab(seller, dealUrl, "delivery");
  await seller.locator('input[type="file"]').nth(1).setInputFiles([{ name: "northwind-final.svg", mimeType: "image/svg+xml", buffer: SVG }]);
  await seller.getByRole("button", { name: "Submit delivery" }).click();
  await expect(seller.getByText(/Delivery recorded\. \d+ checks met/)).toBeVisible();

  // --- Buyer accepts: the held payment is captured; the objection stays visible until withdrawn
  await tab(buyer, dealUrl, "delivery");
  await buyer.getByLabel(/^Accept/).check();
  await buyer.getByRole("button", { name: "Accept and release 300.00 USD to the seller" }).click();
  await expect(buyer.getByText(/Acceptance recorded\. PayPal captured the held payment/)).toBeVisible();
  await tab(buyer, dealUrl, "overview");
  await expect(buyer.getByText("Open buyer objections")).toBeVisible();
  await tab(buyer, dealUrl, "delivery");
  await buyer.getByLabel(/Withdraw an objection/).check();
  await buyer.getByLabel("Message (optional)").fill("SVG received, thanks.");
  await buyer.getByRole("button", { name: "Record my response" }).click();
  await expect(buyer.getByText("Recorded.")).toBeVisible();

  // --- History and export
  await tab(seller, dealUrl, "record");
  await expect(seller.getByText(/Hash chain intact/)).toBeVisible();
  const dealId = dealUrl.split("/").pop()!;
  const res = await seller.request.get(`/api/deals/${dealId}/export?format=json`);
  expect(res.ok()).toBeTruthy();
  const record = await res.json();
  expect(record.history.hashChainIntact).toBe(true);
  expect(record.payment.assertionType).toBe("fixture_not_paypal");
  expect(record.payment).toMatchObject({ flow: "hold_at_checkout_capture_on_acceptance", status: "COMPLETED", captureTrigger: "BUYER_ACCEPTED" });
  expect(JSON.stringify(record)).not.toContain("@example.test");
  const svgReq = record.requirements.find((r: { key: string }) => r.key.endsWith(":svg"));
  expect(svgReq.result).toBe("MET");
  expect(svgReq.sourcePassages[0].quote).toMatch(/SVG/);

  // --- An unrelated signed-in user cannot open the agreement, its files or its export
  const outsider = await signUp(browser, "Mallory Outsider");
  await outsider.goto(dealUrl);
  await expect(outsider.getByRole("heading", { name: "Not found" })).toBeVisible();
  expect((await outsider.request.get(`/api/deals/${dealId}/export?format=json`)).status()).toBe(404);
  const fileHref = await (async () => { await tab(seller, dealUrl, "delivery"); return seller.getByRole("link", { name: "Download" }).first().getAttribute("href"); })();
  expect((await outsider.request.get(fileHref!)).status()).toBe(404);
  // Cross-origin state change is refused even with a valid session cookie
  const forged = await outsider.request.post(`/api/deals/${dealId}/paypal/order`, { headers: { Origin: "https://evil.example" } });
  expect(forged.status()).toBe(403);
});
