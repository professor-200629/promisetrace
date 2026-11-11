// Renders the title and closing cards for the demo video as 1280x720 PNGs.
//   node scripts/demo-video/cards.mjs <outDir>
import { chromium } from "@playwright/test";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const base = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1280px;height:720px;font-family:"Segoe UI",system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;flex-direction:column;justify-content:center;padding:0 110px}
  .tag{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc;margin-bottom:22px}
  h1{font-size:84px;font-weight:700;letter-spacing:-.02em}
  .logo{display:inline-flex;align-items:center;justify-content:center;width:84px;height:84px;border-radius:18px;background:#f8fafc;color:#0f172a;font-size:38px;font-weight:800;margin-right:26px;vertical-align:middle}
  p.lead{font-size:34px;line-height:1.35;margin-top:28px;color:#e2e8f0;max-width:980px}
  .foot{position:absolute;left:110px;bottom:56px;font-size:20px;color:#94a3b8}
  ul{list-style:none;margin-top:26px}
  li{font-size:25px;line-height:1.4;margin:10px 0;color:#e2e8f0;padding-left:26px;position:relative}
  li:before{content:"";position:absolute;left:0;top:14px;width:10px;height:10px;border-radius:50%;background:#38bdf8}
  h2{font-size:44px;font-weight:700}
  .links{margin-top:30px;font-size:24px;color:#7dd3fc;line-height:1.6}
`;
const title = `<html><head><style>${base}</style></head><body>
  <div class="tag">PayPal AI Hackathon 2026 · demo</div>
  <h1><span class="logo">PT</span>PromiseTrace</h1>
  <p class="lead">Agree the work. PayPal holds the payment.<br>Release it when the delivery matches what was agreed.</p>
  <div class="foot">Recorded on the live PayPal sandbox with real Claude extraction · all people, businesses and card details are fictional</div>
</body></html>`;
const end = `<html><head><style>${base}</style></head><body>
  <h2>How it is built, and its limits</h2>
  <ul>
    <li>PayPal Orders v2 with intent AUTHORIZE; Payments v2 authorization capture and void; signed webhooks verified</li>
    <li>Claude (Anthropic API) proposes the brief; code verifies every quote; people approve</li>
    <li>Sandbox, single-merchant build: paying each seller directly needs PayPal platform onboarding</li>
    <li>Holds last up to 29 days; PayPal capture is most likely to succeed within the first three days of authorization</li>
    <li>Checks cover format, count and deadline, not quality</li>
  </ul>
  <div class="links">Try it: promisetrace-sandbox.vercel.app<br>Code: github.com/professor-200629/promisetrace (MIT)</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
for (const [name, html] of [["title", title], ["end", end]]) {
  await page.setContent(html);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
await browser.close();
console.log("cards written");
