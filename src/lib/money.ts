/**
 * Money is stored as integer minor units plus an ISO currency code.
 * Only currencies PayPal Checkout accepts are allowed. INR is rejected on
 * purpose: PayPal India accounts cannot receive domestic INR payments.
 */
export const PAYPAL_CURRENCIES: Record<string, number> = {
  AUD: 2, BRL: 2, CAD: 2, CHF: 2, CZK: 2, DKK: 2, EUR: 2, GBP: 2, HKD: 2,
  HUF: 0, ILS: 2, JPY: 0, MXN: 2, MYR: 2, NOK: 2, NZD: 2, PHP: 2, PLN: 2,
  SEK: 2, SGD: 2, THB: 2, TWD: 0, USD: 2,
};

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAYPAL_CURRENCIES, code);
}

export function decimalsFor(currency: string): number {
  const d = PAYPAL_CURRENCIES[currency];
  if (d === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return d;
}

/** "300", "300.5", "300.50" -> 30050 (for 2-decimal currencies). Rejects anything else. */
export function parseToMinor(value: string, currency: string): number {
  const d = decimalsFor(currency);
  const trimmed = value.trim().replace(/,/g, "");
  const re = d === 0 ? /^\d{1,9}$/ : new RegExp(`^\\d{1,9}(\\.\\d{1,${d}})?$`);
  if (!re.test(trimmed)) throw new Error(`Invalid amount "${value}" for ${currency}`);
  const [whole, frac = ""] = trimmed.split(".");
  const minor = Number(whole) * 10 ** d + Number((frac + "0".repeat(d)).slice(0, d) || "0");
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Amount must be positive");
  return minor;
}

/** 30000, USD -> "300.00" (PayPal `value` format). */
export function minorToValue(minor: number, currency: string): string {
  const d = decimalsFor(currency);
  if (!Number.isSafeInteger(minor)) throw new Error("Amount must be an integer number of minor units");
  if (d === 0) return String(minor);
  const s = String(Math.abs(minor)).padStart(d + 1, "0");
  return `${minor < 0 ? "-" : ""}${s.slice(0, -d)}.${s.slice(-d)}`;
}

export function formatMoney(minor: number, currency: string): string {
  return `${minorToValue(minor, currency)} ${currency}`;
}

/** Exact comparison of a PayPal amount object with what we expect. */
export function sameAmount(
  expectedMinor: number,
  expectedCurrency: string,
  actual: { currency_code?: string; value?: string } | undefined,
): boolean {
  if (!actual?.currency_code || !actual.value) return false;
  if (actual.currency_code !== expectedCurrency) return false;
  try {
    return parseToMinor(actual.value, expectedCurrency) === expectedMinor;
  } catch {
    return false;
  }
}
