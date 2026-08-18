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

/** โควตาพนักงานทั้งบริษัท - ที่นั่งจริงมาจากผังเฟอร์นิเจอร์ (โต๊ะละคน) แต่เพดานคงที่ กันประชุมล้นโต๊ะ/ค่า LLM บาน */
export const MAX_STAFF = 15;

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
  fem: true, // คุณเมย์ - ผมยาว กระโปรง
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
   โซนพัก / กลางแจ้ง - โซฟา ม้านั่ง เครื่องกดน้ำ แพนทรี่ เป็นเฟอร์นิเจอร์ (furniture.ts) world หาตำแหน่งจากผัง
   ============================================================ */
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
  /**
   * ทิศที่คนนั่งบนเก้าอี้ตัวนี้หัน (เก้าอี้เท่านั้น) - พนักพิงอยู่ด้านตรงข้าม
   *   down = พนักพิงอยู่บน (หลังคน)  up = พนักพิงอยู่ล่าง (วาดทับตัวคน)  left/right = พนักพิงด้านข้าง
   */
  dir?: 'up' | 'down' | 'left' | 'right';
  top?: boolean; bot?: boolean; left?: boolean; right?: boolean;
  /** ระดับซ้อนที่ผู้ใช้ตั้ง (หน่วยแถว) - บวก = วาดทีหลัง (ทับ), ลบ = วาดก่อน (อยู่หลัง) */
  zb?: number;
}

/*
 * ไม่มี "ของคงที่" อีกแล้ว - โต๊ะประชุม โต๊ะบอส เคาน์เตอร์เลขาฯ/PR เป็นเฟอร์นิเจอร์ในผังทั้งหมด (furniture.ts)
 * ตัวแผนที่เองก็ทาสีได้: world เรียก setGround() เมื่อผังมี ground ของตัวเอง
 * ค่าคงที่ตำแหน่งด้านบน (BOSS_HOME, MEET_SEATS ฯลฯ) เหลือไว้ใช้สร้างผังเริ่มต้นเท่านั้น
 */

// พื้นห้องแผนกตามธีม (แถว 12-16 ในห้อง) - เป็นค่าเริ่มต้นของแผนที่
Object.entries(ROOM_OF_DEPT).forEach(([deptId, ri]) => {
  const room = ROOMS[ri];
  const th = ROOM_THEMES[deptId];
  if (!room || !th) return;
  for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
    const row = GROUND[y].split('');
    for (let x = room.x0; x < room.x0 + ROOM_W; x++) row[x] = th.floor;
    GROUND[y] = row.join('');
  }
});

/** รหัสพื้นที่เดินไม่ได้ - ผนัง กระจก น้ำ */
const SOLID_GROUND = new Set(['#', 'G', '~']);

/** เดินได้จากตัวแผนที่ล้วน ๆ (ยังไม่รวมเฟอร์นิเจอร์) - คำนวณใหม่ทุกครั้งที่ setGround */
const BASE_WALKABLE: boolean[][] = [];
function rebuildBase() {
  for (let y = 0; y < MH; y++) {
    BASE_WALKABLE[y] = BASE_WALKABLE[y] ?? [];
    for (let x = 0; x < MW; x++) BASE_WALKABLE[y][x] = !SOLID_GROUND.has(GROUND[y][x]);
  }
}
rebuildBase();

/**
 * เปลี่ยนพื้น/ผนังทั้งแผนที่ (จากผังของออฟฟิศ) - แก้ GROUND ในที่ เพราะ art.ts/furniture.ts อ่าน GROUND ตรง ๆ
 * แถวไม่ครบ/สั้นเกินใช้ของเดิมเติม - ผู้เรียกควร parseGround ก่อน
 */
export function setGround(rows: string[]) {
  for (let y = 0; y < MH; y++) {
    const r = rows[y] ?? GROUND[y];
    GROUND[y] = r.length >= MW ? r.slice(0, MW) : r + GROUND[y].slice(r.length);
  }
  rebuildBase();
}

/** ตารางเดินได้จริง - world เรียก rebuildWalkable ทุกครั้งที่ผังเปลี่ยน */
export const WALKABLE: boolean[][] = BASE_WALKABLE.map((row) => [...row]);

/** คำนวณ WALKABLE ใหม่จากฐาน + ช่องที่เฟอร์นิเจอร์ทึบกิน ("x,y") */
export function rebuildWalkable(blocked: Iterable<string>) {
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) WALKABLE[y][x] = BASE_WALKABLE[y][x];
  for (const k of blocked) {
    const [x, y] = k.split(',').map(Number);
    if (y >= 0 && y < MH && x >= 0 && x < MW) WALKABLE[y][x] = false;
  }
}

/** เดินได้ไหมบนตารางที่ระบุ (ใช้ตรวจผังทดลองก่อนบันทึกจริง) */
export function tileFreeOn(grid: boolean[][], x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MW && y < MH && grid[y][x];
}

/** สำเนา BASE_WALKABLE สำหรับตรวจผังทดลอง */
export const baseWalkableCopy = (): boolean[][] => BASE_WALKABLE.map((row) => [...row]);
/** ตารางเดินได้ของ "พื้นทดลอง" (ตอนทาสี) - ยังไม่รวมเฟอร์นิเจอร์ */
export const walkableOfGround = (rows: string[]): boolean[][] =>
  rows.map((r) => Array.from({ length: MW }, (_, x) => !SOLID_GROUND.has(r[x])));

export function tileFree(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MW && y < MH && WALKABLE[y][x];
}

/** BFS 4 ทิศ - คืน path (ไม่รวมช่องเริ่มต้น) หรือ null ถ้าไปไม่ถึง */
export function findPath(sx: number, sy: number, gx: number, gy: number, grid: boolean[][] = WALKABLE): Tile[] | null {
  if (!tileFreeOn(grid, gx, gy)) return null;
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
      if (!tileFreeOn(grid, nx, ny)) continue;
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
