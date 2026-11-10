// Local test page: approve a pre-created order through the PayPal JS SDK Buttons.
// Usage: node scripts/paypal-authorize-page.mjs [path-to-.env]   then open http://localhost:4599/?order=<ORDER_ID>&intent=authorize
import http from "node:http";
import fs from "node:fs";

const envText = fs.readFileSync(process.argv[2] ?? ".env", "utf8");
const clientId = (envText.match(/^PAYPAL_CLIENT_ID\s*=\s*"?([^"\r\n]+)"?/m) || [])[1]?.trim();
if (!clientId) { console.error("PAYPAL_CLIENT_ID not found"); process.exit(1); }

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Authorize check</title>
<style>body{font-family:system-ui;max-width:520px;margin:40px auto;padding:0 16px}#s{font-weight:600}</style></head>
<body><h1>PromiseTrace authorize check (sandbox)</h1><p>Order: <code id="o"></code> intent: <code id="i"></code></p>
<p id="s">Loading PayPal SDK...</p><div id="b"></div>
<script>
const q = new URLSearchParams(location.search);
const orderId = q.get("order"); const intent = q.get("intent") || "authorize";
document.getElementById("o").textContent = orderId; document.getElementById("i").textContent = intent;
const st = (t) => { document.getElementById("s").textContent = t; };
const sdk = document.createElement("script");
sdk.src = "https://www.sandbox.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=" + intent + "&components=buttons";
sdk.onload = () => {
  paypal.Buttons({
    createOrder: () => orderId,
    onApprove: (d) => st("APPROVED " + d.orderID),
    onCancel: () => st("CANCELLED"),
    onError: (e) => st("ERROR " + (e && e.message ? e.message : e)),
  }).render("#b").then(() => st("Ready"));
};
sdk.onerror = () => st("SDK failed to load");
document.head.appendChild(sdk);
</script></body></html>`;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(4599, "127.0.0.1", () => console.log("listening on http://localhost:4599"));
