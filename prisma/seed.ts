/**
 * Creates fictional demo accounts (idempotent). These are throwaway test
 * accounts for a sandbox demo, safe to share with judges. Never reuse this
 * password anywhere else.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/db";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD?.trim() || "promisetrace-demo-2026";
export const DEMO_USERS = [
  { name: "Priya Nair (demo seller)", email: "seller@demo.promisetrace.test" },
  { name: "Alex Rivera (demo buyer)", email: "buyer@demo.promisetrace.test" },
  { name: "Mallory (unrelated demo user)", email: "outsider@demo.promisetrace.test" },
];

async function main() {
  for (const u of DEMO_USERS) {
    const exists = await prisma.user.findUnique({ where: { email: u.email } });
    if (exists) {
      console.log(`exists   ${u.email}`);
      continue;
    }
    await auth.api.signUpEmail({ body: { name: u.name, email: u.email, password: DEMO_PASSWORD } });
    console.log(`created  ${u.email}`);
  }
  console.log("Demo password: see DEMO_PASSWORD in prisma/seed.ts (test-only).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
