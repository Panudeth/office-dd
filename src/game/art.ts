/* ============================================================
   Pixel art ทั้งหมดวาดด้วยโค้ด - โทน Game Boy Advance (Gen 3)
   ใช้ dithering แทน gradient, outline เป็นสีเข้มของวัสดุนั้น ๆ
   ทุก canvas สร้างแบบ lazy (ห้ามสร้างตอน import - จะพังตอน SSR)
   ============================================================ */
import { GROUND, MH, MW, type MapObject } from './map';

export interface Surface { c: HTMLCanvasElement; g: CanvasRenderingContext2D }
export interface Sprite { c: HTMLCanvasElement; oy: number; ox?: number }

export function mk(w: number, h: number): Surface {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

type G = CanvasRenderingContext2D;
const P = (g: G, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = cl((n >> 16) & 255), g = cl((n >> 8) & 255), b = cl(n & 255);
  return '#' + (((r << 16) | (g << 8) | b) >>> 0).toString(16).padStart(6, '0');
}

/** dithering แบบ GBA: สลับ pixel ลายหมากรุก */
function dith(g: G, x: number, y: number, w: number, h: number, c1: string, c2: string, off = 0) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      g.fillStyle = (i + j + off) & 1 ? c2 : c1;
      g.fillRect(x + i, y + j, 1, 1);
    }
  }
}
/** dither จาง ๆ 1 ใน 4 พิกเซล */
export function dith4(g: G, x: number, y: number, w: number, h: number, c: string, off = 0) {
  g.fillStyle = c;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (((i + (j & 1) * 2 + off) & 3) === 0) g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/* ---------------- พื้นในอาคาร ---------------- */
function paintWood(g: G, r: () => number, v: number) {
  P(g, 0, 0, 16, 16, '#e0a868');
  dith4(g, 0, 0, 16, 16, '#d89c5c', v);
  P(g, 0, 7, 16, 1, '#c08448'); P(g, 0, 15, 16, 1, '#c08448');
  P(g, 0, 0, 16, 1, '#ecbc84'); P(g, 0, 8, 16, 1, '#ecbc84');
  P(g, 5, 1, 1, 6, '#c08448'); P(g, 12, 9, 1, 6, '#c08448');
  P(g, 2, 3, 3, 1, '#d4945a'); P(g, 9, 11, 4, 1, '#d4945a');
}
function paintTileF(g: G, _r: () => number, v: number) {
  P(g, 0, 0, 16, 16, '#d0dce4');
  dith(g, 0, 0, 8, 8, '#d0dce4', '#c4d2dc', v);
  dith(g, 8, 8, 8, 8, '#d0dce4', '#c4d2dc', v);
  P(g, 0, 0, 16, 1, '#b0c0cc'); P(g, 0, 8, 16, 1, '#b0c0cc');
  P(g, 0, 0, 1, 16, '#b0c0cc'); P(g, 8, 0, 1, 16, '#b0c0cc');
  P(g, 1, 1, 2, 1, '#e8f0f4'); P(g, 9, 9, 2, 1, '#e8f0f4');
}
function paintCarpet(g: G, v: number, base: string, dark: string, lite: string, mask: number) {
  P(g, 0, 0, 16, 16, base);
  dith4(g, 0, 0, 16, 16, dark, v);
  if (mask & 1) { P(g, 0, 0, 16, 2, lite); P(g, 0, 2, 16, 1, dark); }
  if (mask & 2) { P(g, 0, 14, 16, 2, lite); P(g, 0, 13, 16, 1, dark); }
  if (mask & 4) { P(g, 0, 0, 2, 16, lite); P(g, 2, 0, 1, 16, dark); }
  if (mask & 8) { P(g, 14, 0, 2, 16, lite); P(g, 13, 0, 1, 16, dark); }
}
function paintWall(g: G, v: number) {
  P(g, 0, 0, 16, 16, '#f0e4c8');
  dith4(g, 0, 6, 16, 6, '#e4d4b4', v);
  // แถบบนเป็นสีอิฐ ทำหน้าที่เป็นคิ้วของอาคาร ทำให้ห้องมีขอบชัดแทนที่จะจืดไปทั้งแผง
  P(g, 0, 0, 16, 5, '#c2564f'); P(g, 0, 0, 16, 1, '#d8706a'); P(g, 0, 4, 16, 1, '#8f3f3c');
  P(g, 0, 5, 16, 1, '#e8dcc0');
  P(g, 0, 12, 16, 1, '#a88c64'); P(g, 0, 13, 16, 3, '#8c6e4c'); P(g, 0, 15, 16, 1, '#6b5236');
}

/* ---------------- พื้นกลางแจ้ง ---------------- */
function paintGrass(g: G, r: () => number, v: number) {
  P(g, 0, 0, 16, 16, '#5cac4c');
  dith4(g, 0, 0, 16, 16, '#54a044', v);
  for (let i = 0; i < 3; i++) {
    const gx = (r() * 13) | 0, gy = (r() * 13) | 0;
    P(g, gx, gy + 1, 1, 2, '#3c8438'); P(g, gx + 2, gy + 1, 1, 2, '#3c8438');
    P(g, gx + 1, gy + 2, 1, 1, '#3c8438');
    P(g, gx, gy, 1, 1, '#7cc45c'); P(g, gx + 2, gy, 1, 1, '#7cc45c');
  }
  P(g, 0, 0, 16, 1, '#64b454');
}
function paintPath(g: G, r: () => number, v: number) {
  P(g, 0, 0, 16, 16, '#e0cc98');
  dith4(g, 0, 0, 16, 16, '#d4bc88', v);
  for (let i = 0; i < 5; i++) P(g, (r() * 15) | 0, (r() * 15) | 0, 2, 1, '#c8ac74');
  for (let i = 0; i < 3; i++) P(g, (r() * 15) | 0, (r() * 15) | 0, 1, 1, '#ecdcb0');
}
function paintSand(g: G, r: () => number, v: number) {
  P(g, 0, 0, 16, 16, '#e8d8a8');
  dith4(g, 0, 0, 16, 16, '#dccc98', v);
  for (let i = 0; i < 4; i++) P(g, (r() * 15) | 0, (r() * 15) | 0, 1, 1, '#c8b478');
}
function paintWater(g: G, frame: number, mask: number) {
  P(g, 0, 0, 16, 16, '#4880d0');
  dith(g, 0, 0, 16, 16, '#4880d0', '#4478c8', frame);
  for (let row = 0; row < 4; row++) {
    const y = 2 + row * 4;
    const off = (frame * 3 + row * 5) % 16;
    P(g, off, y, 3, 1, '#78aee8');
    P(g, (off + 8) % 16, y + 1, 2, 1, '#78aee8');
    P(g, (off + 5) % 16, y, 1, 1, '#a8d4f0');
  }
  if (mask & 1) P(g, 0, 0, 16, 2, '#a8d4f0');
  if (mask & 2) P(g, 0, 14, 16, 2, '#a8d4f0');
  if (mask & 4) P(g, 0, 0, 2, 16, '#a8d4f0');
  if (mask & 8) P(g, 14, 0, 2, 16, '#a8d4f0');
}

function edgeMask(code: string, x: number, y: number): number {
  const at = (px: number, py: number) =>
    px < 0 || py < 0 || px >= MW || py >= MH ? null : GROUND[py][px];
  return (at(x, y - 1) !== code ? 1 : 0) | (at(x, y + 1) !== code ? 2 : 0) |
    (at(x - 1, y) !== code ? 4 : 0) | (at(x + 1, y) !== code ? 8 : 0);
}

const tileCache = new Map<string, HTMLCanvasElement>();
export function tileSprite(code: string, x: number, y: number, frame: number): HTMLCanvasElement {
  const v = (x * 31 + y * 17) & 3;
  const mask = code === 'r' || code === 'l' || code === '~' ? edgeMask(code, x, y) : 0;
  const key = `${code}${v}_${mask}_${code === '~' ? frame : 0}`;
  const hit = tileCache.get(key);
  if (hit) return hit;

  const t = mk(16, 16);
  const r = rngFrom(1000 + v * 97 + code.charCodeAt(0) + mask * 13);
  if (code === 'w') paintWood(t.g, r, v);
  else if (code === 't') paintTileF(t.g, r, v);
  else if (code === 'r') paintCarpet(t.g, v, '#4c9c54', '#3e8848', '#68b46c', mask);
  else if (code === 'l') paintCarpet(t.g, v, '#c07058', '#a85c48', '#d88c70', mask);
  else if (code === 'g') paintGrass(t.g, r, v);
  else if (code === 'p') paintPath(t.g, r, v);
  else if (code === 's') paintSand(t.g, r, v);
  else if (code === '~') paintWater(t.g, frame, mask);
  else paintWall(t.g, v);

  tileCache.set(key, t.c);
  return t.c;
}

/* ============================================================
   วัตถุ
   ============================================================ */
function drawDesk(v: number): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 4, 2, 8, 7, '#2f3742'); P(g, 5, 3, 6, 5, '#59647a'); P(g, 5, 3, 6, 1, '#76839c');
  P(g, 7, 9, 2, 1, '#2f3742'); P(g, 5, 9, 6, 1, '#39424f');
  P(g, 0, 9, 16, 8, '#8a5a2a'); P(g, 0, 10, 16, 6, '#a9703a'); P(g, 0, 10, 16, 1, '#c48b4e');
  P(g, 0, 16, 16, 1, '#6b4520');
  if (v === 0) { P(g, 2, 13, 7, 2, '#dfe4ea'); P(g, 2, 13, 7, 1, '#f4f7fa'); }
  if (v === 1) { P(g, 11, 11, 3, 4, '#d9534f'); P(g, 14, 12, 1, 2, '#d9534f'); }
  if (v === 2) { P(g, 2, 12, 5, 4, '#f2efe4'); P(g, 3, 13, 3, 1, '#b9b3a2'); P(g, 3, 14, 3, 1, '#b9b3a2'); }
  P(g, 1, 17, 2, 4, '#6b4520'); P(g, 13, 17, 2, 4, '#6b4520');
  return { c: o.c, oy: 6 };
}
/** โต๊ะผู้บริหาร (โต๊ะของผู้ใช้) - ใหญ่กว่า มีป้ายชื่อ */
function drawBossDesk(v: number): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 0, 8, 16, 9, '#6b4520'); P(g, 0, 9, 16, 7, '#8f5f34'); P(g, 0, 9, 16, 1, '#b07c48');
  P(g, 0, 16, 16, 1, '#4e3116');
  if (v === 0) {
    P(g, 3, 1, 10, 8, '#2f3742'); P(g, 4, 2, 8, 6, '#3f6f8f'); P(g, 4, 2, 8, 1, '#5c93b0');
    P(g, 5, 3, 3, 1, '#8fd0e8'); P(g, 5, 5, 5, 1, '#8fd0e8');
    P(g, 6, 9, 4, 1, '#2f3742');
    P(g, 2, 12, 8, 3, '#e8eef4'); P(g, 2, 12, 8, 1, '#fbfdff');
  } else {
    P(g, 2, 11, 7, 4, '#f0e4c8'); P(g, 2, 11, 7, 1, '#fffbf0');
    P(g, 3, 12, 5, 1, '#8c6e4c'); P(g, 3, 13, 4, 1, '#8c6e4c');
    P(g, 11, 10, 4, 5, '#c85868'); P(g, 11, 10, 4, 1, '#e07888');
  }
  P(g, 1, 17, 2, 4, '#4e3116'); P(g, 13, 17, 2, 4, '#4e3116');
  return { c: o.c, oy: 6 };
}
function drawChair(back: boolean): Sprite {
  const o = mk(16, 19), g = o.g;
  const A = back ? '#8c5f6a' : '#5f7f8c';
  const D = back ? '#5e3d46' : '#3f5a66';
  P(g, 4, 0, 8, 7, D); P(g, 5, 1, 6, 5, A); P(g, 5, 1, 6, 1, shade(A, 1.2));
  P(g, 7, 7, 2, 1, D);
  P(g, 2, 8, 12, 4, D); P(g, 3, 8, 10, 3, shade(A, 1.05)); P(g, 3, 8, 10, 1, shade(A, 1.25));
  P(g, 2, 9, 1, 3, D); P(g, 13, 9, 1, 3, D);
  P(g, 7, 12, 2, 3, D); P(g, 4, 15, 3, 2, '#2f3742'); P(g, 9, 15, 3, 2, '#2f3742');
  return { c: o.c, oy: 3 };
}
function drawTable(o: MapObject): Sprite {
  const h = o.top ? 20 : 16;
  const cv = mk(16, h), g = cv.g, oy = h - 16, y0 = oy;
  P(g, 0, y0, 16, 16, '#a9703a'); P(g, 0, y0, 16, 1, '#bd8148');
  for (let i = 0; i < 3; i++) P(g, 2 + i * 5, y0 + 2, 1, 12, '#9c6631');
  if (o.top) { P(g, 0, 0, 16, 4, '#8a5a2a'); P(g, 0, 0, 16, 1, '#a9703a'); P(g, 0, 3, 16, 1, '#70441c'); }
  if (o.bot) { P(g, 0, y0 + 14, 16, 2, '#70441c'); P(g, 2, y0 + 15, 2, 1, '#5b3616'); }
  if (o.left) P(g, 0, y0, 1, 16, '#8a5a2a');
  if (o.right) P(g, 15, y0, 1, 16, '#8a5a2a');
  return { c: cv.c, oy };
}
function drawPlant(): Sprite {
  const o = mk(16, 26), g = o.g;
  P(g, 4, 17, 8, 8, '#8e4a2c'); P(g, 4, 17, 8, 2, '#b4603a'); P(g, 3, 16, 10, 2, '#c06a42');
  P(g, 5, 20, 2, 3, '#a15532');
  const L = '#3f8f4a', L2 = '#57b35c', D = '#2c6c36';
  P(g, 7, 2, 2, 16, D);
  ([[2, 6], [11, 6], [4, 3], [9, 2], [1, 11], [12, 11], [5, 9], [8, 9]] as const).forEach(([x, y], i) => {
    P(g, x, y, 4, 4, i % 2 ? L : L2); P(g, x, y + 4, 4, 1, D); P(g, x + 1, y - 1, 2, 1, i % 2 ? L2 : L);
  });
  P(g, 5, 5, 6, 6, L2); P(g, 6, 4, 4, 1, L);
  return { c: o.c, oy: 10 };
}
function drawCooler(): Sprite {
  const o = mk(16, 26), g = o.g;
  P(g, 4, 0, 8, 9, '#6fc4de'); P(g, 5, 1, 6, 7, '#9fe0f2'); P(g, 5, 3, 6, 5, '#5fb6d6');
  P(g, 6, 8, 4, 2, '#c9d4dc');
  P(g, 3, 10, 10, 14, '#b8c4cc'); P(g, 4, 10, 8, 13, '#e4edf3'); P(g, 4, 10, 8, 1, '#f7fbfd');
  P(g, 6, 14, 4, 2, '#7d8b96'); P(g, 7, 16, 2, 2, '#5f6c76'); P(g, 4, 22, 8, 2, '#8d99a3');
  return { c: o.c, oy: 10 };
}
function drawPrinter(): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 1, 4, 14, 16, '#98a4ae'); P(g, 2, 5, 12, 14, '#cdd8e0'); P(g, 2, 5, 12, 1, '#e8eff4');
  P(g, 3, 2, 10, 3, '#e9eef2'); P(g, 4, 1, 8, 1, '#fbfdff');
  P(g, 3, 9, 10, 3, '#5c6a75'); P(g, 3, 13, 10, 2, '#8d99a3'); P(g, 11, 6, 2, 2, '#5ad06a');
  P(g, 1, 20, 14, 2, '#6f7c86');
  return { c: o.c, oy: 6 };
}
function drawShelf(): Sprite {
  const o = mk(16, 26), g = o.g;
  P(g, 1, 0, 14, 24, '#7a4f26'); P(g, 2, 1, 12, 22, '#9a6634');
  const cols = ['#d9534f', '#4a7fd0', '#e0a13f', '#3fa06a', '#9a5fc0', '#e07aa8'];
  for (let row = 0; row < 3; row++) {
    P(g, 2, 1 + row * 8, 12, 1, '#7a4f26');
    for (let i = 0; i < 5; i++) {
      const bh = 4 + ((i + row) % 3);
      P(g, 3 + i * 2, 2 + row * 8 + (6 - bh), 2, bh, cols[(i + row * 2) % 6]);
    }
  }
  P(g, 1, 24, 14, 2, '#5e3c1c');
  return { c: o.c, oy: 10 };
}
/** โซฟา v=0 แดง, 1 เหลือง, 2 ฟ้า - ให้แต่ละมุมห้องมีชุดรับแขกคนละสี */
const SOFA_COLS: [string, string, string, string, string][] = [
  ['#8f3f3c', '#c2564f', '#d8706a', '#d96a5e', '#e88a7d'],
  ['#a8791c', '#e8bc48', '#f8dc84', '#f0c65c', '#fbe8a4'],
  ['#2f5c86', '#4a86bc', '#74aede', '#5c96cc', '#8cc2ec'],
];
function drawSofa(part: number, v = 0): Sprite {
  const o = mk(16, 22), g = o.g;
  const [D, M, HL, S, SHL] = SOFA_COLS[v % SOFA_COLS.length];

  // พนักพิง มุมบนตัดเฉียงหนึ่งพิกเซล ให้ดูเป็นเบาะนุ่มไม่ใช่กล่อง
  P(g, 0, 1, 16, 9, D); P(g, 1, 0, 14, 1, D);
  P(g, 1, 1, 14, 8, M); P(g, 1, 1, 14, 1, HL);
  // กระดุมยึดเบาะพนัก
  P(g, 4, 4, 1, 1, D); P(g, 8, 4, 1, 1, D); P(g, 12, 4, 1, 1, D);
  P(g, 0, 9, 16, 1, D);

  // เบาะนั่ง สองใบ มีร่องกลางกับขอบหน้าเป็นเส้นปิดริม
  P(g, 0, 10, 16, 8, D); P(g, 1, 10, 14, 6, S); P(g, 1, 10, 14, 1, SHL);
  P(g, 8, 11, 1, 5, D);
  P(g, 1, 16, 14, 1, HL); P(g, 0, 17, 16, 2, D);

  // ที่วางแขน เฉพาะชิ้นหัวกับท้าย ยกสูงกว่าเบาะและมีไฮไลต์ด้านบน
  if (part === 0) {
    P(g, 0, 3, 4, 15, D); P(g, 1, 4, 2, 13, M); P(g, 1, 4, 2, 1, HL);
    P(g, 3, 5, 1, 12, D);
  }
  if (part === 2) {
    P(g, 12, 3, 4, 15, D); P(g, 13, 4, 2, 13, M); P(g, 13, 4, 2, 1, HL);
    P(g, 12, 5, 1, 12, D);
  }

  P(g, 2, 19, 2, 3, '#5e3a24'); P(g, 12, 19, 2, 3, '#5e3a24');
  P(g, 2, 19, 2, 1, '#7d5232'); P(g, 12, 19, 2, 1, '#7d5232');
  return { c: o.c, oy: 6 };
}

/** กระถางเล็กตั้งพื้น ใช้แทรกตามมุมให้ห้องแน่นขึ้นโดยไม่กินที่เท่าปาล์ม */
function drawPot(v: number): Sprite {
  const o = mk(16, 20), g = o.g;
  P(g, 5, 13, 6, 6, '#a8562e'); P(g, 6, 14, 4, 4, '#c46a3c'); P(g, 6, 14, 4, 1, '#dc8450');
  P(g, 4, 11, 8, 3, '#c46a3c'); P(g, 4, 11, 8, 1, '#dc8450'); P(g, 5, 19, 6, 1, '#7e3f21');
  const L = v === 0 ? '#4ea058' : '#5cbc60';
  const D = v === 0 ? '#2c6c36' : '#38843e';
  ([[4, 7], [9, 7], [6, 4], [3, 9], [10, 9], [7, 9]] as const).forEach(([x, y], i) => {
    P(g, x, y, 3, 3, i % 2 ? L : D);
    P(g, x, y + 3, 3, 1, D);
  });
  P(g, 5, 6, 6, 5, L); P(g, 6, 5, 4, 1, L); P(g, 5, 11, 6, 1, D);
  return { c: o.c, oy: 6 };
}

/** ปาล์มกระถาง สูงกว่า plant เดิม ใบแผ่เป็นแฉกแทนที่จะเป็นพุ่ม */
function drawPalm(v: number): Sprite {
  const o = mk(16, 32), g = o.g;
  // กระถางดินเผา
  P(g, 3, 22, 10, 9, '#a8562e'); P(g, 4, 23, 8, 7, '#c46a3c'); P(g, 4, 23, 8, 1, '#dc8450');
  P(g, 2, 20, 12, 3, '#c46a3c'); P(g, 2, 20, 12, 1, '#dc8450'); P(g, 3, 30, 10, 1, '#7e3f21');
  P(g, 5, 21, 6, 1, '#5e3418');
  // ลำต้น
  P(g, 7, 10, 2, 11, '#7a5a2c'); P(g, 7, 10, 1, 11, '#96703a');
  const L = '#3f9c4c', L2 = '#5cbc60', D = '#28703a';
  // ใบแผ่ออกเป็นแฉก มุมต่างกันตาม v
  const fronds: [number, number, number, number][] = v === 0
    ? [[1, 6, 6, 3], [9, 6, 6, 3], [2, 2, 5, 3], [9, 2, 5, 3], [0, 10, 5, 2], [11, 10, 5, 2]]
    : [[0, 5, 7, 3], [9, 5, 7, 3], [3, 1, 4, 3], [9, 1, 4, 3], [1, 9, 5, 2], [10, 9, 5, 2]];
  fronds.forEach(([x, y, w, h], i) => {
    P(g, x, y, w, h, i % 2 ? L : L2);
    P(g, x, y + h, w, 1, D);
    P(g, x + (i % 2 ? 0 : w - 1), y - 1, 1, 1, D);
  });
  P(g, 5, 4, 6, 6, L2); P(g, 6, 3, 4, 1, L); P(g, 5, 10, 6, 1, D);
  return { c: o.c, oy: 16 };
}

/** ตู้กดน้ำ - ของสูงที่ช่วยเบรกผนังยาว ๆ ไม่ให้โล่ง */
function drawVending(): Sprite {
  const o = mk(16, 28), g = o.g;
  P(g, 1, 2, 14, 24, '#8f3f3c'); P(g, 2, 3, 12, 22, '#c2564f'); P(g, 2, 3, 12, 1, '#d8706a');
  // ตู้กระจกโชว์สินค้า
  P(g, 3, 5, 8, 14, '#2a3540'); P(g, 4, 6, 6, 12, '#6fa8d0'); P(g, 4, 6, 6, 2, '#a8d4f0');
  const cans = ['#e8d84c', '#4ac86c', '#e86c6c', '#6c9ce8'];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3; i++) {
      P(g, 4 + i * 2, 9 + row * 3, 2, 2, cans[(i + row) % 4]);
    }
  }
  P(g, 11, 6, 3, 5, '#3a4048'); P(g, 12, 7, 1, 1, '#5ad06a'); P(g, 12, 9, 1, 1, '#e8d84c');
  P(g, 11, 13, 3, 4, '#8d99a3'); P(g, 3, 20, 8, 3, '#3a4048'); P(g, 4, 21, 6, 1, '#6f7c86');
  P(g, 1, 26, 14, 2, '#5e2b28');
  return { c: o.c, oy: 12 };
}

/** โต๊ะโชว์แจกันดอกไม้ กลางพรมโซนพัก */
function drawVaseTable(): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 1, 8, 14, 6, '#8c6e4c'); P(g, 2, 9, 12, 4, '#c9ab7e'); P(g, 2, 9, 12, 1, '#e2c79c');
  P(g, 3, 14, 2, 7, '#6b5236'); P(g, 11, 14, 2, 7, '#6b5236');
  // แจกันแก้ว
  P(g, 6, 4, 4, 5, '#8fb8cc'); P(g, 7, 4, 2, 5, '#c4e0ec'); P(g, 6, 8, 4, 1, '#6d94a8');
  // ช่อดอก
  P(g, 5, 1, 2, 2, '#e05868'); P(g, 8, 0, 2, 2, '#f0a048'); P(g, 9, 2, 2, 2, '#e05868');
  P(g, 6, 3, 2, 1, '#3f8f4a'); P(g, 8, 3, 1, 2, '#3f8f4a');
  return { c: o.c, oy: 6 };
}
function drawCoffeeTable(): Sprite {
  const o = mk(16, 18), g = o.g;
  P(g, 1, 2, 14, 8, '#8a5a2a'); P(g, 2, 3, 12, 6, '#c08a52'); P(g, 2, 3, 12, 1, '#d8a672');
  P(g, 6, 4, 4, 3, '#eae3d2');
  P(g, 2, 10, 2, 6, '#6b4520'); P(g, 12, 10, 2, 6, '#6b4520');
  return { c: o.c, oy: 2 };
}
/** เคาน์เตอร์แพนทรี่ - เครื่องชงกาแฟ + จาน */
function drawCounter(): Sprite {
  const o = mk(16, 24), g = o.g;
  P(g, 0, 8, 16, 14, '#8c6e4c'); P(g, 0, 9, 16, 11, '#c9ab7e'); P(g, 0, 9, 16, 1, '#e2c79c');
  P(g, 0, 20, 16, 2, '#6b5236');
  P(g, 2, 1, 6, 8, '#3a4048'); P(g, 3, 2, 4, 5, '#5c6670'); P(g, 3, 2, 4, 1, '#78848f');
  P(g, 4, 7, 2, 2, '#8a5a2a'); P(g, 3, 8, 4, 1, '#2a2f36');
  P(g, 10, 4, 5, 5, '#e8eef4'); P(g, 10, 4, 5, 1, '#fbfdff'); P(g, 11, 6, 3, 1, '#c85868');
  return { c: o.c, oy: 8 };
}

/* ---------------- ของกลางแจ้ง ---------------- */
function drawPine(v: number): Sprite {
  const W = 24, H = 34;
  const o = mk(W, H), g = o.g;
  const D = '#1c5434', M = '#2e7a44', L = '#4ea058', HL = '#78c46c';
  P(g, 10, 25, 4, 8, '#7a5230'); P(g, 10, 25, 2, 8, '#5a3a20'); P(g, 9, 32, 6, 1, '#4a2e18');
  const tier = (y0: number, rows: number, w0: number, w1: number) => {
    for (let i = 0; i < rows; i++) {
      const w = Math.round(w0 + ((w1 - w0) * i) / (rows - 1));
      const x = 12 - ((w / 2) | 0);
      P(g, x, y0 + i, w, 1, M);
      P(g, x, y0 + i, 1, 1, D); P(g, x + w - 1, y0 + i, 1, 1, D);
      if (i < rows - 2 && w > 4) dith4(g, x + 1, y0 + i, w - 2, 1, L, i + v);
    }
    P(g, 12 - ((w1 / 2) | 0), y0 + rows - 1, w1, 2, D);
  };
  tier(0, 9, 2, 11); tier(7, 10, 5, 17); tier(15, 11, 9, 23);
  P(g, 11, 1, 2, 3, HL); P(g, 8, 9, 2, 1, HL); P(g, 5, 18, 2, 1, HL);
  return { c: o.c, oy: H - 16, ox: (W - 16) / 2 };
}
function drawBush(): Sprite {
  const o = mk(16, 18), g = o.g;
  const D = '#2e6c34', M = '#48944a', L = '#68b45e';
  P(g, 2, 4, 12, 12, D); P(g, 1, 6, 14, 8, D);
  P(g, 3, 5, 10, 10, M); P(g, 2, 7, 12, 6, M);
  dith4(g, 3, 5, 10, 7, L, 0);
  P(g, 5, 5, 4, 1, L); P(g, 3, 7, 2, 1, L); P(g, 3, 15, 10, 1, '#24582c');
  return { c: o.c, oy: 2 };
}
function drawRock(): Sprite {
  const o = mk(16, 16), g = o.g;
  const D = '#6c6458', M = '#98907c', L = '#b8b09c';
  P(g, 3, 6, 10, 8, D); P(g, 4, 5, 8, 10, D);
  P(g, 4, 6, 8, 7, M); P(g, 5, 5, 6, 9, M);
  dith4(g, 4, 6, 8, 5, L, 0); P(g, 6, 6, 3, 1, L); P(g, 4, 14, 8, 1, '#4e4840');
  return { c: o.c, oy: 0 };
}
function drawFlower(v: number): Sprite {
  const o = mk(16, 16), g = o.g;
  const cols: [string, string][] = [['#e85860', '#f8a0a4'], ['#f0d048', '#f8eca0'], ['#f0f0f8', '#c8c8e0']];
  const [c1, c2] = cols[v % 3];
  const put = (x: number, y: number) => {
    P(g, x + 1, y, 2, 1, c1); P(g, x, y + 1, 4, 2, c1); P(g, x + 1, y + 3, 2, 1, c1);
    P(g, x + 1, y + 1, 2, 1, c2);
    P(g, x + 1, y + 4, 1, 2, '#3c8438'); P(g, x + 2, y + 5, 1, 1, '#3c8438');
  };
  put(1, 2); put(8, 1); put(4, 8); put(10, 7);
  return { c: o.c, oy: 0 };
}
function drawBench(): Sprite {
  const o = mk(16, 20), g = o.g;
  const D = '#7a5230', M = '#b08048', L = '#d0a068';
  P(g, 1, 0, 14, 6, D); P(g, 2, 1, 12, 4, M); P(g, 2, 1, 12, 1, L); P(g, 2, 3, 12, 1, D);
  P(g, 0, 7, 16, 5, D); P(g, 1, 8, 14, 3, M); P(g, 1, 8, 14, 1, L);
  P(g, 2, 12, 2, 5, D); P(g, 12, 12, 2, 5, D); P(g, 1, 6, 2, 2, D); P(g, 13, 6, 2, 2, D);
  return { c: o.c, oy: 4 };
}
function drawSign(): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 7, 12, 3, 8, '#5a3a20');
  P(g, 2, 2, 12, 10, '#5a3a20'); P(g, 3, 3, 10, 8, '#b08048'); P(g, 3, 3, 10, 1, '#d0a068');
  P(g, 5, 5, 6, 1, '#5a3a20'); P(g, 5, 7, 7, 1, '#5a3a20'); P(g, 5, 9, 4, 1, '#5a3a20');
  P(g, 4, 20, 8, 1, '#3c8438');
  return { c: o.c, oy: 6 };
}
function drawLamp(): Sprite {
  const o = mk(16, 30), g = o.g;
  P(g, 7, 8, 2, 19, '#4a5058'); P(g, 7, 8, 1, 19, '#68707a'); P(g, 5, 26, 6, 2, '#3a4048');
  P(g, 5, 2, 6, 7, '#3a4048'); P(g, 6, 3, 4, 5, '#f8ecb0'); P(g, 6, 3, 4, 2, '#fffce0');
  P(g, 4, 1, 8, 2, '#3a4048'); P(g, 6, 0, 4, 1, '#4a5058');
  return { c: o.c, oy: 14 };
}

const objCache = new Map<string, Sprite>();
export function objSprite(o: MapObject): Sprite {
  const key = `${o.type}|${o.v ?? 0}${o.part ?? 0}${o.top ? 'T' : ''}${o.bot ? 'B' : ''}` +
    `${o.left ? 'L' : ''}${o.right ? 'R' : ''}${o.back ? 'K' : ''}`;
  const hit = objCache.get(key);
  if (hit) return hit;

  let s: Sprite;
  switch (o.type) {
    case 'desk': s = drawDesk(o.v ?? 0); break;
    case 'bossdesk': s = drawBossDesk(o.v ?? 0); break;
    case 'chair': s = drawChair(!!o.back); break;
    case 'table': s = drawTable(o); break;
    case 'plant': s = drawPlant(); break;
    case 'cooler': s = drawCooler(); break;
    case 'printer': s = drawPrinter(); break;
    case 'shelf': s = drawShelf(); break;
    case 'sofa': s = drawSofa(o.part ?? 0, o.v ?? 0); break;
    case 'sofa2': s = drawSofa(o.part ?? 0, o.v ?? 2); break;
    case 'palm': s = drawPalm(o.v ?? 0); break;
    case 'pot': s = drawPot(o.v ?? 0); break;
    case 'vending': s = drawVending(); break;
    case 'vasetable': s = drawVaseTable(); break;
    case 'ctable': s = drawCoffeeTable(); break;
    case 'counter': s = drawCounter(); break;
    case 'pine': s = drawPine(o.v ?? 0); break;
    case 'bush': s = drawBush(); break;
    case 'rock': s = drawRock(); break;
    case 'flower': s = drawFlower(o.v ?? 0); break;
    case 'bench': s = drawBench(); break;
    case 'sign': s = drawSign(); break;
    case 'lamp': s = drawLamp(); break;
    default: s = { c: mk(16, 16).c, oy: 0 };
  }
  objCache.set(key, s);
  return s;
}

/* ---------------- ของตกแต่งบนผนัง ---------------- */
const decorCache = new Map<string, HTMLCanvasElement>();
export function decorSprite(type: string): HTMLCanvasElement {
  const hit = decorCache.get(type);
  if (hit) return hit;
  const o = mk(16, 16), g = o.g;
  if (type === 'board') {
    P(g, 0, 5, 16, 10, '#9aa3ad'); P(g, 0, 6, 16, 8, '#f6f7f2'); P(g, 0, 6, 16, 1, '#ffffff');
    P(g, 2, 8, 7, 1, '#4a7fd0'); P(g, 2, 10, 10, 1, '#4a7fd0'); P(g, 2, 12, 5, 1, '#d9534f');
    P(g, 11, 11, 3, 3, '#3fa06a'); P(g, 0, 14, 16, 1, '#6f7982');
  } else if (type === 'window') {
    P(g, 1, 4, 14, 10, '#6b4a2c'); P(g, 2, 5, 12, 8, '#8fd0ea');
    P(g, 2, 5, 12, 3, '#a9dff2'); P(g, 7, 5, 1, 8, '#6b4a2c'); P(g, 2, 9, 12, 1, '#6b4a2c');
    P(g, 3, 6, 2, 2, '#d8f2fb');
  } else if (type === 'clock') {
    P(g, 5, 5, 6, 6, '#3a3f4b'); P(g, 6, 6, 4, 4, '#f4f6f8');
    P(g, 8, 7, 1, 2, '#3a3f4b'); P(g, 8, 8, 2, 1, '#d9534f');
  } else if (type === 'frame0' || type === 'frame1') {
    // รูปแขวนผนัง สองแบบ - แบบ 0 เป็นวิว แบบ 1 เป็นกราฟ
    P(g, 2, 3, 12, 11, '#6b4520'); P(g, 3, 4, 10, 9, '#8a5a2a');
    P(g, 4, 5, 8, 7, type === 'frame0' ? '#a8d4f0' : '#f6f2e4');
    if (type === 'frame0') {
      P(g, 4, 9, 8, 3, '#5cac4c'); P(g, 4, 9, 8, 1, '#78c45c');
      P(g, 6, 6, 3, 3, '#f0e08c'); P(g, 9, 7, 2, 2, '#e8f4ff');
    } else {
      P(g, 5, 10, 2, 2, '#4a7fd0'); P(g, 7, 8, 2, 4, '#3fa06a'); P(g, 9, 6, 2, 6, '#e0a13f');
      P(g, 4, 12, 8, 1, '#b0a48c');
    }
    P(g, 2, 13, 12, 1, '#4e3116');
  } else if (type === 'screen') {
    // จอใหญ่ติดผนัง สำหรับขึ้นตัวเลขบริษัท
    P(g, 0, 2, 16, 12, '#2a3540'); P(g, 1, 3, 14, 9, '#3f7fb0');
    P(g, 1, 3, 14, 3, '#5ca4d4'); P(g, 2, 4, 4, 1, '#a8d4f0');
    P(g, 2, 7, 6, 1, '#cfe8fa'); P(g, 2, 9, 9, 1, '#cfe8fa'); P(g, 9, 7, 4, 1, '#a8d4f0');
    P(g, 0, 12, 16, 2, '#1d2831'); P(g, 6, 14, 4, 1, '#3a4048');
  } else if (type === 'hangplant') {
    // กระถางแขวน ใบห้อยลงมา ช่วยให้ผนังไม่แบน
    P(g, 7, 0, 1, 3, '#6b5236'); P(g, 4, 3, 8, 4, '#a8562e');
    P(g, 5, 4, 6, 2, '#c46a3c'); P(g, 4, 3, 8, 1, '#dc8450');
    const L = '#3f9c4c', L2 = '#5cbc60', D = '#28703a';
    ([[3, 6, 3], [6, 7, 5], [9, 6, 4], [11, 7, 3], [5, 8, 2]] as const)
      .forEach(([x, y, len], i) => {
        P(g, x, y, 2, len, i % 2 ? L : L2);
        P(g, x, y + len, 2, 1, D);
      });
    P(g, 5, 6, 6, 2, L2); P(g, 5, 6, 6, 1, L);
  }
  decorCache.set(type, o.c);
  return o.c;
}

/* ---------------- ลวดลายบนพื้น ----------------
   วาดทับ tile หลังปูพื้นเสร็จ ก่อนวางของ
   แยกเป็น layer ของตัวเองเพราะกินหลายช่อง ทำเป็น tile ไม่ได้ */
const decalCache = new Map<string, HTMLCanvasElement>();

export interface FloorDecal {
  type: 'rug' | 'emblem' | 'mat';
  x: number; y: number; w: number; h: number;
  color?: string;
}

/** พรมสี่เหลี่ยม
   ถ้าเทสีเรียบ ๆ แล้วตีกรอบ มันจะอ่านเป็นสระน้ำ ไม่ใช่ผ้า
   เลยต้องมีลายทอสลับฟันหนู ขอบสามชั้น และชายครุยที่หัวท้าย */
function paintRug(g: G, w: number, h: number, color: string) {
  const dark = shade(color, 0.74);
  const mid = shade(color, 0.88);
  const lite = shade(color, 1.18);

  P(g, 0, 0, w, h, color);
  // ลายทอ: เส้นแนวนอนถี่ ๆ สลับกับจุดประ ให้ผิวไม่เรียบ
  for (let y = 0; y < h; y += 2) P(g, 0, y, w, 1, mid);
  for (let y = 1; y < h; y += 4) {
    for (let x = (y % 8 === 1 ? 0 : 2); x < w; x += 4) P(g, x, y, 2, 1, lite);
  }

  // ขอบสามชั้น เข้ม/สว่าง/เข้ม ทำให้ขอบพรมดูหนาเป็นผ้าทบ
  P(g, 0, 0, w, 1, dark); P(g, 0, h - 1, w, 1, dark);
  P(g, 0, 0, 1, h, dark); P(g, w - 1, 0, 1, h, dark);
  P(g, 1, 1, w - 2, 2, lite); P(g, 1, h - 3, w - 2, 2, lite);
  P(g, 1, 1, 2, h - 2, lite); P(g, w - 3, 1, 2, h - 2, lite);
  P(g, 3, 3, w - 6, 1, dark); P(g, 3, h - 4, w - 6, 1, dark);
  P(g, 3, 3, 1, h - 6, dark); P(g, w - 4, 3, 1, h - 6, dark);

  // ชายครุย
  for (let x = 2; x < w - 2; x += 3) {
    P(g, x, 0, 1, 1, lite);
    P(g, x, h - 1, 1, 1, lite);
  }
}

/** วงรีตัน วาดทีละแถวแบบพิกเซล ไม่ใช้ arc เพราะ arc จะได้ขอบเบลอ */
function fillEllipse(g: G, cx: number, cy: number, rx: number, ry: number, color: string) {
  g.fillStyle = color;
  for (let y = 0; y < cy * 2 + ry; y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.round(cx - half);
    const wpx = Math.round(cx + half) - x0;
    if (wpx > 0) g.fillRect(x0, y, wpx, 1);
  }
}

/** ตราบริษัทฝังพื้นล็อบบี้
   วงแหวนซ้อนกันโดยวาดวงรีตันทับกันจากนอกเข้าใน สลับเข้ม/สว่าง
   ทำให้เห็นเป็นเส้นวงแหวนโดยไม่ต้องคำนวณขอบวง */
function paintEmblem(g: G, w: number, h: number) {
  const cx = w / 2, cy = h / 2;
  const rx = w / 2 - 2, ry = h / 2 - 2;
  // สีต้องต่างจากพื้นกระเบื้อง (#d0dce4) พอให้อ่านออก แต่ไม่ถึงกับเด้งออกมาลอย
  const rings: [number, string][] = [
    [1.0, '#9fb6c8'], [0.94, '#eaf2f7'], [0.66, '#9fb6c8'], [0.58, '#dce8f0'],
    [0.24, '#8aa4ba'], [0.16, '#eaf2f7'],
  ];
  for (const [k, col] of rings) fillEllipse(g, cx, cy, rx * k, ry * k, col);
  // แถบแนวนอนบาง ๆ พาดกลาง ทำให้อ่านออกว่าเป็นตรา ไม่ใช่แค่วงกลมซ้อน
  P(g, Math.round(cx - rx), Math.round(cy) - 1, Math.round(rx * 2), 2, '#8aa4ba');
}

export function decalSprite(d: FloorDecal): HTMLCanvasElement {
  const w = d.w * 16, h = d.h * 16;
  const key = `${d.type}|${w}x${h}|${d.color ?? ''}`;
  const hit = decalCache.get(key);
  if (hit) return hit;

  const o = mk(w, h), g = o.g;
  if (d.type === 'rug') {
    paintRug(g, w, h, d.color ?? '#7fb4d8');
  } else if (d.type === 'emblem') {
    paintEmblem(g, w, h);
  } else {
    // พรมเช็ดเท้าหน้าประตู
    P(g, 0, 0, w, h, '#8f3f3c'); P(g, 1, 1, w - 2, h - 2, '#c2564f');
    P(g, 1, 1, w - 2, 1, '#d8706a');
    for (let x = 3; x < w - 3; x += 3) P(g, x, 3, 1, h - 6, '#a54a45');
  }
  decalCache.set(key, o.c);
  return o.c;
}

/* ---------------- ฟองคำพูด ---------------- */
export function drawBubble(g: G, x: number, y: number, icon: string) {
  P(g, x, y, 12, 9, '#2a2333'); P(g, x + 1, y + 1, 10, 7, '#fbfdff');
  P(g, x + 4, y + 9, 3, 1, '#2a2333'); P(g, x + 4, y + 8, 3, 1, '#fbfdff');
  P(g, x + 5, y + 10, 1, 1, '#2a2333');
  const cx = x + 2, cy = y + 2;
  if (icon === 'talk') {
    P(g, cx, cy + 2, 2, 2, '#4a7fd0'); P(g, cx + 3, cy + 2, 2, 2, '#4a7fd0'); P(g, cx + 6, cy + 2, 2, 2, '#4a7fd0');
  } else if (icon === 'type') {
    P(g, cx, cy + 3, 8, 2, '#5c6a7d'); P(g, cx, cy + 3, 8, 1, '#9aa8b8'); P(g, cx + 2, cy + 1, 4, 1, '#5c6a7d');
  } else if (icon === 'coffee') {
    P(g, cx + 1, cy + 1, 5, 4, '#8a5a2a'); P(g, cx + 1, cy + 1, 5, 1, '#c08a52');
    P(g, cx + 6, cy + 2, 1, 2, '#8a5a2a'); P(g, cx + 2, cy - 1, 1, 2, '#c9d4dc');
  } else if (icon === 'idea') {
    P(g, cx + 2, cy, 3, 3, '#ffd166'); P(g, cx + 3, cy + 3, 1, 2, '#b98c2a'); P(g, cx + 1, cy + 1, 1, 1, '#ffe9a8');
  } else if (icon === 'board') {
    P(g, cx, cy, 8, 5, '#9aa3ad'); P(g, cx + 1, cy + 1, 6, 3, '#f6f7f2'); P(g, cx + 2, cy + 2, 4, 1, '#4a7fd0');
  } else if (icon === 'music') {
    P(g, cx + 4, cy, 1, 4, '#7a3f7a'); P(g, cx + 2, cy + 3, 3, 2, '#7a3f7a'); P(g, cx + 4, cy, 3, 1, '#7a3f7a');
  } else if (icon === 'food') {
    P(g, cx + 1, cy + 2, 6, 3, '#e8d8a8'); P(g, cx + 1, cy + 2, 6, 1, '#f8f0d0');
    P(g, cx + 2, cy, 1, 2, '#8d99a3'); P(g, cx + 4, cy, 1, 2, '#8d99a3');
  } else if (icon === 'question') {
    P(g, cx + 2, cy, 4, 1, '#c85868'); P(g, cx + 5, cy + 1, 1, 2, '#c85868');
    P(g, cx + 3, cy + 2, 2, 1, '#c85868'); P(g, cx + 3, cy + 3, 1, 1, '#c85868');
    P(g, cx + 3, cy + 5, 1, 1, '#c85868');
  }
}
