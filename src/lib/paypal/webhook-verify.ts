import { createVerify, X509Certificate } from "node:crypto";
import { crc32Decimal } from "@/lib/hash";

/**
 * PayPal webhook self-verification, per
 * https://developer.paypal.com/api/rest/webhooks/rest/ (checked 8 Nov 2026):
 * signed message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`
 * verified with SHA256 + the public key from `paypal-cert-url`.
 * The raw body bytes must be used; never re-serialise the JSON first.
 */

const ALLOWED_CERT_HOSTS = new Set([
  "api.paypal.com",
  "api-m.paypal.com",
  "api.sandbox.paypal.com",
  "api-m.sandbox.paypal.com",
]);

export type WebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function readWebhookHeaders(h: Headers): WebhookHeaders | null {
  const transmissionId = h.get("paypal-transmission-id");
  const transmissionTime = h.get("paypal-transmission-time");
  const transmissionSig = h.get("paypal-transmission-sig");
  const certUrl = h.get("paypal-cert-url");
  const authAlgo = h.get("paypal-auth-algo") ?? "SHA256withRSA";
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl) return null;
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

export function isAllowedCertUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && ALLOWED_CERT_HOSTS.has(u.hostname) && u.pathname.startsWith("/v1/notifications/certs/");
  } catch {
    return false;
  }
}

export type CertFetcher = (url: string) => Promise<string>;

const certCache = new Map<string, { pem: string; at: number }>();

export const fetchCertPem: CertFetcher = async (url) => {
  const hit = certCache.get(url);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.pem;
  const res = await fetch(url, { cache: "no-store", redirect: "error" });
  if (!res.ok) throw new Error(`Could not download PayPal certificate (HTTP ${res.status})`);
  const pem = await res.text();
  if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("PayPal certificate response was not PEM");
  certCache.set(url, { pem, at: Date.now() });
  return pem;
};

export async function verifyWebhookSignature(args: {
  headers: WebhookHeaders;
  rawBody: Uint8Array;
  webhookId: string;
  fetchCert?: CertFetcher;
  now?: Date;
}): Promise<VerifyResult> {
  const { headers, rawBody, webhookId } = args;
  if (!webhookId) return { ok: false, reason: "PAYPAL_WEBHOOK_ID is not configured" };
  if (!/^SHA256withRSA$/i.test(headers.authAlgo)) return { ok: false, reason: `Unsupported auth algorithm ${headers.authAlgo}` };
  if (!isAllowedCertUrl(headers.certUrl)) return { ok: false, reason: "Certificate URL is not a PayPal certificate endpoint" };

  let pem: string;
  try {
    pem = await (args.fetchCert ?? fetchCertPem)(headers.certUrl);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Certificate download failed" };
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    return { ok: false, reason: "Certificate could not be parsed" };
  }
  const now = args.now ?? new Date();
  if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) {
    return { ok: false, reason: "Certificate is outside its validity period" };
  }

  const message = `${headers.transmissionId}|${headers.transmissionTime}|${webhookId}|${crc32Decimal(rawBody)}`;
  const ok = createVerify("SHA256").update(message).verify(cert.publicKey, headers.transmissionSig, "base64");
  return ok ? { ok: true } : { ok: false, reason: "Signature does not match" };
}
