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
/**
 * ผนังกระจกกั้นห้องบอส - มองทะลุเห็นพื้นข้างหลัง (วาดพื้นกระเบื้องก่อนแล้วทับด้วยกรอบ+กระจก)
 * เดินผ่านไม่ได้ (WALKABLE กันไว้) แต่ต้องดูโปร่งไม่งั้นห้องบอสจะเป็นกล่องทึบ
 */
function paintGlass(g: G, v: number) {
  P(g, 0, 0, 16, 16, '#d0dce4');
  dith(g, 0, 0, 8, 8, '#d0dce4', '#c4d2dc', v);
  P(g, 0, 4, 16, 10, '#a8d0e8'); dith4(g, 0, 5, 16, 8, '#c4e4f4', v);
  P(g, 2, 6, 3, 1, '#ecf8ff'); P(g, 9, 9, 4, 1, '#ecf8ff');
  P(g, 0, 3, 16, 1, '#5c6a78'); P(g, 0, 14, 16, 2, '#5c6a78'); P(g, 0, 15, 16, 1, '#3a4048');
  P(g, 7, 3, 2, 13, '#5c6a78');
}
/**
 * ผนัง - แยกตามทิศที่มองเห็น
 *   face  = ผนังแนวนอนที่มีพื้นอยู่ข้างล่าง (เห็น "หน้าผนัง": คิ้วอิฐบน ผนังครีม บัวไม้ล่าง)
 *   side  = ผนังแนวตั้ง / มุม / ผนังที่ไม่มีพื้นข้างล่าง - เห็นแค่ "สันผนัง" จากด้านบน
 *           วาดเป็นแท่งทึบสีอิฐมีขอบเข้ม ไม่ใช่เอาหน้าผนังแนวนอนมาซ้อนกันเป็นชั้น ๆ
 * capBelow = ผนังแนวตั้งที่มีผนัง face อยู่ข้างล่าง (มุมบนของห้อง) - ให้เชื่อมกันเป็นเนื้อเดียว
 */
/**
 * ผนังบาง - ผนังกินช่องเต็ม 16px ทำให้ห้องเล็กดูทึบ จึงวาดให้ตัวผนังจริงหนาแค่ 6px
 * ที่เหลือของช่องปล่อยให้เห็นพื้นข้างเคียง (อ่านจาก GROUND ทั้งสองฝั่ง)
 * การเดินยังบล็อกทั้งช่องเหมือนเดิม - นี่คือเรื่องภาพอย่างเดียว
 */
const WALL_T = 6; // ความหนาผนังจริง (px)
const WALL_X0 = (16 - WALL_T) / 2; // 5

function paintNeighborFloor(g: G, code: string | null, x: number, y: number, w: number, h: number) {
  // พื้นข้างผนัง - วาดเป็นสีเรียบของ tile นั้น (ไม่ต้องละเอียด เพราะโดนผนังบังไปครึ่งหนึ่ง)
  const c = code === 'w' ? '#e0a868' : code === 't' ? '#d0dce4' : code === 'r' ? '#4c9c54'
    : code === 'l' ? '#c07058' : code === 'b' ? '#3c5878' : code === 'g' ? '#5cac4c'
    : code === 'p' ? '#e0cc98' : code === 's' ? '#e8d8a8' : code === 'L' ? '#7a5c98'
    : code === 'F' ? '#4a8a5c' : code === 'E' ? '#4a6a98' : code === 'P' ? '#b08a48'
    : code === 'M' ? '#b06a8a' : code === 'G' ? '#a8d0e8' : null;
  if (c) P(g, x, y, w, h, c);
}

function paintWall(g: G, v: number, kind: 'face' | 'side', mask: number, tx: number, ty: number) {
  const at = (px: number, py: number) =>
    px < 0 || py < 0 || px >= MW || py >= MH ? null : GROUND[py][px];
  const L = at(tx - 1, ty), R = at(tx + 1, ty), U = at(tx, ty - 1), D = at(tx, ty + 1);
  const isWall = (c: string | null) => c === null || c === '#';

  if (kind === 'face') {
    // หน้าผนังแนวนอน: ผนังจริงอยู่ครึ่งล่างของช่อง (สูง 9px) เห็นพื้นข้างบนโผล่มาแถบหนึ่ง
    // ถ้าข้างบนเป็นผนังด้วย (ผนังหนาสองชั้น เช่นริมแมพ) ค่อยเทเต็ม
    if (isWall(U)) P(g, 0, 0, 16, 16, '#c2564f'); else paintNeighborFloor(g, U, 0, 0, 16, 7);
    P(g, 0, 7, 16, 9, '#f0e4c8');
    dith4(g, 0, 10, 16, 3, '#e4d4b4', v);
    P(g, 0, 7, 16, 3, '#c2564f'); P(g, 0, 7, 16, 1, '#d8706a'); P(g, 0, 9, 16, 1, '#8f3f3c');
    P(g, 0, 13, 16, 1, '#a88c64'); P(g, 0, 14, 16, 2, '#8c6e4c'); P(g, 0, 15, 16, 1, '#6b5236');
    // ผนังแนวตั้งที่ชนเข้ามาจากซ้าย/ขวา - ต่อสันให้ถึงกัน
    if (isWall(L)) P(g, 0, 7, WALL_X0, 9, '#c2564f');
    if (isWall(R)) P(g, 16 - WALL_X0, 7, WALL_X0, 9, '#c2564f');
    return;
  }

  // สันผนังแนวตั้ง: พื้นสองข้าง + แท่งอิฐบางตรงกลาง
  paintNeighborFloor(g, L, 0, 0, WALL_X0, 16);
  paintNeighborFloor(g, R, 16 - WALL_X0, 0, WALL_X0, 16);
  P(g, WALL_X0, 0, WALL_T, 16, '#c2564f');
  dith4(g, WALL_X0 + 1, 0, WALL_T - 2, 16, '#b84e48', v);
  P(g, WALL_X0, 0, 1, 16, '#d8706a'); P(g, WALL_X0 + WALL_T - 1, 0, 1, 16, '#8f3f3c');
  // ต่อเนื่องกับผนังบน/ล่าง - ถ้าปลายผนังให้ปิดหัว
  if (mask & 1) P(g, WALL_X0, 0, WALL_T, 2, '#d8706a');
  if (mask & 2) P(g, WALL_X0, 14, WALL_T, 2, '#8f3f3c');
  // มุมที่มีผนังแนวนอนชนเข้ามาจากซ้าย/ขวา - ต่อแท่งออกไปให้ถึงขอบช่อง
  if (isWall(L)) P(g, 0, WALL_X0, WALL_X0, WALL_T, '#c2564f');
  if (isWall(R)) P(g, 16 - WALL_X0, WALL_X0, WALL_X0, WALL_T, '#c2564f');
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
  // นอกแมพถือว่าเป็นผนัง - ผนังริมแมพจะได้ไม่มี "หัวปิด" โผล่ทุกช่อง
  const at = (px: number, py: number) =>
    px < 0 || py < 0 || px >= MW || py >= MH ? (code === '#' ? '#' : null) : GROUND[py][px];
  return (at(x, y - 1) !== code ? 1 : 0) | (at(x, y + 1) !== code ? 2 : 0) |
    (at(x - 1, y) !== code ? 4 : 0) | (at(x + 1, y) !== code ? 8 : 0);
}

const tileCache = new Map<string, HTMLCanvasElement>();
export function tileSprite(code: string, x: number, y: number, frame: number): HTMLCanvasElement {
  const v = (x * 31 + y * 17) & 3;
  let mask = 'rlb~LFEPM'.includes(code) ? edgeMask(code, x, y) : 0;
  // ผนัง: มีพื้นเดินได้อยู่ข้างล่าง = เห็นหน้าผนัง ไม่งั้นเป็นสันผนัง (แนวตั้ง/มุม)
  let wallKind: 'face' | 'side' = 'face';
  if (code === '#') {
    const below = y + 1 < MH ? GROUND[y + 1][x] : '#';
    wallKind = below !== '#' && below !== 'G' ? 'face' : 'side';
    if (wallKind === 'side') mask = edgeMask('#', x, y);
  }
  const nb = code === '#'
    ? [GROUND[y - 1]?.[x], GROUND[y + 1]?.[x], GROUND[y]?.[x - 1], GROUND[y]?.[x + 1]].map((c) => c ?? '#').join('')
    : '';
  const key = `${code}${v}_${mask}_${code === '~' ? frame : 0}_${code === '#' ? wallKind + nb : ''}`;
  const hit = tileCache.get(key);
  if (hit) return hit;

  const t = mk(16, 16);
  const r = rngFrom(1000 + v * 97 + code.charCodeAt(0) + mask * 13);
  if (code === 'w') paintWood(t.g, r, v);
  else if (code === 't') paintTileF(t.g, r, v);
  else if (code === 'r') paintCarpet(t.g, v, '#4c9c54', '#3e8848', '#68b46c', mask);
  else if (code === 'l') paintCarpet(t.g, v, '#c07058', '#a85c48', '#d88c70', mask);
  // พรมห้องบอสสีน้ำเงินเข้ม ต่างจากพรมประชุมสีเขียว ให้รู้ทันทีว่าคนละห้อง
  else if (code === 'b') paintCarpet(t.g, v, '#3c5878', '#304a66', '#5878a0', mask);
  else if (code === 'G') paintGlass(t.g, v);
  // พื้นห้องแผนก - พรมโทนสีประจำแผนก (L กฎหมาย F การเงิน E วิศวกรรม P บุคคล M การตลาด)
  else if (code === 'L') paintCarpet(t.g, v, '#7a5c98', '#66497f', '#9478b4', mask);
  else if (code === 'F') paintCarpet(t.g, v, '#4a8a5c', '#3c744c', '#62a474', mask);
  else if (code === 'E') paintCarpet(t.g, v, '#4a6a98', '#3c5880', '#6284b4', mask);
  else if (code === 'P') paintCarpet(t.g, v, '#b08a48', '#96743a', '#c8a460', mask);
  else if (code === 'M') paintCarpet(t.g, v, '#b06a8a', '#965874', '#c884a4', mask);
  else if (code === 'g') paintGrass(t.g, r, v);
  else if (code === 'p') paintPath(t.g, r, v);
  else if (code === 's') paintSand(t.g, r, v);
  else if (code === '~') paintWater(t.g, frame, mask);
  else paintWall(t.g, v, wallKind, mask, x, y);

  tileCache.set(key, t.c);
  return t.c;
}

/* ============================================================
   วัตถุ
   ============================================================ */
/**
 * โต๊ะทำงาน - คนนั่งอยู่ช่องบน (หันหน้าลง) โต๊ะอยู่ช่องนี้
 * จอคอมจึงต้อง "หันขึ้น" หาคนนั่ง = เราเห็นด้านหลังจอ (ฝาทึบ + ขาตั้ง)
 * ผังเก่าวาดหน้าจอโชว์มาทางกล้อง แปลว่าคนนั่งอยู่หลังจอ นั่งใช้งานผิดทาง
 */
function drawDesk(v: number): Sprite {
  const o = mk(16, 22), g = o.g;
  // หลังจอ: ฝาทึบสีเข้ม มีโลโก้เล็ก ๆ ตรงกลาง กับขาตั้ง
  P(g, 4, 1, 8, 7, '#2a3038'); P(g, 5, 2, 6, 5, '#3a424c'); P(g, 5, 2, 6, 1, '#4a545e');
  P(g, 7, 4, 2, 2, '#5c6a78');
  P(g, 7, 8, 2, 2, '#2a3038'); P(g, 5, 9, 6, 1, '#39424f');
  // ตัวโต๊ะ
  P(g, 0, 10, 16, 7, '#8a5a2a'); P(g, 0, 11, 16, 5, '#a9703a'); P(g, 0, 11, 16, 1, '#c48b4e');
  P(g, 0, 16, 16, 1, '#6b4520');
  // คีย์บอร์ดอยู่ฝั่งคนนั่ง (ด้านบนของโต๊ะ ใกล้จอ) เมาส์ข้าง ๆ
  P(g, 4, 12, 8, 2, '#dfe4ea'); P(g, 4, 12, 8, 1, '#f4f7fa'); P(g, 5, 13, 6, 1, '#b8c0c8');
  P(g, 13, 12, 2, 2, '#e8ecf0');
  // ของประจำโต๊ะต่างกันเล็กน้อยให้ไม่ซ้ำ
  if (v === 1) { P(g, 1, 12, 2, 3, '#d9534f'); P(g, 1, 12, 2, 1, '#e87070'); }
  if (v === 2) { P(g, 1, 12, 2, 3, '#f2efe4'); P(g, 1, 13, 2, 1, '#b9b3a2'); }
  P(g, 1, 17, 2, 4, '#6b4520'); P(g, 13, 17, 2, 4, '#6b4520');
  return { c: o.c, oy: 6 };
}
/**
 * โต๊ะผู้บริหาร 3 ชิ้น (v=0 ซ้าย 1 กลาง 2 ขวา) - บอสนั่งหลังโต๊ะหันลง
 * จอตั้งชิ้นกลางหันขึ้นหาบอสเช่นกัน แขกที่มารายงานเห็นหลังจอ
 */
function drawBossDesk(v: number): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 0, 8, 16, 9, '#5a3818'); P(g, 0, 9, 16, 7, '#8f5f34'); P(g, 0, 9, 16, 1, '#b07c48');
  P(g, 0, 16, 16, 1, '#4e3116');
  if (v === 0) {
    // แฟ้มเอกสารกับปากกา
    P(g, 3, 11, 8, 4, '#f0e4c8'); P(g, 3, 11, 8, 1, '#fffbf0');
    P(g, 4, 12, 6, 1, '#8c6e4c'); P(g, 4, 13, 4, 1, '#8c6e4c');
    P(g, 12, 10, 1, 5, '#2f3742');
  } else if (v === 1) {
    // หลังจอใหญ่ + คีย์บอร์ด
    P(g, 3, 0, 10, 8, '#2a3038'); P(g, 4, 1, 8, 6, '#3a424c'); P(g, 4, 1, 8, 1, '#4a545e');
    P(g, 7, 3, 2, 2, '#5c6a78'); P(g, 6, 8, 4, 2, '#2a3038');
    P(g, 3, 11, 10, 2, '#e8eef4'); P(g, 3, 11, 10, 1, '#fbfdff');
  } else {
    // โทรศัพท์ + ป้ายชื่อ
    P(g, 2, 10, 5, 5, '#2f3742'); P(g, 3, 11, 3, 3, '#4a545e'); P(g, 3, 9, 4, 1, '#2f3742');
    P(g, 9, 12, 6, 3, '#c8a050'); P(g, 9, 12, 6, 1, '#e8c070'); P(g, 10, 13, 4, 1, '#7a5a20');
  }
  P(g, 1, 17, 2, 4, '#4e3116'); P(g, 13, 17, 2, 4, '#4e3116');
  return { c: o.c, oy: 6 };
}
/**
 * โต๊ะคอมพิวเตอร์ในห้องแผนก - หันหน้ามาทางกล้อง (คนนั่งอยู่ช่องล่าง หันขึ้น)
 * ตั้งใจให้อ่านออกทันทีว่าเป็นโต๊ะทำงาน: ที่กั้นด้านหลัง จอมีภาพติดจอ คีย์บอร์ด เมาส์ แก้วกาแฟ
 */
function drawWorkDesk(v: number): Sprite {
  const o = mk(16, 26), g = o.g;
  // ที่กั้น (partition) สีเทาอมฟ้า พร้อมกระดาษโน้ตติดอยู่
  P(g, 0, 0, 16, 10, '#5c6a78'); P(g, 1, 1, 14, 8, '#8fa0b0'); P(g, 1, 1, 14, 1, '#aebccb');
  if (v === 0) { P(g, 2, 3, 3, 3, '#f8e070'); P(g, 11, 2, 3, 3, '#f0a0c0'); }
  if (v === 1) { P(g, 2, 2, 4, 3, '#a8d8f0'); }
  if (v === 2) { P(g, 11, 3, 3, 3, '#f8e070'); P(g, 2, 4, 2, 2, '#c8f0a0'); }
  // จอคอม - เห็นหน้าจอ มีแถบเมนูกับกล่องข้อความ
  P(g, 3, 6, 10, 9, '#2a3038'); P(g, 4, 7, 8, 7, '#3f6f8f'); P(g, 4, 7, 8, 1, '#5c93b0');
  P(g, 5, 8, 3, 1, '#8fd0e8'); P(g, 5, 10, 5, 1, '#8fd0e8'); P(g, 5, 12, 4, 1, '#8fd0e8');
  P(g, 7, 15, 2, 2, '#2a3038'); P(g, 5, 16, 6, 1, '#39424f');
  // ท็อปโต๊ะสีไม้อ่อน กับขอบหน้า
  P(g, 0, 17, 16, 6, '#c9ab7e'); P(g, 0, 17, 16, 1, '#e2c79c'); P(g, 0, 22, 16, 1, '#8c6e4c');
  // คีย์บอร์ด เมาส์ แก้ว
  P(g, 4, 19, 7, 2, '#e8ecf0'); P(g, 5, 19, 5, 1, '#c8d0d8'); P(g, 12, 19, 2, 2, '#f4f7fa');
  P(g, 1, 18, 2, 3, v === 1 ? '#d9534f' : '#f2efe4'); P(g, 1, 18, 2, 1, v === 1 ? '#e87070' : '#ffffff');
  P(g, 1, 23, 2, 3, '#8c6e4c'); P(g, 13, 23, 2, 3, '#8c6e4c');
  return { c: o.c, oy: 10 };
}
/**
 * เก้าอี้ - back=หันหลังให้กล้อง (คนนั่งหันขึ้น)
 * v=สี 0 ฟ้า 1 หนังน้ำตาลบอส 2 ทองเลขาฯ 3 เก้าอี้สำนักงานดำ (ห้องแผนก)
 */
const CHAIR_PAL = (back: boolean): [string, string][] => [
  back ? ['#8c5f6a', '#5e3d46'] : ['#5f7f8c', '#3f5a66'],
  ['#7a4a2a', '#4e2c14'],
  ['#b8862a', '#7a5618'],
  ['#4a5058', '#2a3038'],
  ['#3f8fa0', '#26606c'],
];

/**
 * เก้าอี้ "ชั้นหลัง" - วาดก่อนตัวคน
 * dir คือทิศที่คนนั่งหัน พนักพิงอยู่ด้านตรงข้าม:
 *   down  = พนักพิงอยู่บน (หลังคน) เห็นเต็ม   up = เห็นแค่เบาะ (พนักพิงอยู่ล่าง วาดทับคนใน drawChairFront)
 *   left/right = เบาะ + พนักพิงบางส่วนฝั่งตรงข้าม (ส่วนที่บังตัวคนไปอยู่ชั้นหน้า)
 */
function drawChair(back: boolean, v = 0, dir: 'up' | 'down' | 'left' | 'right' = 'down'): Sprite {
  const o = mk(16, 19), g = o.g;
  const [A, D] = CHAIR_PAL(back)[v % 5];
  const seat = () => {
    P(g, 2, 8, 12, 4, D); P(g, 3, 8, 10, 3, shade(A, 1.05)); P(g, 3, 8, 10, 1, shade(A, 1.25));
    P(g, 2, 9, 1, 3, D); P(g, 13, 9, 1, 3, D);
    P(g, 7, 12, 2, 3, D); P(g, 4, 15, 3, 2, '#2f3742'); P(g, 9, 15, 3, 2, '#2f3742');
  };
  if (dir === 'down') {
    // พนักพิงตั้งอยู่บน หลังคน
    P(g, 4, 0, 8, 7, D); P(g, 5, 1, 6, 5, A); P(g, 5, 1, 6, 1, shade(A, 1.2));
    P(g, 7, 7, 2, 1, D);
    seat();
  } else if (dir === 'up') {
    // หันหลังให้เรา - เห็นแค่เบาะกับขาเก้าอี้ พนักพิงไปอยู่ชั้นหน้า
    seat();
  } else {
    // หันข้าง - พนักพิงอยู่ฝั่งตรงข้ามกับที่หัน (หัน right = พนักพิงซ้าย) ชิ้นบนของพนักพิงอยู่หลังคน
    seat();
    const bx = dir === 'right' ? 1 : 12;
    P(g, bx, 1, 3, 8, D); P(g, bx + 1, 2, 1, 6, A);
  }
  return { c: o.c, oy: 3 };
}

/**
 * เก้าอี้ "ชั้นหน้า" - วาดหลังตัวคน (ทับ) เฉพาะเก้าอี้ที่หัน up / left / right
 * up: พนักพิงบังสะโพก-ขา ให้ดูออกว่านั่งพิงอยู่ ไม่ใช่ยืนหน้าเก้าอี้
 * left/right: ส่วนล่างของพนักพิงกับที่วางแขนบังลำตัวด้านข้าง
 */
function drawChairFront(back: boolean, v = 0, dir: 'up' | 'down' | 'left' | 'right' = 'up'): Sprite {
  const o = mk(16, 19), g = o.g;
  const [A, D] = CHAIR_PAL(back)[v % 5];
  if (dir === 'up') {
    P(g, 3, 9, 10, 8, D); P(g, 4, 10, 8, 6, A); P(g, 4, 10, 8, 1, shade(A, 1.2));
    dith4(g, 9, 11, 2, 5, shade(A, 0.85), 0);
    P(g, 3, 17, 10, 1, shade(D, 0.8));
  } else if (dir === 'left' || dir === 'right') {
    const bx = dir === 'right' ? 1 : 12;
    P(g, bx, 9, 3, 6, D); P(g, bx + 1, 10, 1, 4, A);
    // ที่วางแขน
    P(g, bx, 9, 3, 1, shade(A, 1.2));
  }
  return { c: o.c, oy: 3 };
}
/** เคาน์เตอร์เลขาฯ 3 ชิ้น (part 0 ซ้าย 1 กลาง 2 ขวา) - หน้าเคาน์เตอร์หันลงหาล็อบบี้ */
function drawCounter2(part: number): Sprite {
  const o = mk(16, 24), g = o.g;
  // ท็อปไม้เข้ม
  P(g, 0, 6, 16, 4, '#5a3818'); P(g, 0, 7, 16, 2, '#8f5f34'); P(g, 0, 7, 16, 1, '#b07c48');
  // หน้าเคาน์เตอร์สีครีมมีคิ้วไม้
  P(g, 0, 10, 16, 12, '#8c6e4c'); P(g, 0, 11, 16, 10, '#efe3c8'); P(g, 0, 11, 16, 1, '#fff8e8');
  P(g, 0, 20, 16, 2, '#6b5236');
  if (part === 0) { P(g, 0, 6, 1, 16, '#5a3818'); P(g, 3, 13, 5, 6, '#c8a050'); P(g, 4, 14, 3, 4, '#e8c070'); }
  if (part === 1) { P(g, 4, 2, 8, 5, '#2f3742'); P(g, 5, 3, 6, 3, '#4a545e'); P(g, 6, 7, 4, 1, '#2f3742'); P(g, 5, 13, 6, 1, '#8c6e4c'); P(g, 5, 15, 6, 1, '#8c6e4c'); }
  if (part === 2) { P(g, 15, 6, 1, 16, '#5a3818'); P(g, 6, 1, 4, 5, '#8fb8cc'); P(g, 7, 1, 2, 5, '#c4e0ec'); P(g, 5, 0, 2, 2, '#e05868'); P(g, 9, 0, 2, 2, '#f0a048'); }
  return { c: o.c, oy: 8 };
}
/** ตู้หนังสือกฎหมาย - เล่มหนาสีเข้มเรียงเป็นชุด (ห้องกฎหมาย) */
function drawLawShelf(): Sprite {
  const o = mk(16, 26), g = o.g;
  P(g, 1, 0, 14, 24, '#4e3116'); P(g, 2, 1, 12, 22, '#6b4520');
  const cols = ['#5a2838', '#3a2848', '#5a2838', '#2a3848', '#5a2838'];
  for (let row = 0; row < 3; row++) {
    P(g, 2, 1 + row * 8, 12, 1, '#4e3116');
    for (let i = 0; i < 5; i++) {
      P(g, 3 + i * 2, 2 + row * 8, 2, 6, cols[(i + row) % 5]);
      P(g, 3 + i * 2, 4 + row * 8, 2, 1, '#c8a050');
    }
  }
  P(g, 1, 24, 14, 2, '#3a2010');
  return { c: o.c, oy: 10 };
}
/** ตู้เซฟ - ห้องการเงิน */
function drawSafe(): Sprite {
  const o = mk(16, 22), g = o.g;
  P(g, 2, 2, 12, 18, '#2a3038'); P(g, 3, 3, 10, 16, '#4a5058'); P(g, 3, 3, 10, 1, '#6a7280');
  P(g, 5, 7, 6, 6, '#3a4048'); P(g, 6, 8, 4, 4, '#8d99a3'); P(g, 7, 9, 2, 2, '#c8a050');
  P(g, 11, 6, 1, 8, '#c8a050'); P(g, 2, 20, 12, 2, '#1d2228');
  return { c: o.c, oy: 6 };
}
/** แร็คเซิร์ฟเวอร์ ไฟกะพริบ - ห้องวิศวกรรม */
function drawServer(): Sprite {
  const o = mk(16, 28), g = o.g;
  P(g, 2, 0, 12, 26, '#1d2228'); P(g, 3, 1, 10, 24, '#2a3038');
  for (let i = 0; i < 6; i++) {
    P(g, 4, 2 + i * 4, 8, 3, '#3a4048'); P(g, 4, 2 + i * 4, 8, 1, '#4a5058');
    P(g, 10, 3 + i * 4, 1, 1, i % 2 ? '#5ad06a' : '#e8d84c'); P(g, 5, 3 + i * 4, 3, 1, '#1d2228');
  }
  P(g, 2, 26, 12, 2, '#101418');
  return { c: o.c, oy: 12 };
}
/** ขาตั้งโปสเตอร์/บอร์ดนำเสนอ - ห้องการตลาด */
function drawEasel(): Sprite {
  const o = mk(16, 28), g = o.g;
  P(g, 2, 2, 12, 14, '#7a5230'); P(g, 3, 3, 10, 12, '#f8c0d8'); P(g, 3, 3, 10, 3, '#e07aa8');
  P(g, 4, 8, 7, 1, '#7a2848'); P(g, 4, 10, 5, 1, '#7a2848'); P(g, 5, 12, 5, 2, '#f0e08c');
  P(g, 3, 16, 2, 10, '#5a3a20'); P(g, 11, 16, 2, 10, '#5a3a20'); P(g, 7, 16, 2, 8, '#5a3a20');
  return { c: o.c, oy: 12 };
}
/**
 * เคาน์เตอร์ประชาสัมพันธ์ - แบบ Pokémon Center: ท็อปแดง ตัวเคาน์เตอร์เทาอ่อน ปลายมน
 * มีคอมพิวเตอร์กับกระดิ่งบนเคาน์เตอร์ (ชิ้นกลาง) - หันหน้าลงหาแขก
 */
function drawPrCounter(part: number, total: number): Sprite {
  const o = mk(16, 24), g = o.g;
  const first = part === 0, last = part === total - 1;
  P(g, 0, 4, 16, 6, '#8f2f2c'); P(g, 0, 5, 16, 4, '#d94a44'); P(g, 0, 5, 16, 1, '#f07070');
  P(g, 0, 10, 16, 12, '#8d99a3'); P(g, 0, 11, 16, 10, '#e4ecf2'); P(g, 0, 11, 16, 1, '#f7fbfd');
  P(g, 0, 20, 16, 2, '#6f7c86'); P(g, 0, 15, 16, 1, '#c8d4dc');
  if (first) {
    g.clearRect(0, 4, 3, 1); g.clearRect(0, 5, 2, 1); g.clearRect(0, 6, 1, 1);
    g.clearRect(0, 20, 1, 2); P(g, 0, 7, 1, 13, '#8f2f2c');
  }
  if (last) {
    g.clearRect(13, 4, 3, 1); g.clearRect(14, 5, 2, 1); g.clearRect(15, 6, 1, 1);
    g.clearRect(15, 20, 1, 2); P(g, 15, 7, 1, 13, '#8f2f2c');
  }
  const mid = Math.floor((total - 1) / 2);
  // คอมพิวเตอร์บนเคาน์เตอร์ (ซ้ายของกลาง) - จอหันเข้าหาคนนั่ง เห็นหลังจอ
  if (part === mid - 1) { P(g, 4, 0, 9, 6, '#2a3038'); P(g, 5, 1, 7, 4, '#3a424c'); P(g, 7, 6, 3, 1, '#2a3038'); }
  // กระดิ่ง + แผ่นพับ (ขวาของกลาง)
  if (part === mid + 1) { P(g, 5, 1, 4, 3, '#c8a050'); P(g, 6, 0, 2, 1, '#e8c070'); P(g, 4, 4, 6, 1, '#7a5a20'); P(g, 11, 12, 3, 4, '#5cbc60'); }
  // โลโก้กลม คร่อมชิ้นกลางสองชิ้น
  if (part === mid) { P(g, 10, 13, 6, 6, '#3f7fb0'); P(g, 11, 14, 4, 4, '#8fd0e8'); }
  if (part === mid + 1) { P(g, 0, 13, 6, 6, '#3f7fb0'); P(g, 1, 14, 4, 4, '#8fd0e8'); }
  return { c: o.c, oy: 8 };
}
/**
 * แผงหลังเคาน์เตอร์ PR - เครื่องโค้งสีน้ำเงินตั้งอยู่หลังคนนั่ง (อ้างอิง Pokémon Center)
 * ชิ้นกลางสองชิ้นเป็นจอ/กระจกโค้ง ปลายสองข้างเป็นเสามีไฟ
 */
function drawPrBack(part: number, total: number): Sprite {
  const o = mk(16, 30), g = o.g;
  const first = part === 0, last = part === total - 1;
  const mid = Math.floor((total - 1) / 2);
  P(g, 0, 2, 16, 26, '#3a4048'); P(g, 1, 3, 14, 24, '#6f7c86'); P(g, 1, 3, 14, 1, '#98a4ae');
  P(g, 0, 8, 16, 12, '#2f5c86'); P(g, 1, 9, 14, 10, '#4a86bc'); P(g, 1, 9, 14, 2, '#74aede');
  if (part === mid || part === mid + 1) {
    P(g, 2, 10, 12, 8, '#a8d4f0'); P(g, 3, 11, 4, 2, '#e8f4ff'); P(g, 2, 16, 12, 2, '#5c93b0');
  } else if (!first && !last) {
    P(g, 6, 11, 4, 6, '#3f7fb0'); P(g, 7, 12, 2, 4, '#8fd0e8');
  }
  if (first || last) { P(g, 6, 0, 4, 3, '#2a3038'); P(g, 7, 1, 2, 1, '#e85860'); }
  P(g, 0, 26, 16, 2, '#2a3038'); P(g, 0, 28, 16, 2, '#1d2228');
  return { c: o.c, oy: 14 };
}
/** ตู้เอกสารในห้องบอส */
function drawCabinet(): Sprite {
  const o = mk(16, 26), g = o.g;
  P(g, 1, 0, 14, 24, '#4a5058'); P(g, 2, 1, 12, 22, '#78848f'); P(g, 2, 1, 12, 1, '#98a4ae');
  for (let i = 0; i < 3; i++) {
    P(g, 2, 2 + i * 7, 12, 6, '#8d99a3'); P(g, 2, 2 + i * 7, 12, 1, '#a8b4be');
    P(g, 6, 5 + i * 7, 4, 1, '#3a4048');
  }
  P(g, 1, 24, 14, 2, '#2f3742');
  return { c: o.c, oy: 10 };
}
/** ไวท์บอร์ดตั้งพื้นในห้องประชุม */
function drawBoardStand(): Sprite {
  const o = mk(16, 28), g = o.g;
  P(g, 1, 0, 14, 16, '#7a5230'); P(g, 2, 1, 12, 14, '#f4f6f8'); P(g, 2, 1, 12, 1, '#ffffff');
  P(g, 3, 4, 8, 1, '#4a86bc'); P(g, 3, 7, 6, 1, '#d9534f'); P(g, 3, 10, 9, 1, '#4a86bc');
  P(g, 10, 6, 3, 3, '#3fa06a');
  P(g, 3, 16, 2, 10, '#5a3a20'); P(g, 11, 16, 2, 10, '#5a3a20'); P(g, 1, 26, 14, 1, '#4a2e18');
  return { c: o.c, oy: 12 };
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
/**
 * ป้ายตั้งพื้นสำหรับโลโก้ - 2 ช่อง (part 0 ซ้าย, 1 ขวา): แผ่นป้ายกรอบทองบนเสาคู่ พื้นป้ายสีเข้ม
 * ตัวรูปโลโก้ world วาดทับตรงกลางแผ่นตอน render (ต่อออฟฟิศ ไม่ cache รวมกับ sprite)
 */
function drawLogoStand(part: number): Sprite {
  const o = mk(16, 26), g = o.g;
  const L = part === 0;
  // เสา
  P(g, L ? 3 : 11, 14, 2, 10, '#5a3a20'); P(g, L ? 3 : 11, 14, 1, 10, '#7a5030');
  // แผ่นป้าย - ต่อกัน 2 ช่อง (ซ้ายมีขอบซ้าย ขวามีขอบขวา)
  P(g, L ? 1 : 0, 2, L ? 15 : 15, 12, '#3a2c1a');
  P(g, L ? 2 : 0, 3, L ? 14 : 14, 10, '#f0e2c0');
  P(g, L ? 1 : 0, 2, L ? 15 : 15, 1, '#d8b060'); P(g, L ? 1 : 0, 13, L ? 15 : 15, 1, '#a07830');
  if (L) { P(g, 1, 2, 1, 12, '#d8b060'); } else { P(g, 15, 2, 1, 12, '#a07830'); }
  // เงาใต้ป้าย
  P(g, L ? 2 : 0, 24, L ? 14 : 14, 1, 'rgba(0,0,0,0.25)');
  return { c: o.c, oy: 10 };
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
    `${o.left ? 'L' : ''}${o.right ? 'R' : ''}${o.back ? 'K' : ''}${o.dir ?? ''}`;
  const hit = objCache.get(key);
  if (hit) return hit;

  let s: Sprite;
  switch (o.type) {
    case 'desk': s = drawDesk(o.v ?? 0); break;
    case 'bossdesk': s = drawBossDesk(o.v ?? 0); break;
    case 'chair': s = drawChair(!!o.back, o.v ?? 0, o.dir ?? 'down'); break;
    case 'chairfront': s = drawChairFront(!!o.back, o.v ?? 0, o.dir ?? 'up'); break;
    case 'workdesk': s = drawWorkDesk(o.v ?? 0); break;
    case 'counter2': s = drawCounter2(o.part ?? 0); break;
    case 'prcounter': s = drawPrCounter(o.part ?? 0, o.v ?? 1); break;
    case 'prback': s = drawPrBack(o.part ?? 0, o.v ?? 1); break;
    case 'cabinet': s = drawCabinet(); break;
    case 'lawshelf': s = drawLawShelf(); break;
    case 'safe': s = drawSafe(); break;
    case 'server': s = drawServer(); break;
    case 'easel': s = drawEasel(); break;
    case 'board': s = drawBoardStand(); break;
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
    case 'logostand': s = drawLogoStand(o.part ?? 0); break;
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
  } else if (type === 'scale') {
    // ตาชั่งความยุติธรรม - ห้องกฎหมาย
    P(g, 7, 4, 2, 9, '#c8a050'); P(g, 3, 4, 10, 1, '#c8a050'); P(g, 5, 13, 6, 1, '#7a5a20');
    P(g, 2, 5, 1, 3, '#c8a050'); P(g, 13, 5, 1, 3, '#c8a050');
    P(g, 1, 8, 3, 1, '#e8c070'); P(g, 12, 8, 3, 1, '#e8c070');
  } else if (type === 'chart') {
    // กราฟขึ้นในกรอบ - ห้องการเงิน
    P(g, 2, 3, 12, 11, '#6b4520'); P(g, 3, 4, 10, 9, '#f6f2e4');
    P(g, 4, 11, 1, 1, '#3fa06a'); P(g, 6, 9, 1, 3, '#3fa06a'); P(g, 8, 7, 1, 5, '#3fa06a'); P(g, 10, 5, 1, 7, '#3fa06a');
    P(g, 4, 10, 7, 1, '#d9534f'); P(g, 2, 13, 12, 1, '#4e3116');
  } else if (type === 'whiteboard') {
    // ไวท์บอร์ดมีแผนผังระบบ - ห้องวิศวกรรม
    P(g, 0, 3, 16, 12, '#9aa3ad'); P(g, 1, 4, 14, 10, '#f6f7f2');
    P(g, 3, 6, 3, 2, '#4a7fd0'); P(g, 10, 6, 3, 2, '#4a7fd0'); P(g, 6, 7, 4, 1, '#3a4048');
    P(g, 6, 10, 4, 2, '#e0a13f'); P(g, 7, 8, 1, 2, '#3a4048'); P(g, 0, 14, 16, 1, '#6f7982');
  } else if (type === 'pinboard') {
    // บอร์ดประกาศไม้ก๊อก มีกระดาษติดหลากสี - ห้องบุคคล
    P(g, 1, 3, 14, 11, '#8c6e4c'); P(g, 2, 4, 12, 9, '#c8a878');
    P(g, 3, 5, 3, 3, '#f8e070'); P(g, 7, 5, 3, 4, '#a8d8f0'); P(g, 11, 6, 2, 3, '#f0a0c0'); P(g, 4, 9, 4, 3, '#c8f0a0');
    P(g, 4, 5, 1, 1, '#d9534f'); P(g, 8, 5, 1, 1, '#d9534f'); P(g, 1, 13, 14, 1, '#6b5236');
  } else if (type === 'poster') {
    // โปสเตอร์แคมเปญสีจัด - ห้องการตลาด
    P(g, 3, 2, 10, 13, '#e07aa8'); P(g, 4, 3, 8, 11, '#f8c0d8'); P(g, 4, 3, 8, 3, '#e07aa8');
    P(g, 5, 8, 6, 1, '#7a2848'); P(g, 5, 10, 4, 1, '#7a2848'); P(g, 6, 12, 4, 1, '#f0e08c');
  }
  decorCache.set(type, o.c);
  return o.c;
}

/* ---------------- ลวดลายบนพื้น ----------------
   วาดทับ tile หลังปูพื้นเสร็จ ก่อนวางของ
   แยกเป็น layer ของตัวเองเพราะกินหลายช่อง ทำเป็น tile ไม่ได้ */
const decalCache = new Map<string, HTMLCanvasElement>();

export interface FloorDecal {
  type: 'rug' | 'emblem' | 'mat' | 'logo';
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
  } else if (d.type === 'logo') {
    // กรอบจาง ๆ ให้เห็นว่าโลโก้อยู่ตรงนี้ - รูปจริง world วาดทับ (มีรูปแล้วกรอบนี้จมหายไปเอง)
    P(g, 0, 0, w, 1, 'rgba(255,255,255,0.18)'); P(g, 0, h - 1, w, 1, 'rgba(0,0,0,0.18)');
    P(g, 0, 0, 1, h, 'rgba(255,255,255,0.18)'); P(g, w - 1, 0, 1, h, 'rgba(0,0,0,0.18)');
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
