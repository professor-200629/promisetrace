/**
 * Applies prisma/migrations/*.sql to the database in DATABASE_URL using the
 * libSQL client. Works for local files and for remote Turso/libSQL URLs
 * (which `prisma migrate deploy` cannot reach). Non-destructive: each
 * migration runs once and is recorded in _pt_migrations.
 *
 *   npx tsx scripts/migrate-libsql.ts
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL?.trim() || "file:./dev.db";
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined });
  await client.execute(`CREATE TABLE IF NOT EXISTS _pt_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  // Databases created earlier by `prisma migrate deploy` already have the tables: record them instead of re-running.
  const prismaTable = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`);
  const prismaApplied = new Set<string>();
  if (prismaTable.rows.length) for (const r of (await client.execute(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`)).rows) prismaApplied.add(String(r.migration_name));

  const dir = path.resolve(import.meta.dirname, "..", "prisma", "migrations");
  const names = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "migration.sql"))).sort();
  for (const name of names) {
    const done = await client.execute({ sql: `SELECT 1 FROM _pt_migrations WHERE name = ?`, args: [name] });
    if (done.rows.length) continue;
    if (!prismaApplied.has(name)) {
      await client.executeMultiple(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
      console.log(`applied ${name}`);
    } else console.log(`recorded ${name} (already applied by prisma)`);
    await client.execute({ sql: `INSERT INTO _pt_migrations (name, applied_at) VALUES (?, ?)`, args: [name, new Date().toISOString()] });
  }
  console.log("database is up to date");
  client.close();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
