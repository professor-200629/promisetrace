// Starts a production server on a fresh, separate database for browser tests.
// PayPal and AI run in their labelled FIXTURE modes so the test needs no network.
// Usage: node scripts/e2e-server.mjs   (Playwright starts it automatically)
import { spawn, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = process.env.E2E_PORT ?? "3200";
for (const f of ["e2e-test.db", "e2e-test.db-journal", "e2e-test.db-wal", "e2e-test.db-shm"]) rmSync(path.join(root, f), { force: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "file:./e2e-test.db",
  APP_URL: `http://localhost:${port}`,
  PAYPAL_MODE: process.env.E2E_PAYPAL_MODE ?? "fixture",
  AI_PROVIDER: process.env.E2E_AI_PROVIDER ?? "fixture",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-0001",
};
execSync("npx prisma migrate deploy", { cwd: root, env, stdio: "inherit" });
const child = spawn("npx", ["next", "start", "--port", port], { cwd: root, env, stdio: "inherit", shell: true });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
