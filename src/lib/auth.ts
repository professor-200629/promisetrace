import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
// Extra origins that serve the same deployment (e.g. an older domain alias), comma-separated.
const aliasOrigins = (process.env.APP_ALIASES ?? "").split(",").map((s) => s.trim()).filter((s) => /^https?:\/\/[^/]+$/.test(s));

if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}

/**
 * Better Auth handles password hashing (scrypt), HttpOnly session cookies,
 * origin checks for state-changing auth requests, and rate limiting.
 */
export const auth = betterAuth({
  appName: "PromiseTrace",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [appUrl, ...aliasOrigins],
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: {
    useSecureCookies: appUrl.startsWith("https://"),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  plugins: [nextCookies()],
});
