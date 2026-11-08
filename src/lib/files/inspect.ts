/**
 * Deterministic file inspection. The type comes from the file's bytes, never
 * from its name or the browser-supplied MIME type. Nothing here executes or
 * renders the file. SVG and PDF are only scanned as bytes/text.
 */
export type DetectedType = "png" | "jpeg" | "svg" | "pdf" | "zip" | "unknown";

export type Inspection = {
  detectedType: DetectedType;
  declaredExt: string;
  widthPx: number | null;
  heightPx: number | null;
  safetyNotes: string[];
  extensionMatches: boolean;
};

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  const e = m ? m[1]!.toLowerCase() : "";
  return e === "jpg" ? "jpeg" : e;
}

export function inspectFile(name: string, bytes: Uint8Array): Inspection {
  const declaredExt = extOf(name);
  const notes: string[] = [];
  let detectedType: DetectedType = "unknown";
  let widthPx: number | null = null;
  let heightPx: number | null = null;

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detectedType = "png";
    if (bytes.length >= 24 && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      widthPx = dv.getUint32(16);
      heightPx = dv.getUint32(20);
    } else notes.push("PNG header is malformed.");
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detectedType = "jpeg";
  } else if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    detectedType = "pdf";
    const head = latin1(bytes.slice(0, Math.min(bytes.length, 2_000_000)));
    if (/\/JavaScript|\/JS\s*[(<]/.test(head)) notes.push("PDF contains JavaScript actions. It is stored but never opened in the browser.");
    if (/\/Launch|\/EmbeddedFile/.test(head)) notes.push("PDF contains launch actions or embedded files.");
  } else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    detectedType = "zip";
    notes.push("ZIP contents are not inspected; the buyer should confirm what is inside.");
  } else {
    const text = utf8Prefix(bytes);
    if (text !== null && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      detectedType = "svg";
      if (/<script[\s>]/i.test(text)) notes.push("SVG contains a <script> element.");
      if (/\son[a-z]+\s*=/i.test(text)) notes.push("SVG contains event-handler attributes (e.g. onload).");
      if (/(href|xlink:href)\s*=\s*["']\s*(https?:|javascript:|data:text\/html)/i.test(text)) notes.push("SVG references external or script URLs.");
      if (/<foreignObject[\s>]/i.test(text)) notes.push("SVG contains <foreignObject> (embedded HTML).");
      const w = /<svg[^>]*\swidth\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(text);
      const h = /<svg[^>]*\sheight\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(text);
      const vb = /<svg[^>]*\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(text);
      widthPx = w ? Math.round(Number(w[1])) : vb ? Math.round(Number(vb[1])) : null;
      heightPx = h ? Math.round(Number(h[1])) : vb ? Math.round(Number(vb[2])) : null;
    }
  }
  const extensionMatches = declaredExt === detectedType;
  if (detectedType !== "unknown" && !extensionMatches) notes.push(`File name ends in .${declaredExt || "(none)"} but the content is ${detectedType.toUpperCase()}.`);
  if (detectedType === "unknown") notes.push("File type could not be identified from its contents.");
  return { detectedType, declaredExt, widthPx, heightPx, safetyNotes: notes, extensionMatches };
}

function latin1(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 65536) s += String.fromCharCode(...b.subarray(i, i + 65536));
  return s;
}

function utf8Prefix(b: Uint8Array): string | null {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(b.slice(0, 1_000_000));
    return s.replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** Upload policy: only these detected types are accepted at all. */
export const ACCEPTED_TYPES: DetectedType[] = ["png", "jpeg", "svg", "pdf", "zip"];
