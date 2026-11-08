import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

/**
 * Builds a brand-new test.db from the committed migrations (no destructive
 * Prisma command), plus a throwaway self-signed certificate for the webhook
 * signature test.
 */
export default async function setup() {
  const root = path.resolve(import.meta.dirname, "..");
  for (const f of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) rmSync(path.join(root, f), { force: true });
  const client = createClient({ url: "file:" + path.join(root, "test.db").split(path.sep).join("/") });
  const migDir = path.join(root, "prisma", "migrations");
  for (const m of readdirSync(migDir).filter((d) => existsSync(path.join(migDir, d, "migration.sql"))).sort()) {
    await client.executeMultiple(readFileSync(path.join(migDir, m, "migration.sql"), "utf8"));
  }
  client.close();

  const dir = path.join(root, "test-results", "certs");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path.join(dir, "cert.pem"))) {
    try {
      execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=promisetrace-test-only"', {
        cwd: dir,
        stdio: "pipe",
        env: { ...process.env, MSYS_NO_PATHCONV: "1" },
      });
    } catch {
      console.warn("openssl not available: the end-to-end webhook signature test will be skipped");
    }
  }
}
