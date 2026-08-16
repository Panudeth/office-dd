import type { Tile } from './types';

export const TS = 16;
export const MW = 34;
export const MH = 16;
export const BW = MW * TS;
export const BH = MH * TS;

/* w=ไม้  t=กระเบื้อง  r=พรมห้องประชุม  l=พรมโซนพัก  #=ผนัง
   g=หญ้า  p=ทางเดินทราย  s=ทราย/ขอบบ่อ  ~=น้ำ */
export const GROUND: string[] = [
  '########################gggggggggg',
  '#wwwwwwwwwwwwww#rrrrrrr#gggggggggg',
  '#wwwwwwwwwwwwww#rrrrrrr#ggppppgggg',
  '#wwwwwwwwwwwwww#rrrrrrr#ggppppgggg',
  '#wwwwwwwwwwwwww#rrrrrrr#gggppggggg',
  '#wwwwwwwwwwwwww#rrrrrrr#gggppggggg',
  '#wwwwwwwwwwwwwwtrrrrrrr#gggppggggg',
  '#ttttttttttttttttttttttt' + 'pppppppggg',
  '#ttttttttttttttttttttttt' + 'pppppppggg',
  '#wwwwwwwwwwwwww#lllllll#gggppsssss',
  '#wwwwwwwwwwwwww#lllllll#gggpps~~~s',
  '#wwwwwwwwwwwwww#lllllll#gggpps~~~s',
  // แถว 12/14 กั้นผนังมุมล่างซ้ายเป็น "ห้องผู้บริหาร" (cols 1-3, rows 13-14)
  // ประตูอยู่ที่ (4,13)
  '#####wwwwwwwwww#lllllll#gggppsssss',
  '#wwwwwwwwwwwwwwtlllllll#ggppppgggg',
  '#www#wwwwwwwwww#lllllll#ggppppgggg',
  '########################gggggggggg',
];

/** โต๊ะทำงาน: ที่นั่งอยู่บน โต๊ะอยู่ล่าง -> พนักงานหันหน้าเข้ากล้อง
 *  จัดเป็น "pod" ละ 2 ที่ แต่ละ pod จะกลายเป็นโซนของแผนกที่มาอยู่ก่อน */
export const PODS: Tile[][] = [
  [{ x: 2, y: 2 }, { x: 3, y: 2 }],
  [{ x: 6, y: 2 }, { x: 7, y: 2 }],
  [{ x: 10, y: 2 }, { x: 11, y: 2 }],
  [{ x: 2, y: 10 }, { x: 3, y: 10 }],
  [{ x: 6, y: 10 }, { x: 7, y: 10 }],
  [{ x: 10, y: 10 }, { x: 11, y: 10 }],
];
export const DESK_SEATS: Tile[] = PODS.flat();

/** ห้องประชุม: โต๊ะอยู่ (18..20, 3..4) */
export const MEET_SEATS: { x: number; y: number; dir: 'up' | 'down' }[] = [
  { x: 18, y: 2, dir: 'down' }, { x: 19, y: 2, dir: 'down' }, { x: 20, y: 2, dir: 'down' },
  { x: 18, y: 5, dir: 'up' }, { x: 19, y: 5, dir: 'up' }, { x: 20, y: 5, dir: 'up' },
];

/** ห้องผู้บริหาร (มุมล่างซ้าย) - บอสนั่งทำงานที่นี่ตอนไม่มีประชุม */
export const BOSS_HOME = { x: 2, y: 13, dir: 'down' as const };
export const BOSS_ROOM_RECT = { x: 0, y: 12 * TS, w: 6 * TS, h: 4 * TS };

/** โต๊ะของผู้ใช้ (ผู้บริหาร) + จุดที่พนักงานมายืนรายงาน */
export const BOSS_DESK: Tile[] = [{ x: 2, y: 14 }, { x: 3, y: 14 }];
/** (11,6) มีกระถางต้นไม้อยู่ - ห้ามใช้เป็นจุดยืนรายงาน */
export const REPORT_SPOTS: Tile[] = [{ x: 13, y: 6 }, { x: 12, y: 6 }, { x: 14, y: 6 }];

/** ที่นั่งหัวโต๊ะของผู้บริหาร - บอสเดินมานั่งตรงนี้เฉพาะตอนมีประชุม */
export const BOSS_SEAT = { x: 17, y: 4, dir: 'right' as const };

/** กรอบสำหรับกล้องอัตโนมัติ (หน่วย base px) */
export const MEETING_RECT = { x: 16 * TS, y: 1 * TS, w: 7 * TS, h: 6 * TS };
export const BOSS_RECT = { x: 10 * TS, y: 4 * TS, w: 5 * TS, h: 3 * TS };

export const SOFA_SEATS: Tile[] = [{ x: 17, y: 12 }, { x: 18, y: 12 }, { x: 19, y: 12 }];
export const COOLER_STAND: Tile = { x: 21, y: 11 };
export const PANTRY_TABLE: Tile[] = [{ x: 17, y: 14 }, { x: 19, y: 14 }];
export const BENCH_SEATS: Tile[] = [{ x: 26, y: 4 }, { x: 29, y: 4 }, { x: 26, y: 10 }];
export const POND_SPOTS: Tile[] = [{ x: 29, y: 10 }, { x: 29, y: 11 }, { x: 28, y: 12 }];
export const IDLE_SPOTS: Tile[] = [
  { x: 5, y: 7 }, { x: 12, y: 8 }, { x: 17, y: 8 }, { x: 2, y: 14 },
  { x: 27, y: 7 }, { x: 28, y: 13 },
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

DESK_SEATS.forEach((s) => {
  add('chair', s.x, s.y);
  add('desk', s.x, s.y + 1, { v: (s.x * 7 + s.y * 3) % 3 });
});
MEET_SEATS.forEach((s) => add('chair', s.x, s.y, { back: s.dir === 'down' }));
add('chair', BOSS_SEAT.x, BOSS_SEAT.y, { back: true });
for (let ty = 3; ty <= 4; ty++) {
  for (let tx = 18; tx <= 20; tx++) {
    add('table', tx, ty, { top: ty === 3, bot: ty === 4, left: tx === 18, right: tx === 20 });
  }
}
BOSS_DESK.forEach((t, i) => add('bossdesk', t.x, t.y, { v: i }));
add('chair', BOSS_HOME.x, BOSS_HOME.y);
SOFA_SEATS.forEach((s, i) => add('sofa', s.x, s.y, { part: i }));
add('ctable', 18, 13);
add('cooler', 21, 10);
add('printer', 16, 10);
add('shelf', 13, 9);
add('counter', 18, 14);
([[13, 1], [11, 6], [1, 6], [16, 1], [22, 6], [16, 14], [22, 9], [1, 14]] as const)
  .forEach(([x, y]) => add('plant', x, y));

/* ---------- โซนกลางแจ้ง ---------- */
BENCH_SEATS.forEach((s) => add('bench', s.x, s.y));
([[24, 0], [26, 0], [28, 0], [30, 0], [32, 0], [33, 0], [27, 1], [31, 1],
  [24, 2], [33, 2], [32, 3], [24, 4], [33, 4], [33, 7], [24, 9], [24, 12], [24, 14],
  [31, 14], [33, 14], [24, 15], [26, 15], [28, 15], [30, 15], [32, 15]] as const)
  .forEach(([x, y]) => add('pine', x, y, { v: (x + y) % 2 }));
([[25, 2], [32, 5], [25, 11], [32, 7], [30, 3], [24, 3], [31, 4], [25, 6], [30, 14]] as const)
  .forEach(([x, y]) => add('bush', x, y));
([[25, 13], [32, 13], [31, 6]] as const).forEach(([x, y]) => add('rock', x, y));
([[25, 5], [30, 5], [25, 9], [30, 13], [32, 2], [24, 11], [33, 3], [25, 14], [30, 4]] as const)
  .forEach(([x, y], i) => add('flower', x, y, { v: i % 3 }));
add('sign', 24, 6);
add('lamp', 26, 6);
add('lamp', 29, 6);

export const WALL_DECOR = [
  { type: 'board', x: 18, y: 0 }, { type: 'board', x: 19, y: 0 }, { type: 'board', x: 20, y: 0 },
  { type: 'window', x: 3, y: 0 }, { type: 'window', x: 4, y: 0 },
  { type: 'window', x: 9, y: 0 }, { type: 'window', x: 10, y: 0 },
  { type: 'clock', x: 7, y: 0 },
];

const BLOCKING = new Set([
  'desk', 'bossdesk', 'table', 'plant', 'cooler', 'printer', 'shelf', 'ctable', 'counter',
  'pine', 'bush', 'rock', 'sign', 'lamp',
]);

export const WALKABLE: boolean[][] = [];
for (let y = 0; y < MH; y++) {
  WALKABLE[y] = [];
  for (let x = 0; x < MW; x++) {
    const c = GROUND[y][x];
    WALKABLE[y][x] = c !== '#' && c !== '~';
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
