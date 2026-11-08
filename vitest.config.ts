import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      DATABASE_URL: "file:./test.db",
      PAYPAL_MODE: "fixture",
      AI_PROVIDER: "fixture",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    },
  },
});
