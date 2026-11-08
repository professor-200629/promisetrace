import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __promisetracePrisma?: PrismaClient };

function makeClient() {
  const url = process.env.DATABASE_URL?.trim() || "file:./dev.db";
  const adapter = new PrismaLibSql({ url, authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.__promisetracePrisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__promisetracePrisma = prisma;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
