import 'server-only';
import { deflateSync } from 'node:zlib';
import { drawChar } from '@/game/character';
import type { Palette } from '@/game/types';

/* ============================================================
   รูปหน้าพนักงาน (pixel) ฝั่งเซิร์ฟเวอร์ - เอาไปแปะในการ์ด Teams / embed Discord / webhook
   drawChar ใช้แค่ fillRect + save/translate/scale จึงจำลอง context 2D เล็ก ๆ ที่เขียนลง buffer RGBA ได้
   แล้วเข้ารหัส PNG เอง (zlib ของ node) - ไม่ต้องพึ่ง node-canvas
   ครอปเฉพาะหัว+ไหล่ 16x15 เหมือน Portrait ในหน้าเว็บ แล้วขยาย scale เท่า (nearest neighbour)
   ============================================================ */

const W = 16, H = 24, HEAD_H = 15;

/** context 2D จำลอง - รองรับเท่าที่ drawChar ใช้ */
class PixelCtx {
  fillStyle = '#000000';
  private tx = 0; private sx = 1;
  private stack: { tx: number; sx: number }[] = [];
  readonly buf = new Uint8Array(W * H * 4);
  save() { this.stack.push({ tx: this.tx, sx: this.sx }); }
  restore() { const s = this.stack.pop(); if (s) { this.tx = s.tx; this.sx = s.sx; } }
  translate(x: number) { this.tx += x * this.sx; }
  scale(x: number) { this.sx *= x; }
  fillRect(x: number, y: number, w: number, h: number) {
    const c = parseColor(this.fillStyle);
    if (!c) return;
    // แกน x ผ่าน translate/scale (ใช้กระจกซ้าย-ขวาเท่านั้น) แกน y ตรง ๆ
    let x0 = this.tx + x * this.sx, x1 = this.tx + (x + w) * this.sx;
    if (x0 > x1) [x0, x1] = [x1, x0];
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
      for (let xx = Math.max(0, Math.round(x0)); xx < Math.min(W, Math.round(x1)); xx++) {
        const i = (yy * W + xx) * 4;
        const a = c[3];
        if (a >= 255) { this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = 255; continue; }
        // alpha blend (เงาโปร่งแสงบางจุด)
        const ia = 255 - a;
        this.buf[i] = (c[0] * a + this.buf[i] * ia) / 255;
        this.buf[i + 1] = (c[1] * a + this.buf[i + 1] * ia) / 255;
        this.buf[i + 2] = (c[2] * a + this.buf[i + 2] * ia) / 255;
        this.buf[i + 3] = Math.min(255, this.buf[i + 3] + a);
      }
    }
  }
}

function parseColor(s: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex[2] ? parseInt(hex[2], 16) : 255];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(s.trim());
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], Math.round((rgba[4] === undefined ? 1 : +rgba[4]) * 255)];
  return null;
}

/* ---- PNG encoder เล็ก ๆ (RGBA 8 บิต, ไม่บีบอัดพิเศษ) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0)),
  ]);
}

/** PNG หัวพนักงาน (16x15 ขยาย scale เท่า) - หันหน้าเข้าหาคนดู ท่ายืน */
export function avatarPng(pal: Palette, scale = 4): Buffer {
  const s = Math.max(1, Math.min(8, Math.floor(scale)));
  const ctx = new PixelCtx();
  drawChar(ctx as unknown as CanvasRenderingContext2D, pal, 'down', 'stand', 1);
  const w = W * s, h = HEAD_H * s;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((Math.floor(y / s)) * W + Math.floor(x / s)) * 4;
      const di = (y * w + x) * 4;
      out[di] = ctx.buf[si]; out[di + 1] = ctx.buf[si + 1]; out[di + 2] = ctx.buf[si + 2]; out[di + 3] = ctx.buf[si + 3];
    }
  }
  return encodePng(out, w, h);
}

/** data URI สำหรับฝังในการ์ด (Teams Adaptive Card รับ base64) */
export function avatarDataUri(pal: Palette, scale = 4): string {
  return `data:image/png;base64,${avatarPng(pal, scale).toString('base64')}`;
}

/** query string ของ palette สำหรับ /api/avatar (ใช้กับช่องที่ต้องการ URL จริง เช่น Slack/Discord) */
export function paletteParam(pal: Palette): string {
  const o = { skin: pal.skin, hair: pal.hair, shirt: pal.shirt, pants: pal.pants, shoes: pal.shoes, ...(pal.fem ? { fem: true } : {}), ...(pal.helmet ? { helmet: pal.helmet } : {}) };
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}
export function parsePaletteParam(p: string): Palette | null {
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
    const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
    const skin = hex(o.skin), hair = hex(o.hair), shirt = hex(o.shirt), pants = hex(o.pants), shoes = hex(o.shoes);
    if (!skin || !hair || !shirt || !pants || !shoes) return null;
    const helmet = hex(o.helmet);
    return { skin, hair, shirt, pants, shoes, ...(o.fem ? { fem: true } : {}), ...(helmet ? { helmet } : {}) };
  } catch { return null; }
}
