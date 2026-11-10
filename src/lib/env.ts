import { z } from "zod";

/**
 * Server-side configuration. Read lazily so tests can set process.env first.
 * Missing PayPal or AI credentials never throw here: callers ask for a
 * "setup state" and the UI explains what is missing.
 */
const intFrom = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const numFrom = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : Number.parseFloat(v)))
    .pipe(z.number().nonnegative());

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),
  APP_URL: z.string().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_MODE: z.enum(["sandbox", "fixture"]).default("sandbox"),
  /** AUTHORIZE: hold the payment at checkout and capture it when the buyer accepts. CAPTURE: take it at checkout. */
  CHECKOUT_INTENT: z.enum(["AUTHORIZE", "CAPTURE"]).default("AUTHORIZE"),
  /** Days after a delivery before the seller may capture a held payment without a buyer response (all checks met, no open objections). */
  REVIEW_WINDOW_DAYS: intFrom(5),
  AI_PROVIDER: z.enum(["anthropic", "fixture"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_BASE_URL: z.url().default("https://api.anthropic.com"),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_MAX_OUTPUT_TOKENS: intFrom(8000),
  AI_MAX_INPUT_CHARS: intFrom(20000),
  AI_DAILY_CALL_LIMIT: intFrom(40),
  AI_DAILY_CALL_LIMIT_PER_USER: intFrom(8),
  AI_PRICE_INPUT_PER_MTOK: numFrom(4),
  AI_PRICE_OUTPUT_PER_MTOK: numFrom(20),
  // Vercel rejects function request/response bodies over 4.5 MB, so one file AND one delivery stay under 4 MB by default.
  MAX_UPLOAD_BYTES: intFrom(4 * 1024 * 1024),
  MAX_DELIVERY_BYTES: intFrom(4 * 1024 * 1024),
  MAX_FILES_PER_DELIVERY: intFrom(10),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function env(): AppEnv {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const v = process.env[key];
    raw[key] = v === undefined || v.trim() === "" ? undefined : v.trim();
  }
  return EnvSchema.parse(raw);
}

export type PayPalSetup =
  | { state: "ready"; mode: "sandbox" }
  | { state: "fixture"; mode: "fixture" }
  | { state: "missing_credentials"; mode: "sandbox"; missing: string[] };

export function paypalSetup(): PayPalSetup {
  const e = env();
  if (e.PAYPAL_MODE === "fixture") return { state: "fixture", mode: "fixture" };
  const missing: string[] = [];
  if (!e.PAYPAL_CLIENT_ID) missing.push("PAYPAL_CLIENT_ID");
  if (!e.PAYPAL_CLIENT_SECRET) missing.push("PAYPAL_CLIENT_SECRET");
  if (missing.length) return { state: "missing_credentials", mode: "sandbox", missing };
  return { state: "ready", mode: "sandbox" };
}

export type AiSetup =
  | { state: "ready"; provider: "anthropic"; model: string }
  | { state: "fixture"; provider: "fixture"; model: "fixture" }
  | { state: "missing_credentials"; provider: "anthropic"; model: string };

export function aiSetup(): AiSetup {
  const e = env();
  if (e.AI_PROVIDER === "fixture") return { state: "fixture", provider: "fixture", model: "fixture" };
  if (!e.ANTHROPIC_API_KEY) return { state: "missing_credentials", provider: "anthropic", model: e.AI_MODEL };
  return { state: "ready", provider: "anthropic", model: e.AI_MODEL };
}
