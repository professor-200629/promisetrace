// Shared helpers for recording the demo video against the hosted sandbox demo.
// Fictional demo accounts only (prisma/seed.ts). No real money: PayPal sandbox.
export const BASE = process.env.DEMO_BASE ?? "https://promisetrace-sandbox.vercel.app";
export const SELLER = "seller@demo.promisetrace.test";
export const BUYER = "buyer@demo.promisetrace.test";
export const DEMO_PASSWORD = "promisetrace-demo-2026"; // published test-only password (README, seed)

// Visible cursor + click ripple, because headless recordings show no pointer.
export const CURSOR_SCRIPT = `
(() => {
  if (window.top !== window) return;
  const add = () => {
    if (document.getElementById('__pt_cursor')) return;
    const c = document.createElement('div');
    c.id = '__pt_cursor';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,38,38,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .12s';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(1.8)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

export async function signIn(page, email, next) {
  await page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 45_000 });
}

export const pause = (page, ms) => page.waitForTimeout(ms);

/**
 * Fill PayPal's inline guest card form with PayPal's published sandbox test card and fictional
 * US billing details. PayPal shows different field sets (ZIP only, or a full address), so only
 * the fields that are present are filled. Returns the field names seen.
 */
export async function fillCardForm(cf, card, { typeDelay = 40 } = {}) {
  // The billing fields render a moment after the card fields.
  await cf.locator('[name="postcode"], [name="line1"], [name="billingAddress.line1"], [name="phone"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
  const names = await cf.locator("input, select").evaluateAll((els) => els.map((e) => e.getAttribute("name")).filter(Boolean));
  const has = (n) => names.includes(n);
  const type = async (n, v, d = typeDelay) => { if (has(n)) await cf.locator(`[name="${n}"]`).pressSequentially(v, { delay: d }); };
  const fill = async (n, v) => { if (has(n)) await cf.locator(`[name="${n}"]`).fill(v); };
  await type("cardnumber", card);
  await type("expiry-date", "1230", 60);
  await type("credit-card-security", card.length === 15 ? "1234" : "123", 60);
  await fill("givenName", process.env.PT_GIVEN ?? "Jordan");
  await fill("familyName", process.env.PT_FAMILY ?? "Lee");
  for (const n of ["line1", "billingAddress.line1", "addressLine1", "streetAddress"]) await fill(n, "100 Test Street");
  for (const n of ["city", "billingAddress.city", "locality"]) await fill(n, "Portland");
  for (const n of ["state", "billingAddress.state", "region"]) {
    if (!has(n)) continue;
    const loc = cf.locator(`[name="${n}"]`);
    const tag = await loc.evaluate((e) => e.tagName);
    if (tag === "SELECT") await loc.selectOption({ label: "Oregon" }).catch(() => loc.selectOption("OR")); else await loc.fill("OR");
  }
  await fill("postcode", process.env.PT_ZIP ?? "97205");
  await type("phone", process.env.PT_PHONE ?? "5035550123", 20);
  await fill("email", process.env.PT_EMAIL ?? "jordan.lee@example.com");
  return names;
}

/** Find the frame that contains PayPal's card number field (it lives inside PayPal's iframes). */
export async function findCardFrame(page, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const f of page.frames()) {
      try {
        const n = await f.locator('input[name="cardnumber"], input[autocomplete="cc-number"], input[aria-label*="Card number" i], input[placeholder*="Card number" i]').count();
        if (n > 0) return f;
      } catch { /* frame detached */ }
    }
    await page.waitForTimeout(500);
  }
  return null;
}
