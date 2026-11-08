// Generates fictional demo deliverables (simple placeholder logos) in demo-files/.
// No external image libraries: PNGs are encoded with node:zlib.
//   node scripts/make-demo-files.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const out = path.resolve(import.meta.dirname, "..", "demo-files");
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const cup = (bg, fg, accent) => (x, y, s) => {
  const cx = s / 2, cy = s / 2, r = s * 0.36, d = Math.hypot(x - cx, y - cy);
  if (d < r && d > r * 0.86) return [...accent, 255];
  if (d < r * 0.86) {
    // stylised cup: body + handle + steam line
    const bx = x - cx, by = y - cy;
    if (by > -s * 0.08 && by < s * 0.16 && Math.abs(bx) < s * 0.14 - by * 0.25) return [...fg, 255];
    const hd = Math.hypot(bx - s * 0.17, by - s * 0.04);
    if (hd < s * 0.06 && hd > s * 0.035) return [...fg, 255];
    if (Math.abs(bx - Math.sin(by / 9) * 6) < 4 && by < -s * 0.11 && by > -s * 0.24) return [...fg, 255];
    return [...bg, 255];
  }
  return [255, 255, 255, 0];
};

writeFileSync(path.join(out, "concept-a.png"), png(512, cup([245, 236, 222], [92, 58, 33], [92, 58, 33])));
writeFileSync(path.join(out, "concept-b.png"), png(512, cup([28, 61, 52], [240, 226, 196], [201, 164, 92])));
writeFileSync(path.join(out, "northwind-final.png"), png(1024, cup([28, 61, 52], [240, 226, 196], [201, 164, 92])));
writeFileSync(path.join(out, "northwind-final.svg"), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Northwind Coffee (fictional demo logo)</title>
  <circle cx="512" cy="512" r="368" fill="#c9a45c"/>
  <circle cx="512" cy="512" r="316" fill="#1c3d34"/>
  <path d="M370 470 h284 l-30 190 a40 40 0 0 1 -40 34 h-144 a40 40 0 0 1 -40 -34 z" fill="#f0e2c4"/>
  <path d="M654 500 a52 52 0 1 1 0 104" fill="none" stroke="#f0e2c4" stroke-width="26"/>
  <path d="M470 400 q20 -40 0 -80 M540 400 q20 -40 0 -80" fill="none" stroke="#f0e2c4" stroke-width="16" stroke-linecap="round"/>
</svg>
`);
console.log("demo files written to", out);
