import type { Palette, Tile } from './types';

export const TS = 16;
export const MW = 36;
export const MH = 18;
export const BW = MW * TS;
export const BH = MH * TS;

/* ============================================================
   ผังออฟฟิศ (อ่านจากบนลงล่างเหมือน Pokémon Center)

   แถว 0        ผนังหลัง + ของตกแต่งบนผนัง
   แถว 1-5      [ห้องผู้บริหาร] [ห้องประชุม]              [สวน]
   แถว 6-7      เคาน์เตอร์เลขาฯ หน้าห้องประชุม + ล็อบบี้ตราบริษัท
   แถว 8-9      ล็อบบี้ + มุมนั่งเล่นสองฝั่ง
   แถว 10-16    โซนแผนก (พื้นไม้) - แต่ละแผนกได้ "อ่าว" โต๊ะที่โตตามคนที่จ้าง
   แถว 17       ผนังหน้า

   w=ไม้  t=กระเบื้อง  r=พรมห้องประชุม  b=พรมห้องบอส  l=พรมโซนพัก
   #=ผนัง  G=ผนังกระจกห้องบอส (ทึบสำหรับการเดิน)
   g=หญ้า  p=ทางเดินทราย  s=ทราย/ขอบบ่อ  ~=น้ำ
   ============================================================ */
export const GROUND: string[] = [
  '##########################gggggggggg',
  '#bbbbbbbb#rrrrrrrrrrrrrrr#gggggggggg',
  '#bbbbbbbb#rrrrrrrrrrrrrrr#ggppppgggg',
  '#bbbbbbbb#rrrrrrrrrrrrrrr#ggppppgggg',
  '#bbbbbbbb#rrrrrrrrrrrrrrr#gggppggggg',
  '#bbbbbbbbGrrrrrrrrrrrrrrr#gggppggggg',
  // ผนังขวาของล็อบบี้ปิดที่ x=25 ยกเว้นแถว 7-8 เป็นประตูออกสวน
  '#GGGGtGGGGttttttttttttttt#' + 'gggppggggg',
  '#ttttttttttttttttttttttttt' + 'pppppppggg',
  '#ttttttttttttttttttttttttt' + 'pppppppggg',
  '#tttttttttttttttttttttttt#' + 'gggppsssss',
  // แถว 10 = ทางเดินหน้าห้องแผนก  แถว 11 = ผนังห้อง (ประตูตรงกลางห้องละบาน)
  '#tttttttttttttttttttttttt#' + 'gggpps~~~s',
  '##t####t####t####t####t###' + 'gggpps~~~s',
  '#wwww#wwww#wwww#wwww#wwww#' + 'gggppsssss',
  '#wwww#wwww#wwww#wwww#wwww#' + 'ggppppgggg',
  '#wwww#wwww#wwww#wwww#wwww#' + 'ggppppgggg',
  '#wwww#wwww#wwww#wwww#wwww#' + 'gggggggggg',
  '#wwww#wwww#wwww#wwww#wwww#' + 'gggggggggg',
  '##########################gggggggggg',
];

/* ============================================================
   ห้องแผนก - แผนกละห้อง เรียงจากซ้าย ห้องกว้าง 4 ช่องใน (x0..x0+3) ผนัง 1 ช่องคั่น
   ประตูอยู่บนผนังแถว 11 ที่ x0+1 เปิดสู่ทางเดินแถว 10

   ในห้อง: โต๊ะแถวเดียว (y 13 คนนั่ง y 14) 3 ตัวชิดซ้าย เว้นคอลัมน์ขวา x0+3 เป็นทางเดินในห้อง
   แถว 12 ว่างหลังโต๊ะ แถว 15-16 ว่างหน้าโต๊ะ - ห้องไม่แน่น มีที่ให้เดินและวางของมุมห้อง
   คนนั่ง "ใต้โต๊ะ หันขึ้น" หาจอ - จอบนโต๊ะจึงหันหน้ามาทางกล้อง เห็นชัดว่าเป็นโต๊ะคอมพิวเตอร์
   ห้องละ 3 คน x 5 ห้อง = MAX_STAFF 15
   ============================================================ */
export const ROOM_W = 4;
export const ROOM_COUNT = 5;
export const ROOM_X0 = 1;
/** แถวที่โต๊ะตั้ง (คนนั่ง y+1) - แถวเดียวต่อห้อง เว้นที่ด้านหลังและด้านหน้าให้ห้องหายใจ */
export const ROOM_DESK_ROWS = [13] as const;

export interface Room {
  index: number;
  x0: number;
  door: Tile;
  /** ที่นั่ง (ใต้โต๊ะ) */
  seats: Tile[];
  /** กรอบห้องหน่วยช่อง สำหรับป้ายชื่อและกล้อง */
  rect: { x: number; y: number; w: number; h: number };
}

export const ROOMS: Room[] = Array.from({ length: ROOM_COUNT }, (_, i) => {
  const x0 = ROOM_X0 + i * (ROOM_W + 1);
  const seats: Tile[] = [];
  // โต๊ะ 3 ตัวชิดซ้าย (x0..x0+2) เว้นคอลัมน์ขวา x0+3 เป็นทางเดินในห้อง
  for (const y of ROOM_DESK_ROWS) seats.push({ x: x0, y: y + 1 }, { x: x0 + 1, y: y + 1 }, { x: x0 + 2, y: y + 1 });
  return {
    index: i, x0,
    door: { x: x0 + 1, y: 11 },
    seats,
    rect: { x: x0, y: 12, w: ROOM_W, h: 5 },
  };
});

/**
 * แผนกไหนอยู่ห้องไหน - ล็อกตายตัวตามลำดับใน DEPARTMENTS (ห้องแรกซ้ายสุด)
 * จะได้ไม่ย้ายตามลำดับการจ้าง "ห้องกฎหมาย" อยู่ที่เดิมเสมอ
 */
export const ROOM_OF_DEPT: Record<string, number> = {
  legal: 0, finance: 1, engineering: 2, people: 3, marketing: 4,
};

/**
 * ธีมห้องแต่ละแผนก - พื้นห้อง + ของประจำห้องชิ้นเดียวที่มุมขวาล่าง
 * ไม่ติดของบนผนังห้องแล้ว - ห้องเล็ก ยิ่งใส่ยิ่งแออัด ปล่อยให้พื้นสีธีมทำหน้าที่แทน
 * floor เป็นรหัส tile ที่ tileSprite รู้จัก
 */
export interface RoomTheme {
  floor: string;
  /** ของตั้งพื้นมุมขวาล่างของห้อง (x0+3, 16) */
  corner: string;
}
export const ROOM_THEMES: Record<string, RoomTheme> = {
  legal:       { floor: 'L', corner: 'lawshelf' },
  finance:     { floor: 'F', corner: 'safe' },
  engineering: { floor: 'E', corner: 'server' },
  people:      { floor: 'P', corner: 'plant' },
  marketing:   { floor: 'M', corner: 'easel' },
};

/** ทุกที่นั่งในโซนแผนก + เคาน์เตอร์ PR - โควตาพนักงานทั้งบริษัท (PR_SEATS ประกาศด้านล่าง) */
export const DESK_SEATS: Tile[] = [...ROOMS.flatMap((r) => r.seats), { x: 12, y: 7 }, { x: 13, y: 7 }];
export const MAX_STAFF = DESK_SEATS.length;

export function roomOfSeat(t: Tile): Room | null {
  return ROOMS.find((r) => r.seats.some((s) => s.x === t.x && s.y === t.y)) ?? null;
}

/* ============================================================
   ห้องประชุม (x 10..18, y 1..5) - โต๊ะยาว 5 ช่อง เก้าอี้บน 3 ล่าง 3 + หัวโต๊ะ
   ============================================================ */
export const MEET_TABLE = { x0: 13, x1: 20, y0: 3, y1: 3 };
/** โต๊ะยาว 8 ช่อง เก้าอี้บน 6 ล่าง 6 = 12 ที่ + หัวโต๊ะบอส - รองรับหลายแผนกพร้อมกัน */
export const MEET_SEATS: { x: number; y: number; dir: 'up' | 'down' }[] = [
  ...[14, 15, 16, 17, 18, 19].map((x) => ({ x, y: 2, dir: 'down' as const })),
  ...[14, 15, 16, 17, 18, 19].map((x) => ({ x, y: 4, dir: 'up' as const })),
];
/** ที่นั่งหัวโต๊ะของผู้บริหาร - บอสเดินมานั่งตรงนี้เฉพาะตอนมีประชุม */
export const BOSS_SEAT = { x: 12, y: 3, dir: 'right' as const };
export const MEETING_RECT = { x: 9 * TS, y: 0 * TS, w: 17 * TS, h: 8 * TS };

/* ============================================================
   ห้องผู้บริหาร (x 1..8, y 1..5) - ผนังกระจกด้านล่าง ประตูที่ (5,6)
   โต๊ะใหญ่กลางห้อง บอสนั่งหลังโต๊ะหันหน้าลงหาแขก
   ============================================================ */
export const BOSS_HOME = { x: 4, y: 2, dir: 'down' as const };
export const BOSS_DESK: Tile[] = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }];
export const BOSS_ROOM_RECT = { x: 0, y: 0, w: 10 * TS, h: 7 * TS };
export const BOSS_RECT = BOSS_ROOM_RECT;
/** จุดที่แขกยืนรายงานหน้าโต๊ะบอส (ในห้อง) */
export const REPORT_SPOTS: Tile[] = [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 5, y: 4 }];

/* ============================================================
   เลขานุการ - นั่งหลังเคาน์เตอร์หน้าห้องบอส (ใต้ผนังกระจก ข้างประตู) หันหน้าลงหาล็อบบี้
   ============================================================ */
export const SEC_HOME = { x: 2, y: 7, dir: 'down' as const };
export const SEC_COUNTER: Tile[] = [{ x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }];
export const SECRETARY_NAME = 'คุณเมย์';
export const SECRETARY_TITLE = 'เลขานุการ';
/** สีของเลขาฯ - ทองเหลืองให้ต่างจากทุกแผนก จะได้หาเจอบนแผนที่ */
export const SECRETARY_PAL: Palette = {
  skin: '#f8d0a8',
  hair: '#584030',
  shirt: '#c8922f',
  pants: '#4a4038',
  shoes: '#403848',
};

/* ============================================================
   ประชาสัมพันธ์ - เคาน์เตอร์โค้งกลางล็อบบี้ บนตราบริษัท หันหน้าลงรับแขกที่เดินเข้ามา
   เป็นแผนกที่จ้างได้ (agent จริง) แต่ไม่มีห้องแถวล่าง - นั่งตรงนี้แทน 2 ที่
   ============================================================ */
export const PR_SEATS: Tile[] = [{ x: 12, y: 7 }, { x: 13, y: 7 }];
/** เคาน์เตอร์ยาว 6 ช่องหน้าที่นั่ง + แผงหลัง (เครื่องกลางแบบ Pokémon Center) 6 ช่องหลังที่นั่ง */
export const PR_COUNTER: Tile[] = [10, 11, 12, 13, 14, 15].map((x) => ({ x, y: 8 }));
export const PR_BACK: Tile[] = [10, 11, 12, 13, 14, 15].map((x) => ({ x, y: 6 }));

/* ============================================================
   โซนพัก / กลางแจ้ง
   ============================================================ */
/** โซฟารับแขกในล็อบบี้ - ชุดเดียวมุมขวา (มุมซ้ายเป็นเลขา ตรงกลางเป็น PR) */
export const SOFA_SEATS: Tile[] = [{ x: 22, y: 9 }, { x: 23, y: 9 }, { x: 24, y: 9 }];
export const SOFA2_SEATS: Tile[] = [];
/** แพนทรี่ย้ายมาชิดผนังขวาของล็อบบี้ (x 20-24, y 6-7) */
export const COOLER_STAND: Tile = { x: 21, y: 7 };
export const PANTRY_TABLE: Tile[] = [{ x: 22, y: 7 }, { x: 24, y: 7 }];
export const BENCH_SEATS: Tile[] = [{ x: 28, y: 4 }, { x: 31, y: 4 }, { x: 28, y: 12 }];
export const POND_SPOTS: Tile[] = [{ x: 31, y: 10 }, { x: 31, y: 11 }, { x: 30, y: 12 }];
export const IDLE_SPOTS: Tile[] = [
  { x: 6, y: 9 }, { x: 9, y: 9 }, { x: 18, y: 9 }, { x: 12, y: 10 }, { x: 20, y: 10 },
  { x: 29, y: 7 }, { x: 30, y: 14 },
];

export interface MapObject {
  type: string;
  x: number;
  y: number;
  v?: number;
  part?: number;
  back?: boolean;
  top?: boolean; bot?: boolean; left?: boolean; right?: boolean;
}

export const OBJECTS: MapObject[] = [];
const add = (type: string, x: number, y: number, extra: Partial<MapObject> = {}) =>
  OBJECTS.push({ type, x, y, ...extra });

/* ---------- ห้องแผนก: โต๊ะคอมอยู่บน คนนั่งใต้โต๊ะหันขึ้น (เห็นหลังคน เห็นหน้าจอ) ---------- */
DESK_SEATS.forEach((s) => {
  add('workdesk', s.x, s.y - 1, { v: (s.x * 7 + s.y * 3) % 3 });
  add('chair', s.x, s.y, { back: true, v: 3 });
});
// คอลัมน์ขวาของห้อง (x0+2) เป็นทางเดินจากประตูลงมา ห้ามวางของขวางแถว 12-15
// ของประจำห้อง + พื้นห้อง แยกตามธีมแผนก - แผนกไหนอยู่ห้องไหนดู ROOM_OF_DEPT
Object.entries(ROOM_OF_DEPT).forEach(([deptId, ri]) => {
  const room = ROOMS[ri];
  const th = ROOM_THEMES[deptId];
  if (!room || !th) return;
  // ปูพื้นห้องด้วยรหัสของธีม (แถว 12-16 ในห้อง)
  for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
    const row = GROUND[y].split('');
    for (let x = room.x0; x < room.x0 + ROOM_W; x++) row[x] = th.floor;
    GROUND[y] = row.join('');
  }
  // มุมขวาล่างของห้อง - แถว 15-16 ว่างทั้งแถว คนออกจากที่นั่งได้ทุกทาง
  add(th.corner, room.x0 + 3, 16);
});

/* ---------- ห้องประชุม ---------- */
MEET_SEATS.forEach((s) => add('chair', s.x, s.y, { back: s.dir === 'down' }));
add('chair', BOSS_SEAT.x, BOSS_SEAT.y, { back: true });
for (let tx = MEET_TABLE.x0; tx <= MEET_TABLE.x1; tx++) {
  add('table', tx, MEET_TABLE.y0, {
    top: true, bot: true, left: tx === MEET_TABLE.x0, right: tx === MEET_TABLE.x1,
  });
}
add('board', 22, 1); // ไวท์บอร์ดตั้งพื้นท้ายห้อง
add('plant', 10, 1);
add('plant', 24, 1);
add('plant', 10, 5);
add('plant', 24, 5);

/* ---------- ห้องผู้บริหาร ---------- */
BOSS_DESK.forEach((t, i) => add('bossdesk', t.x, t.y, { v: i }));
add('chair', BOSS_HOME.x, BOSS_HOME.y, { back: true, v: 1 });
add('shelf', 1, 1);
add('shelf', 2, 1);
add('cabinet', 7, 1);
add('plant', 8, 1);
add('sofa2', 6, 5, { part: 0, v: 2 });
add('sofa2', 7, 5, { part: 2, v: 2 });
add('pot', 1, 5, { v: 0 });

/* ---------- เคาน์เตอร์เลขาฯ หน้าห้องบอส ---------- */
SEC_COUNTER.forEach((t, i) => add('counter2', t.x, t.y, { part: i }));
add('chair', SEC_HOME.x, SEC_HOME.y, { back: true, v: 2 });
add('palm', 1, 9, { v: 1 });

/* ---------- เคาน์เตอร์ประชาสัมพันธ์ กลางล็อบบี้ ---------- */
PR_COUNTER.forEach((t, i) => add('prcounter', t.x, t.y, { part: i, v: PR_COUNTER.length }));
PR_BACK.forEach((t, i) => add('prback', t.x, t.y, { part: i, v: PR_BACK.length }));
PR_SEATS.forEach((t) => add('chair', t.x, t.y, { back: true, v: 4 }));
add('palm', 9, 6, { v: 0 });
add('palm', 16, 6, { v: 1 });

/* ---------- แพนทรี่ ชิดผนังขวาล็อบบี้ ---------- */
add('counter', 22, 6);
add('counter', 23, 6);
add('cooler', COOLER_STAND.x, COOLER_STAND.y - 1);
add('vending', 24, 6);
add('printer', 20, 6);

/* ---------- โซฟารับแขก มุมขวาล่างล็อบบี้ ---------- */
SOFA_SEATS.forEach((s, i) => add('sofa', s.x, s.y, { part: i, v: 1 }));
add('ctable', 21, 9);
add('vasetable', 24, 10);

/* ---------- โซนกลางแจ้ง ---------- */
BENCH_SEATS.forEach((s) => add('bench', s.x, s.y));
([[26, 0], [28, 0], [30, 0], [32, 0], [34, 0], [35, 0], [29, 1], [33, 1],
  [26, 2], [35, 2], [34, 3], [26, 4], [35, 4], [35, 7], [26, 9], [26, 12], [26, 14],
  [33, 14], [35, 14], [26, 16], [28, 16], [30, 16], [32, 16], [34, 16], [26, 17], [30, 17]] as const)
  .forEach(([x, y]) => add('pine', x, y, { v: (x + y) % 2 }));
([[27, 2], [34, 5], [27, 11], [34, 7], [32, 3], [26, 3], [33, 4], [27, 6], [32, 14]] as const)
  .forEach(([x, y]) => add('bush', x, y));
([[27, 13], [34, 13], [33, 6]] as const).forEach(([x, y]) => add('rock', x, y));
([[27, 5], [32, 5], [27, 9], [32, 13], [34, 2], [26, 11], [35, 3], [27, 14], [32, 4]] as const)
  .forEach(([x, y], i) => add('flower', x, y, { v: i % 3 }));
add('sign', 26, 6);
add('lamp', 28, 6);
add('lamp', 31, 6);

export const WALL_DECOR = [
  // ห้องบอส
  { type: 'frame0', x: 3, y: 0 }, { type: 'clock', x: 5, y: 0 }, { type: 'frame1', x: 6, y: 0 },
  { type: 'window', x: 1, y: 0 },
  // ห้องประชุม (กว้าง x 10..24)
  { type: 'screen', x: 16, y: 0 }, { type: 'screen', x: 17, y: 0 },
  { type: 'board', x: 13, y: 0 }, { type: 'board', x: 14, y: 0 }, { type: 'board', x: 15, y: 0 },
  { type: 'board', x: 18, y: 0 }, { type: 'board', x: 19, y: 0 }, { type: 'board', x: 20, y: 0 },
  { type: 'window', x: 11, y: 0 }, { type: 'window', x: 22, y: 0 }, { type: 'window', x: 23, y: 0 },
  { type: 'hangplant', x: 10, y: 0 }, { type: 'hangplant', x: 24, y: 0 },
  { type: 'clock', x: 12, y: 0 }, { type: 'frame1', x: 21, y: 0 },
];

/** ลวดลายพื้น วาดทับ tile ก่อนวางของ ไม่มีผลกับการเดิน */
export const FLOOR_DECALS = [
  { type: 'emblem' as const, x: 9, y: 9, w: 8, h: 2 },
  { type: 'rug' as const, x: 10, y: 6, w: 6, h: 3, color: '#c85050' },
  { type: 'rug' as const, x: 1, y: 7, w: 4, h: 3, color: '#c8a050' },
  { type: 'rug' as const, x: 21, y: 8, w: 4, h: 2, color: '#c8a888' },
  { type: 'mat' as const, x: 5, y: 6, w: 1, h: 1 },
];

const BLOCKING = new Set([
  'desk', 'workdesk', 'bossdesk', 'table', 'lawshelf', 'safe', 'server', 'easel', 'plant', 'cooler', 'printer', 'shelf', 'cabinet', 'ctable',
  'counter', 'counter2', 'prcounter', 'prback', 'board',
  'pine', 'bush', 'rock', 'sign', 'lamp', 'palm', 'pot', 'vending', 'vasetable', 'sofa2',
]);

export const WALKABLE: boolean[][] = [];
for (let y = 0; y < MH; y++) {
  WALKABLE[y] = [];
  for (let x = 0; x < MW; x++) {
    const c = GROUND[y][x];
    WALKABLE[y][x] = c !== '#' && c !== 'G' && c !== '~';
  }
}
OBJECTS.forEach((o) => {
  if (BLOCKING.has(o.type)) WALKABLE[o.y][o.x] = false;
});

export function tileFree(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MW && y < MH && WALKABLE[y][x];
}

/** BFS 4 ทิศ - คืน path (ไม่รวมช่องเริ่มต้น) หรือ null ถ้าไปไม่ถึง */
export function findPath(sx: number, sy: number, gx: number, gy: number): Tile[] | null {
  if (!tileFree(gx, gy)) return null;
  const start = sy * MW + sx;
  const goal = gy * MW + gx;
  if (start === goal) return [];

  const prev = new Int32Array(MW * MH).fill(-1);
  const seen = new Uint8Array(MW * MH);
  const queue: number[] = [start];
  seen[start] = 1;

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) break;
    const cx = cur % MW;
    const cy = (cur / MW) | 0;
    const nb: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of nb) {
      if (!tileFree(nx, ny)) continue;
      const ni = ny * MW + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (!seen[goal]) return null;

  const path: Tile[] = [];
  let c = goal;
  while (c !== -1 && c !== start) {
    path.push({ x: c % MW, y: (c / MW) | 0 });
    c = prev[c];
  }
  return path.reverse();
}
