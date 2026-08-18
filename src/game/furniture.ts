import type { Dir, Tile } from './types';
import { GROUND, MH, MW, ROOMS, ROOM_OF_DEPT, ROOM_THEMES, type MapObject } from './map';
import type { FloorDecal } from './art';

/* ============================================================
   ทุกอย่างในออฟฟิศเป็น "ของ" ที่จัดเองได้ (แบบ Stardew) - ผังต่อออฟฟิศ
   ------------------------------------------------------------
   ผังประกอบด้วย 3 ส่วน
     ground  พื้น/ผนัง/กระจก/สนาม/น้ำ ทีละช่อง (ทาสีได้) - แผนที่ 36x18 ช่องขนาดคงที่
     items   ของทุกชิ้น: โต๊ะทำงาน เก้าอี้ โต๊ะประชุม โต๊ะบอส เคาน์เตอร์เลขาฯ/PR ป้ายแผนก ทางเข้า
             ของตกแต่ง ของบนผนัง พรม/ตราบริษัท ของสวน  (หนึ่งชิ้น = LayoutItem)
     logo    รูปโลโก้บริษัท (data URL) - วาดลงตราบนพื้น (emblem)
   "ที่นั่งประจำ" = เก้าอี้ (chair) หรือชุดโต๊ะทำงาน (desk) ที่มี owner เป็น employee id
     บอส = owner 'boss', เลขาฯ = owner 'secretary' (ตัวละครประจำ ไม่ได้จ้าง)

   หลักกันบั๊ก: ผังที่ผ่าน LayoutState.validate() รับประกันว่ามีทางเข้า 1 จุด, บอส/เลขาฯ มีเก้าอี้,
   มีโต๊ะประชุม+เก้าอี้พอ, ไม่มีอะไรทับกัน และทุกที่นั่ง/จุดสำคัญเดินถึงได้จากทางเข้า
   ============================================================ */

export type FurnKind =
  // ทำงาน / ประจำที่
  | 'desk' | 'chair' | 'meettable' | 'bossdesk' | 'seccounter' | 'prcounter' | 'prback' | 'deptsign' | 'entrance'
  // นั่งเล่น
  | 'sofa' | 'sofa2' | 'bench' | 'ctable'
  // ตกแต่ง
  | 'plant' | 'palm' | 'pot' | 'cabinet' | 'shelf' | 'lawshelf' | 'safe' | 'server' | 'easel' | 'board'
  | 'printer' | 'cooler' | 'vending' | 'counter' | 'vasetable'
  // บนผนัง (ต้องวางบนช่องผนัง)
  | 'wframe0' | 'wframe1' | 'wclock' | 'wwindow' | 'wscreen' | 'wboard' | 'whangplant' | 'wlogo'
  // ป้ายตั้งพื้นโชว์โลโก้
  | 'logostand'
  // พื้น (พรม/ตรา/โลโก้ - วาดใต้ของทุกชิ้น เดินทับได้)
  | 'rug_l' | 'rug_m' | 'rug_s' | 'mat' | 'emblem' | 'logo'
  // สวน
  | 'lamp' | 'sign' | 'flower' | 'bush' | 'rock' | 'pine';

export interface LayoutItem {
  id: string;
  kind: FurnKind;
  /** ช่อง anchor - เก้าอี้/โต๊ะ = ช่องที่คนนั่ง, ของหลายช่อง = ช่องซ้ายบน */
  x: number;
  y: number;
  /** ทิศที่คนนั่งหัน (desk/chair) - ของอื่นไม่ใช้ */
  dir?: Dir;
  /** ลายย่อยของ sprite */
  v?: number;
  /** ใครนั่งประจำ (desk/chair) - employee id / 'boss' / 'secretary' - null/ไม่มี = ว่าง */
  owner?: string | null;
  /** deptsign: แผนก */
  dept?: string;
  /** deptsign: ข้อความบนป้ายที่ผู้ใช้ตั้งเอง - ไม่มี = ใช้ชื่อย่อแผนก */
  text?: string;
  /** chair: 'meethead' = หัวโต๊ะประชุม (บอสนั่งตอนประชุม) */
  tag?: 'meethead';
  /** ขนาดหน่วยช่อง (เฉพาะชนิดที่ resizable เช่นโลโก้) */
  w?: number;
  h?: number;
  /** ลำดับซ้อน (z-index) ของชั้นพื้น - มากอยู่บน; ไม่มี = เรียงตามชนิด (พรม < พรมเช็ดเท้า < ตรา < โลโก้) */
  z?: number;
}

export interface OfficeLayout {
  v: 1;
  /** id ของการแก้ครั้งล่าสุด - จอที่เป็นคนบันทึกเองจะได้ไม่เอาของตัวเองมาทับซ้ำตอน realtime เด้งกลับ */
  rev: string;
  items: LayoutItem[];
  /** พื้น/ผนัง 18 แถว x 36 ตัวอักษร - ไม่มี = ผังพื้นเริ่มต้น */
  ground?: string[];
  /** โลโก้บริษัท (data URL png ย่อแล้ว) - วาดบนป้าย/ตรา และแถบบน */
  logo?: string | null;
  /** วิธีใส่โลโก้ในกรอบ (ทุกป้าย): contain = พอดีไม่บิด (ค่าเริ่มต้น), cover = เต็มกรอบตัดขอบ, stretch = ยืดเต็ม */
  logoFit?: 'contain' | 'cover' | 'stretch';
}

export const LAYOUT_VERSION = 1 as const;
/** เพดานจำนวนชิ้น - กันผังบวมจนวาด/ตรวจช้า */
export const MAX_ITEMS = 400;
/** ความยาวสูงสุดของข้อความป้ายแผนกที่ตั้งเอง */
export const MAX_SIGN_TEXT = 24;
/** เพดานขนาดโลโก้ (data URL) - เก็บใน jsonb ต้องไม่ใหญ่ */
export const MAX_LOGO_CHARS = 60_000;

/* ---------- แคตตาล็อก ---------- */

export type FurnCategory = 'office' | 'work' | 'lounge' | 'decor' | 'wall' | 'floor' | 'garden';

export interface FurnSpec {
  label: string;
  category: FurnCategory;
  /** หมุนได้ (dir มีความหมาย) */
  rotates?: boolean;
  /** วางได้เฉพาะในอาคาร (โต๊ะทำงาน) */
  indoorOnly?: boolean;
  /** วางได้เฉพาะบนช่องผนัง */
  wallOnly?: boolean;
  /** วาดใต้ของทุกชิ้น เดินทับได้ ของอื่นวางทับได้ (พรม/ตรา) */
  decal?: boolean;
  /** ไม่กินที่เลย - ป้ายลอย ๆ (ป้ายแผนก) */
  ghost?: boolean;
  /** จำนวนลาย v ที่ art รองรับ (สุ่มตอนวางใหม่) */
  variants?: number;
  /** ต้องมีในผัง "พอดี 1 ชิ้น" (ลบไม่ได้ วางเพิ่มไม่ได้) */
  unique?: boolean;
  /** มีได้ชิ้นเดียว แต่ลบได้ */
  single?: boolean;
  /** ปรับกว้าง/สูงได้ (หน่วยช่อง) */
  resizable?: { minW: number; maxW: number; minH: number; maxH: number; defW: number; defH: number };
}

export const FURN: Record<FurnKind, FurnSpec> = {
  desk:       { label: 'โต๊ะทำงาน + เก้าอี้', category: 'work', rotates: true, indoorOnly: true, variants: 3 },
  chair:      { label: 'เก้าอี้', category: 'work', rotates: true, variants: 5 },
  meettable:  { label: 'โต๊ะประชุม (ยาว 8)', category: 'office' },
  bossdesk:   { label: 'โต๊ะผู้บริหาร (ยาว 3)', category: 'office' },
  seccounter: { label: 'เคาน์เตอร์เลขาฯ (ยาว 3)', category: 'office' },
  prcounter:  { label: 'เคาน์เตอร์ประชาสัมพันธ์ (ยาว 6)', category: 'office' },
  prback:     { label: 'แผงหลังเคาน์เตอร์ PR (ยาว 6)', category: 'office' },
  deptsign:   { label: 'ป้ายแผนก', category: 'office', ghost: true },
  entrance:   { label: 'ทางเข้า (แขกเดินเข้าตรงนี้)', category: 'office', decal: true, unique: true },
  sofa:       { label: 'โซฟา 3 ที่นั่ง', category: 'lounge' },
  sofa2:      { label: 'โซฟาคู่ (ตกแต่ง)', category: 'lounge' },
  bench:      { label: 'ม้านั่งสวน', category: 'garden' },
  ctable:     { label: 'โต๊ะกลาง', category: 'lounge' },
  plant:      { label: 'ต้นไม้กระถาง', category: 'decor' },
  palm:       { label: 'ปาล์มกระถาง', category: 'decor', variants: 2 },
  pot:        { label: 'กระถางเล็ก', category: 'decor', variants: 2 },
  cabinet:    { label: 'ตู้เอกสาร', category: 'decor' },
  shelf:      { label: 'ชั้นหนังสือ', category: 'decor' },
  lawshelf:   { label: 'ตู้กฎหมาย', category: 'decor' },
  safe:       { label: 'ตู้เซฟ', category: 'decor' },
  server:     { label: 'ตู้เซิร์ฟเวอร์', category: 'decor' },
  easel:      { label: 'ขาตั้งภาพ', category: 'decor' },
  board:      { label: 'ไวท์บอร์ดตั้งพื้น', category: 'decor' },
  printer:    { label: 'เครื่องพิมพ์', category: 'decor' },
  cooler:     { label: 'เครื่องกดน้ำ', category: 'decor' },
  vending:    { label: 'ตู้กดเครื่องดื่ม', category: 'decor' },
  counter:    { label: 'เคาน์เตอร์แพนทรี่', category: 'decor' },
  vasetable:  { label: 'โต๊ะแจกัน', category: 'decor' },
  wframe0:    { label: 'รูปแขวน (วิว)', category: 'wall', wallOnly: true },
  wframe1:    { label: 'รูปแขวน (กราฟ)', category: 'wall', wallOnly: true },
  wclock:     { label: 'นาฬิกาแขวน', category: 'wall', wallOnly: true },
  wwindow:    { label: 'หน้าต่าง', category: 'wall', wallOnly: true },
  wscreen:    { label: 'จอนำเสนอ', category: 'wall', wallOnly: true },
  wboard:     { label: 'บอร์ดติดผนัง', category: 'wall', wallOnly: true },
  whangplant: { label: 'ไม้แขวน', category: 'wall', wallOnly: true },
  wlogo:      { label: 'ป้ายโลโก้ติดผนัง (ย่อ/ขยาย)', category: 'wall', wallOnly: true, resizable: { minW: 1, maxW: 8, minH: 1, maxH: 2, defW: 4, defH: 1 } },
  logostand:  { label: 'ป้ายตั้งพื้นโลโก้ (2 ช่อง)', category: 'office' },
  rug_l:      { label: 'พรมใหญ่ 6x3', category: 'floor', decal: true, variants: 3 },
  rug_m:      { label: 'พรมกลาง 4x3', category: 'floor', decal: true, variants: 3 },
  rug_s:      { label: 'พรมเล็ก 4x2', category: 'floor', decal: true, variants: 3 },
  mat:        { label: 'พรมเช็ดเท้า', category: 'floor', decal: true },
  emblem:     { label: 'ตราวงกลม 8x2', category: 'floor', decal: true },
  logo:       { label: 'โลโก้บริษัท (ย่อ/ขยาย ลากได้)', category: 'floor', decal: true, single: true, resizable: { minW: 1, maxW: 16, minH: 1, maxH: 8, defW: 8, defH: 2 } },
  lamp:       { label: 'เสาไฟสวน', category: 'garden' },
  sign:       { label: 'ป้าย', category: 'garden' },
  flower:     { label: 'ดอกไม้', category: 'garden', variants: 3 },
  bush:       { label: 'พุ่มไม้', category: 'garden' },
  rock:       { label: 'หิน', category: 'garden' },
  pine:       { label: 'ต้นสน', category: 'garden', variants: 2 },
};

export const CATEGORY_TH: Record<FurnCategory, string> = {
  office: 'ประจำที่', work: 'โต๊ะ/เก้าอี้', lounge: 'นั่งเล่น', decor: 'ตกแต่ง', wall: 'บนผนัง', floor: 'พรม/ตรา', garden: 'สวน',
};
export const CATEGORIES: FurnCategory[] = ['office', 'work', 'lounge', 'decor', 'wall', 'floor', 'garden'];

/* ---------- พื้น/ผนัง (ทาสีได้) ---------- */

export interface TileSpec { code: string; label: string; walkable: boolean; indoor: boolean }
export const TILES: TileSpec[] = [
  { code: '#', label: 'ผนัง', walkable: false, indoor: false },
  { code: 'G', label: 'ผนังกระจก', walkable: false, indoor: false },
  { code: 't', label: 'กระเบื้อง', walkable: true, indoor: true },
  { code: 'w', label: 'พื้นไม้', walkable: true, indoor: true },
  { code: 'r', label: 'พรมเขียว', walkable: true, indoor: true },
  { code: 'b', label: 'พรมน้ำเงิน', walkable: true, indoor: true },
  { code: 'l', label: 'พรมส้ม', walkable: true, indoor: true },
  { code: 'L', label: 'พื้นม่วง (กฎหมาย)', walkable: true, indoor: true },
  { code: 'F', label: 'พื้นเขียว (การเงิน)', walkable: true, indoor: true },
  { code: 'E', label: 'พื้นน้ำเงิน (วิศวกรรม)', walkable: true, indoor: true },
  { code: 'P', label: 'พื้นทอง (บุคคล)', walkable: true, indoor: true },
  { code: 'M', label: 'พื้นชมพู (การตลาด)', walkable: true, indoor: true },
  { code: 'g', label: 'หญ้า', walkable: true, indoor: false },
  { code: 'p', label: 'ทางเดิน', walkable: true, indoor: false },
  { code: 's', label: 'ทราย', walkable: true, indoor: false },
  { code: '~', label: 'น้ำ', walkable: false, indoor: false },
];
const TILE_BY = new Map(TILES.map((t) => [t.code, t]));
export const tileSpec = (code: string) => TILE_BY.get(code) ?? null;

export const isFloor = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < MW && y < MH && (TILE_BY.get(GROUND[y][x])?.walkable ?? false);
export const isIndoor = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < MW && y < MH && (TILE_BY.get(GROUND[y][x])?.indoor ?? false);
export const isWall = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < MW && y < MH && (GROUND[y][x] === '#' || GROUND[y][x] === 'G');

/** ชนิดที่ทึบ (เดินผ่านไม่ได้) - ที่นั่ง/พรม/ป้าย/ของบนผนัง ไม่ทึบ */
const SOLID = new Set<FurnKind>([
  'meettable', 'bossdesk', 'seccounter', 'prcounter', 'prback', 'logostand',
  'sofa2', 'ctable', 'plant', 'palm', 'pot', 'cabinet', 'shelf', 'lawshelf', 'safe', 'server', 'easel', 'board',
  'printer', 'cooler', 'vending', 'counter', 'vasetable', 'lamp', 'sign', 'bush', 'rock', 'pine',
]);

export const VEC: Record<Dir, Tile> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
export const DIR_ORDER: Dir[] = ['up', 'right', 'down', 'left'];
export const nextDir = (d: Dir): Dir => DIR_ORDER[(DIR_ORDER.indexOf(d) + 1) % 4];
export const flipDir = (d: Dir): Dir => ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[d];

/** ชิ้นเดียวขยายออกเป็นช่อง ๆ พร้อม sprite - render/walkable/กฎ ใช้ */
export interface FootTile {
  x: number; y: number;
  /** ชั้นที่วาด: decal ใต้ทุกอย่าง, wall ในชั้นพื้น (บนช่องผนัง), obj เรียงลึกกับตัวละคร, none ไม่วาด (ป้าย) */
  layer: 'decal' | 'wall' | 'obj' | 'none';
  obj?: MapObject;
  decal?: FloorDecal;
  /** ชนิดของบนผนัง (decorSprite) - 'logo' = ป้ายโลโก้ (world วาดกรอบ+รูปเองตามขนาด) */
  wall?: string;
  /** ขนาดของบนผนังที่กินหลายช่อง (ป้ายโลโก้) */
  wallRect?: { w: number; h: number };
  /** เดินผ่านไม่ได้ */
  solid: boolean;
  /** นั่งได้ (ทิศที่หันตอนนั่ง) */
  seat?: Dir;
}

const RUG_COLORS = ['#c85050', '#c8a050', '#c8a888'];
const rugTiles = (it: LayoutItem, w: number, h: number): FootTile[] => {
  const decal: FloorDecal = { type: 'rug', x: it.x, y: it.y, w, h, color: RUG_COLORS[(it.v ?? 0) % RUG_COLORS.length] };
  const out: FootTile[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
    out.push({ x: it.x + dx, y: it.y + dy, layer: dx === 0 && dy === 0 ? 'decal' : 'none', decal: dx === 0 && dy === 0 ? decal : undefined, solid: false });
  }
  return out;
};
const run = (it: LayoutItem, n: number, mk: (i: number, x: number) => MapObject): FootTile[] =>
  Array.from({ length: n }, (_, i) => ({ x: it.x + i, y: it.y, layer: 'obj' as const, obj: mk(i, it.x + i), solid: true }));

export function footprint(it: LayoutItem): FootTile[] {
  const dir = it.dir ?? 'up';
  const v = it.v ?? 0;
  const one = (obj: MapObject, solid: boolean, seat?: Dir): FootTile[] => [{ x: it.x, y: it.y, layer: 'obj', obj, solid, seat }];
  switch (it.kind) {
    case 'desk': {
      const d = VEC[dir];
      return [
        { x: it.x + d.x, y: it.y + d.y, layer: 'obj', obj: { type: 'workdesk', x: it.x + d.x, y: it.y + d.y, v: v % 3 }, solid: true },
        { x: it.x, y: it.y, layer: 'obj', obj: { type: 'chair', x: it.x, y: it.y, back: true, v: 3, dir }, solid: false, seat: dir },
      ];
    }
    case 'chair':
      return one({ type: 'chair', x: it.x, y: it.y, back: dir !== 'up', v: v % 5, dir }, false, dir);
    case 'meettable':
      return run(it, 8, (i, x) => ({ type: 'table', x, y: it.y, top: true, bot: true, left: i === 0, right: i === 7 }));
    case 'bossdesk':
      return run(it, 3, (i, x) => ({ type: 'bossdesk', x, y: it.y, v: i }));
    case 'seccounter':
      return run(it, 3, (i, x) => ({ type: 'counter2', x, y: it.y, part: i }));
    case 'prcounter':
      return run(it, 6, (i, x) => ({ type: 'prcounter', x, y: it.y, part: i, v: 6 }));
    case 'prback':
      return run(it, 6, (i, x) => ({ type: 'prback', x, y: it.y, part: i, v: 6 }));
    case 'deptsign':
      return [{ x: it.x, y: it.y, layer: 'none', solid: false }];
    case 'entrance':
      return [{ x: it.x, y: it.y, layer: 'decal', decal: { type: 'mat', x: it.x, y: it.y, w: 1, h: 1 }, solid: false }];
    case 'sofa':
      return [0, 1, 2].map((i) => ({ x: it.x + i, y: it.y, layer: 'obj' as const, obj: { type: 'sofa', x: it.x + i, y: it.y, part: i, v: 1 }, solid: false, seat: 'down' as Dir }));
    case 'sofa2':
      return [0, 2].map((part, i) => ({ x: it.x + i, y: it.y, layer: 'obj' as const, obj: { type: 'sofa2', x: it.x + i, y: it.y, part, v: 2 }, solid: true }));
    case 'bench':
      return one({ type: 'bench', x: it.x, y: it.y }, false, 'down');
    case 'wframe0': case 'wframe1': case 'wclock': case 'wwindow': case 'wscreen': case 'wboard': case 'whangplant':
      return [{ x: it.x, y: it.y, layer: 'wall', wall: it.kind.slice(1), solid: false }];
    case 'wlogo': {
      const rs = FURN.wlogo.resizable!;
      const w = Math.min(rs.maxW, Math.max(rs.minW, it.w ?? rs.defW)), h = Math.min(rs.maxH, Math.max(rs.minH, it.h ?? rs.defH));
      const out: FootTile[] = [];
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
        out.push({ x: it.x + dx, y: it.y + dy, layer: 'wall', solid: false, ...(dx === 0 && dy === 0 ? { wall: 'logo', wallRect: { w, h } } : {}) });
      }
      return out;
    }
    case 'logostand':
      return run(it, 2, (i, x) => ({ type: 'logostand', x, y: it.y, part: i }));
    case 'rug_l': return rugTiles(it, 6, 3);
    case 'rug_m': return rugTiles(it, 4, 3);
    case 'rug_s': return rugTiles(it, 4, 2);
    case 'mat':
      return [{ x: it.x, y: it.y, layer: 'decal', decal: { type: 'mat', x: it.x, y: it.y, w: 1, h: 1 }, solid: false }];
    case 'emblem': {
      const out: FootTile[] = [];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 8; dx++) {
        out.push({ x: it.x + dx, y: it.y + dy, layer: dx === 0 && dy === 0 ? 'decal' : 'none', decal: dx === 0 && dy === 0 ? { type: 'emblem', x: it.x, y: it.y, w: 8, h: 2 } : undefined, solid: false });
      }
      return out;
    }
    case 'logo': {
      const rs = FURN.logo.resizable!;
      const w = Math.min(rs.maxW, Math.max(rs.minW, it.w ?? rs.defW)), h = Math.min(rs.maxH, Math.max(rs.minH, it.h ?? rs.defH));
      const out: FootTile[] = [];
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
        out.push({ x: it.x + dx, y: it.y + dy, layer: dx === 0 && dy === 0 ? 'decal' : 'none', decal: dx === 0 && dy === 0 ? { type: 'logo', x: it.x, y: it.y, w, h } : undefined, solid: false });
      }
      return out;
    }
    default:
      return one({ type: it.kind, x: it.x, y: it.y, v }, SOLID.has(it.kind));
  }
}

/** จุดที่คน "ยืนใช้" ของชิ้นนี้ (หน้าเครื่องกดน้ำ/เคาน์เตอร์แพนทรี่) - ต้องเดินถึงได้ */
export function standSpot(it: LayoutItem): Tile | null {
  if (it.kind === 'cooler' || it.kind === 'counter') return { x: it.x, y: it.y + 1 };
  return null;
}
/** ที่นั่งของชิ้นนี้ (ถ้ามี) */
export const seatOf = (it: LayoutItem): { x: number; y: number; dir: Dir } | null => {
  const ft = footprint(it).find((f) => f.seat);
  return ft ? { x: ft.x, y: ft.y, dir: ft.seat! } : null;
};
export const hasOwner = (it: LayoutItem) => (it.kind === 'desk' || it.kind === 'chair');

/* ---------- ผังเริ่มต้น = ออฟฟิศหน้าตาเดิม ---------- */

let seq = 0;
export const newItemId = () =>
  `f_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

/** พื้นเริ่มต้น - GROUND ตอนโหลดโมดูล (map.ts ทาพื้นห้องแผนกตามธีมไว้แล้ว) */
export const DEFAULT_GROUND: string[] = GROUND.map((r) => r);

export function defaultLayout(): OfficeLayout {
  const items: LayoutItem[] = [];
  const add = (kind: FurnKind, x: number, y: number, extra: Partial<LayoutItem> = {}) =>
    items.push({ id: newItemId(), kind, x, y, ...extra });

  // ห้องประชุม: โต๊ะยาว 8 (13..20, y3) เก้าอี้บน 6 ล่าง 6 + หัวโต๊ะบอส
  add('meettable', 13, 3);
  for (const x of [14, 15, 16, 17, 18, 19]) { add('chair', x, 2, { dir: 'down' }); add('chair', x, 4, { dir: 'up' }); }
  add('chair', 12, 3, { dir: 'right', tag: 'meethead' });
  add('board', 22, 1); add('plant', 10, 1); add('plant', 24, 1); add('plant', 10, 5); add('plant', 24, 5);
  // ห้องผู้บริหาร: โต๊ะ 3 ช่อง (3..5, y3) บอสนั่งหลังโต๊ะหันลง
  add('bossdesk', 3, 3);
  add('chair', 4, 2, { dir: 'down', v: 1, owner: 'boss' });
  add('shelf', 1, 1); add('shelf', 2, 1); add('cabinet', 7, 1); add('plant', 8, 1); add('sofa2', 6, 5); add('pot', 1, 5, { v: 0 });
  // เลขาฯ: เคาน์เตอร์ 3 ช่อง (1..3, y8) นั่งหลังหันลง
  add('seccounter', 1, 8);
  add('chair', 2, 7, { dir: 'down', v: 2, owner: 'secretary' });
  add('palm', 1, 9, { v: 1 });
  // PR: เคาน์เตอร์ 6 (10..15, y8) แผงหลัง (10..15, y6) เก้าอี้ 2 ตัวหันลง
  add('prcounter', 10, 8); add('prback', 10, 6);
  add('chair', 12, 7, { dir: 'down', v: 4 }); add('chair', 13, 7, { dir: 'down', v: 4 });
  add('palm', 9, 7, { v: 0 }); add('palm', 16, 6, { v: 1 });
  // ห้องแผนก: โต๊ะ 3 ตัว/ห้อง + ของประจำห้อง + ป้ายแผนกบนผนังเหนือประตู
  for (const room of ROOMS) {
    for (const s of room.seats) add('desk', s.x, s.y, { dir: 'up', v: (s.x * 7 + s.y * 3) % 3 });
  }
  for (const [deptId, ri] of Object.entries(ROOM_OF_DEPT)) {
    const room = ROOMS[ri]; const th = ROOM_THEMES[deptId];
    if (!room || !th) continue;
    add(th.corner as FurnKind, room.x0 + 3, 16);
    add('deptsign', room.x0 + 1, 11, { dept: deptId });
  }
  add('deptsign', 12, 6, { dept: 'pr' });
  // แพนทรี่ / โซฟา
  add('printer', 20, 6); add('cooler', 21, 6); add('counter', 22, 6); add('counter', 23, 6); add('vending', 24, 6);
  add('ctable', 21, 9); add('sofa', 22, 9); add('vasetable', 24, 10);
  // พรม / ตรา / ทางเข้า
  add('emblem', 9, 9); add('logo', 9, 9, { w: 8, h: 2 }); add('rug_l', 10, 6, { v: 0 }); add('rug_m', 1, 7, { v: 1 }); add('rug_s', 21, 8, { v: 2 }); add('mat', 5, 6);
  add('entrance', 35, 8);
  // ของบนผนัง (แถว 0)
  add('wframe0', 3, 0); add('wclock', 5, 0); add('wframe1', 6, 0); add('wwindow', 1, 0);
  add('wscreen', 16, 0); add('wscreen', 17, 0);
  for (const x of [13, 14, 15, 18, 19, 20]) add('wboard', x, 0);
  add('wwindow', 11, 0); add('wwindow', 22, 0); add('wwindow', 23, 0);
  add('whangplant', 10, 0); add('whangplant', 24, 0); add('wclock', 12, 0); add('wframe1', 21, 0);
  // สวน
  for (const [x, y] of [[28, 4], [31, 4], [28, 12]]) add('bench', x, y);
  for (const [x, y] of [[26, 0], [28, 0], [30, 0], [32, 0], [34, 0], [35, 0], [29, 1], [33, 1],
    [26, 2], [35, 2], [34, 3], [26, 4], [35, 4], [35, 7], [26, 9], [26, 12], [26, 14],
    [33, 14], [35, 14], [26, 16], [28, 16], [30, 16], [32, 16], [34, 16], [26, 17], [30, 17]]) add('pine', x, y, { v: (x + y) % 2 });
  for (const [x, y] of [[27, 2], [34, 5], [27, 11], [34, 7], [32, 3], [26, 3], [33, 4], [27, 6], [32, 14]]) add('bush', x, y);
  for (const [x, y] of [[27, 13], [34, 13], [33, 6]]) add('rock', x, y);
  [[27, 5], [32, 5], [27, 9], [32, 13], [34, 2], [26, 11], [35, 3], [27, 14], [32, 4]]
    .forEach(([x, y], i) => add('flower', x, y, { v: i % 3 }));
  add('sign', 26, 6); add('lamp', 28, 6); add('lamp', 31, 6);
  return { v: LAYOUT_VERSION, rev: newItemId(), items, ground: [...DEFAULT_GROUND], logo: null };
}

/* ---------- อ่าน/เขียน ---------- */

const KINDS = new Set(Object.keys(FURN) as FurnKind[]);
const isDir = (d: unknown): d is Dir => d === 'up' || d === 'down' || d === 'left' || d === 'right';

/** ทำความสะอาด ground จาก DB - แถว/คอลัมน์ไม่ครบหรือรหัสแปลกใช้ค่าเริ่มต้นเฉพาะช่องนั้น */
export function parseGround(raw: unknown): string[] {
  const rows = Array.isArray(raw) ? raw : [];
  return DEFAULT_GROUND.map((def, y) => {
    const r = typeof rows[y] === 'string' ? (rows[y] as string) : '';
    let out = '';
    for (let x = 0; x < MW; x++) out += TILE_BY.has(r[x]) ? r[x] : def[x];
    return out;
  });
}

/**
 * ทำความสะอาดผังจาก DB/localStorage - ของแปลกทิ้ง; null = ใช้ไม่ได้เลย (ให้ใช้ค่าเริ่มต้น)
 * ไม่ตรวจกฎพื้นที่ตรงนี้ (isFloor ขึ้นกับ ground ที่ยังไม่ได้ apply) - LayoutState เป็นคนตรวจตอน set
 */
export function parseLayout(raw: unknown): OfficeLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.items)) return null;
  const items: LayoutItem[] = [];
  const ids = new Set<string>();
  for (const r of p.items) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.kind !== 'string' || !KINDS.has(o.kind as FurnKind)) continue;
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isInteger(o.x) || !Number.isInteger(o.y)) continue;
    if (o.x < 0 || o.y < 0 || o.x >= MW || o.y >= MH) continue;
    const it: LayoutItem = {
      id: typeof o.id === 'string' && o.id && !ids.has(o.id) ? o.id : newItemId(),
      kind: o.kind as FurnKind, x: o.x, y: o.y,
      ...(isDir(o.dir) ? { dir: o.dir } : {}),
      ...(typeof o.v === 'number' ? { v: o.v } : {}),
      ...(typeof o.owner === 'string' && o.owner ? { owner: o.owner } : {}),
      ...(typeof o.dept === 'string' && o.dept ? { dept: o.dept } : {}),
      ...(typeof o.text === 'string' && o.text.trim() ? { text: o.text.trim().slice(0, MAX_SIGN_TEXT) } : {}),
      ...(o.tag === 'meethead' ? { tag: 'meethead' as const } : {}),
      ...(typeof o.w === 'number' && Number.isInteger(o.w) && o.w > 0 ? { w: o.w } : {}),
      ...(typeof o.h === 'number' && Number.isInteger(o.h) && o.h > 0 ? { h: o.h } : {}),
      ...(typeof o.z === 'number' && Number.isFinite(o.z) ? { z: o.z } : {}),
    };
    ids.add(it.id);
    items.push(it);
    if (items.length >= MAX_ITEMS) break;
  }
  const logo = typeof p.logo === 'string' && p.logo.startsWith('data:image/') && p.logo.length <= MAX_LOGO_CHARS ? p.logo : null;
  const logoFit = p.logoFit === 'cover' || p.logoFit === 'stretch' ? p.logoFit : 'contain';
  return {
    v: LAYOUT_VERSION,
    rev: typeof p.rev === 'string' && p.rev ? p.rev : newItemId(),
    items,
    ground: parseGround(p.ground),
    logo,
    logoFit,
  };
}

export const cloneLayout = (l: OfficeLayout): OfficeLayout => ({
  v: 1, rev: l.rev, items: l.items.map((i) => ({ ...i })), ground: l.ground ? [...l.ground] : [...DEFAULT_GROUND], logo: l.logo ?? null, logoFit: l.logoFit ?? 'contain',
});
