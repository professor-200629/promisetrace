// Starts a production server for a LIVE check (real Claude extraction, PayPal sandbox) on a fresh,
// disposable database, so the hosted Turso database and dev.db are never touched.
// Needs `npm run build` first and PayPal sandbox + Anthropic credentials in .env.
// PayPal webhooks cannot reach localhost; the app reads PayPal's API responses instead.
// Usage: node scripts/live-server.mjs   (port LIVE_PORT, default 3300; database live-check.db)
import { spawn, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = process.env.LIVE_PORT ?? "3300";
for (const f of ["live-check.db", "live-check.db-journal", "live-check.db-wal", "live-check.db-shm"]) rmSync(path.join(root, f), { force: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "file:./live-check.db",
  DATABASE_AUTH_TOKEN: "",
  APP_URL: `http://localhost:${port}`,
  PAYPAL_MODE: "sandbox",
  AI_PROVIDER: "anthropic",
};
execSync("npx prisma migrate deploy", { cwd: root, env, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "inherit" });
const child = spawn("npx", ["next", "start", "--port", port], { cwd: root, env, stdio: "inherit", shell: true });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
