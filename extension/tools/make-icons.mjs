// Dependency-free PNG icon generator. Draws a purple rounded square with three
// "condensing" bars (a distillation glyph). Usage: node tools/make-icons.mjs [outdir]
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
function draw(size) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  const r = size * 0.2;
  const bg = [124, 58, 237, 255]; // #7c3aed
  const fg = [255, 255, 255, 255];
  const set = (x, y, c) => { const i = (y * size + x) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3]; };
  const inRounded = (x, y) => {
    const lo = r, hi = size - r;
    if (x < lo && y < lo) return (x - lo) ** 2 + (y - lo) ** 2 <= r * r;
    if (x > hi && y < lo) return (x - hi) ** 2 + (y - lo) ** 2 <= r * r;
    if (x < lo && y > hi) return (x - lo) ** 2 + (y - hi) ** 2 <= r * r;
    if (x > hi && y > hi) return (x - hi) ** 2 + (y - hi) ** 2 <= r * r;
    return true;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (inRounded(x, y)) set(x, y, bg);
  const barH = Math.max(2, Math.round(size * 0.1));
  const gap = Math.max(2, Math.round(size * 0.085));
  const widths = [0.54, 0.4, 0.26];
  let by = Math.round((size - (barH * 3 + gap * 2)) / 2);
  const cx = size / 2;
  for (const w of widths) {
    const halfw = (size * w) / 2;
    for (let y = by; y < by + barH; y++)
      for (let x = Math.round(cx - halfw); x < Math.round(cx + halfw); x++)
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, fg);
    by += barH + gap;
  }
  return buf;
}
const outDir = path.resolve(process.argv[2] || path.join(import.meta.dirname, "..", "icons"));
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(outDir, `icon${s}.png`), png(s, draw(s)));
console.log("icons written to", outDir);
