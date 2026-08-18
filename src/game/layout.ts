import { GROUND, MH, MW, baseWalkableCopy, findPath, rebuildWalkable, setGround, tileFreeOn, walkableOfGround, type MapObject } from './map';
import type { FloorDecal } from './art';
import {
  FURN, VEC, footprint, isFloor, isIndoor, isWall, seatOf, standSpot, tileSpec,
  type FootTile, type FurnKind, type LayoutItem, type OfficeLayout,
} from './furniture';
import type { Dir, Tile } from './types';

/* ============================================================
   สถานะผัง (พื้น + ของทุกชิ้น) + ดัชนี + กฎ
   world ถือ instance เดียว - ทุกอย่างที่ต้อง "รู้ว่ามีอะไรอยู่ตรงไหน" ถามที่นี่
   ============================================================ */

export const key = (x: number, y: number) => `${x},${y}`;
export const parseKey = (k: string): Tile => { const [x, y] = k.split(',').map(Number); return { x, y }; };

export interface Verdict {
  ok: boolean;
  /** เหตุผลสั้น ๆ ให้ UI โชว์ตอนวางไม่ได้ */
  reason: string | null;
  /** ช่องที่เป็นปัญหา (ไฮไลต์แดง) */
  bad: Set<string>;
}

export interface SeatSpot { x: number; y: number; dir: Dir; item: LayoutItem }
export interface Rect { x: number; y: number; w: number; h: number }

const ok = (): Verdict => ({ ok: true, reason: null, bad: new Set() });

/** ที่นั่งประชุม = เก้าอี้ (ไม่ใช่หัวโต๊ะ) ที่หันเข้าหาโต๊ะประชุม */
const facesKind = (it: LayoutItem, kind: FurnKind, tileKinds: Map<string, FurnKind>): boolean => {
  const s = seatOf(it);
  if (!s) return false;
  const v = VEC[s.dir];
  return tileKinds.get(key(s.x + v.x, s.y + v.y)) === kind;
};

export class LayoutState {
  layout: OfficeLayout;
  /** ช่อง -> ชิ้นของจริง (obj/seat) */
  private objAt = new Map<string, LayoutItem>();
  private wallAt = new Map<string, LayoutItem>();
  private decalAt = new Map<string, LayoutItem>();
  private ghostAt = new Map<string, LayoutItem>();
  /** ช่อง -> ชนิดของชิ้นที่กินช่อง (obj) - ใช้หา "เก้าอี้หันเข้าโต๊ะอะไร" */
  private kindAt = new Map<string, FurnKind>();
  /** สิ่งที่ต้องวาด แยกชั้น */
  objs: MapObject[] = [];
  decals: FloorDecal[] = [];
  /** id ของชิ้นที่แต่ละ decal มาจาก (ลำดับเดียวกับ decals) */
  decalOwners: string[] = [];
  wallDecor: { type: string; x: number; y: number; w?: number; h?: number }[] = [];
  /** ช่องทึบจากเฟอร์นิเจอร์ */
  solids = new Set<string>();

  constructor(layout: OfficeLayout) {
    this.layout = layout;
    this.index();
  }

  set(layout: OfficeLayout) {
    this.layout = layout;
    this.index();
  }

  /** ใช้พื้นของผัง + สร้างดัชนีใหม่ + อัปเดตตารางเดินได้ */
  index() {
    if (this.layout.ground) setGround(this.layout.ground);
    this.objAt.clear(); this.wallAt.clear(); this.decalAt.clear(); this.ghostAt.clear(); this.kindAt.clear();
    this.objs = []; this.decals = []; this.decalOwners = []; this.wallDecor = [];
    const decalRows: { d: FloorDecal; z: number; id: string }[] = [];
    this.solids.clear();
    for (const it of this.layout.items) {
      const spec = FURN[it.kind];
      for (const ft of footprint(it)) {
        const k = key(ft.x, ft.y);
        if (spec.ghost) { this.ghostAt.set(k, it); continue; }
        if (spec.decal) {
          // ซ้อนกันได้ - คลิกให้โดนชิ้นที่อยู่บนสุด (z มากกว่า)
          const cur = this.decalAt.get(k);
          if (!cur || this.zOf(it) >= this.zOf(cur)) this.decalAt.set(k, it);
          if (ft.decal) decalRows.push({ d: ft.decal, z: this.zOf(it), id: it.id });
          continue;
        }
        if (ft.layer === 'wall') { this.wallAt.set(k, it); if (ft.wall) this.wallDecor.push({ type: ft.wall, x: ft.x, y: ft.y, ...(ft.wallRect ?? {}) }); continue; }
        this.objAt.set(k, it);
        this.kindAt.set(k, it.kind);
        if (ft.obj) this.objs.push(typeof it.z === 'number' && it.z !== 0 ? { ...ft.obj, zb: it.z } : ft.obj);
        if (ft.solid) this.solids.add(k);
      }
    }
    // ชั้นพื้นวาดเรียงตาม z (ผู้ใช้จัดได้) - ค่าเริ่มต้นตามชนิด: พรม < พรมเช็ดเท้า/ทางเข้า < ตรา < โลโก้
    decalRows.sort((a, b) => a.z - b.z);
    this.decals = decalRows.map((r) => r.d);
    this.decalOwners = decalRows.map((r) => r.id);
    rebuildWalkable(this.solids);
  }

  /** z ของชิ้นชั้นพื้น - ตั้งเองมาก่อน ไม่งั้นตามชนิด */
  zOf(it: LayoutItem): number {
    if (typeof it.z === 'number') return it.z;
    return ({ rug_l: 0, rug_m: 0, rug_s: 0, mat: 1, entrance: 1, emblem: 2, logo: 3 } as Record<string, number>)[it.kind] ?? 0;
  }
  /** ชิ้นชั้นพื้นทั้งหมดเรียงจากล่างขึ้นบน */
  decalItems(): LayoutItem[] {
    return this.layout.items.filter((i) => FURN[i.kind].decal).sort((a, b) => this.zOf(a) - this.zOf(b));
  }
  get items() { return this.layout.items; }
  get ground(): string[] { return this.layout.ground ?? GROUND.map((r) => r); }
  item(id: string): LayoutItem | null { return this.layout.items.find((i) => i.id === id) ?? null; }
  /** ชิ้นที่คลิกโดนที่ช่องนี้ - ของจริงก่อน แล้วของบนผนัง พรม ป้าย */
  at(x: number, y: number): LayoutItem | null {
    const k = key(x, y);
    return this.objAt.get(k) ?? this.wallAt.get(k) ?? this.decalAt.get(k) ?? this.ghostAt.get(k) ?? null;
  }
  kindAtTile(x: number, y: number): FurnKind | null { return this.kindAt.get(key(x, y)) ?? null; }
  /** ทุกชิ้นที่ซ้อนกันบนช่องนี้ จากบนลงล่าง (ของ > บนผนัง > พรม/ตราทุกชั้น > ป้าย) - คลิกซ้ำเพื่อวนเลือก */
  allAt(x: number, y: number): LayoutItem[] {
    const k = key(x, y);
    const out: LayoutItem[] = [];
    const push = (it: LayoutItem | undefined | null) => { if (it && !out.includes(it)) out.push(it); };
    push(this.objAt.get(k)); push(this.wallAt.get(k));
    for (const it of [...this.decalItems()].reverse()) if (footprint(it).some((f) => f.x === x && f.y === y)) push(it);
    push(this.ghostAt.get(k));
    return out;
  }

  /* ---------- ที่นั่ง / บทบาท ---------- */

  /** ชิ้นที่มีที่นั่ง (เก้าอี้/โต๊ะทำงาน/โซฟา/ม้านั่ง) */
  seatItems(): LayoutItem[] { return this.layout.items.filter((i) => !!seatOf(i)); }
  /** ที่นั่งประจำของคนนี้ (เก้าอี้หรือโต๊ะทำงานที่ owner เป็นเขา) */
  seatItemOf(owner: string): LayoutItem | null {
    return this.layout.items.find((i) => (i.kind === 'desk' || i.kind === 'chair') && i.owner === owner) ?? null;
  }
  homeSeat(owner: string): { x: number; y: number; dir: Dir } | null {
    const it = this.seatItemOf(owner);
    return it ? seatOf(it) : null;
  }
  desks(): LayoutItem[] { return this.layout.items.filter((i) => i.kind === 'desk'); }
  /** โต๊ะทำงาน/เก้าอี้ว่าง (ไม่นับเก้าอี้ประชุม/PR/หัวโต๊ะ) */
  freeWorkSeats(): LayoutItem[] {
    return this.layout.items.filter((i) => (i.kind === 'desk' || (i.kind === 'chair' && !this.isRoleChair(i))) && !i.owner);
  }
  /** เก้าอี้ที่มีบทบาทเฉพาะ: ประชุม (หันเข้าโต๊ะประชุม/หัวโต๊ะ) หรือ PR (หันเข้าเคาน์เตอร์ PR) */
  isRoleChair(it: LayoutItem): boolean {
    if (it.kind !== 'chair') return false;
    return it.tag === 'meethead' || facesKind(it, 'meettable', this.kindAt) || facesKind(it, 'prcounter', this.kindAt);
  }
  meetSeats(): SeatSpot[] {
    return this.layout.items
      .filter((i) => i.kind === 'chair' && i.tag !== 'meethead' && facesKind(i, 'meettable', this.kindAt))
      .map((i) => ({ ...seatOf(i)!, item: i }));
  }
  headSeat(): SeatSpot | null {
    const it = this.layout.items.find((i) => i.kind === 'chair' && i.tag === 'meethead');
    return it ? { ...seatOf(it)!, item: it } : null;
  }
  /** เก้าอี้ PR (หันเข้าเคาน์เตอร์ PR) */
  prSeats(): SeatSpot[] {
    return this.layout.items.filter((i) => i.kind === 'chair' && facesKind(i, 'prcounter', this.kindAt)).map((i) => ({ ...seatOf(i)!, item: i }));
  }
  isPrSeat(t: Tile): boolean { return this.prSeats().some((s) => s.x === t.x && s.y === t.y); }
  /** จุดที่แขกยืนคุยกับคน PR: พ้นเคาน์เตอร์ไป 1 ช่อง */
  prGuestSpot(seat: { x: number; y: number; dir: Dir }): Tile { const v = VEC[seat.dir]; return { x: seat.x + v.x * 2, y: seat.y + v.y * 2 }; }
  /** จุดยืนรายงานหน้าโต๊ะบอส - ช่องใต้โต๊ะบอส (แขกหันขึ้นหาบอส) */
  reportSpots(): Tile[] {
    const out: Tile[] = [];
    for (const it of this.layout.items) if (it.kind === 'bossdesk') for (let i = 0; i < 3; i++) out.push({ x: it.x + i, y: it.y + 1 });
    return out;
  }
  entrance(): Tile | null {
    const it = this.layout.items.find((i) => i.kind === 'entrance');
    return it ? { x: it.x, y: it.y } : null;
  }
  deptSigns(): { dept: string; x: number; y: number; text?: string }[] {
    return this.layout.items.filter((i) => i.kind === 'deptsign' && i.dept).map((i) => ({ dept: i.dept!, x: i.x, y: i.y, ...(i.text ? { text: i.text } : {}) }));
  }
  /** ที่นั่งเล่น (โซฟา/เก้าอี้ที่ไม่มีบทบาทและไม่มีเจ้าของ) */
  loungeSeats(): SeatSpot[] {
    const out: SeatSpot[] = [];
    for (const it of this.layout.items) {
      if (it.kind === 'sofa' || (it.kind === 'chair' && !it.owner && !this.isRoleChair(it))) {
        for (const ft of footprint(it)) if (ft.seat) out.push({ x: ft.x, y: ft.y, dir: ft.seat, item: it });
      }
    }
    return out;
  }
  benchSeats(): SeatSpot[] {
    const out: SeatSpot[] = [];
    for (const it of this.layout.items) if (it.kind === 'bench') for (const ft of footprint(it)) if (ft.seat) out.push({ x: ft.x, y: ft.y, dir: ft.seat, item: it });
    return out;
  }
  /** จุดยืนหน้าของชนิดนี้ (cooler = กดน้ำ, counter = กินข้าว) */
  spots(kind: FurnKind): Tile[] {
    return this.layout.items.filter((i) => i.kind === kind).map(standSpot).filter((t): t is Tile => !!t);
  }
  /** จุดชมบ่อน้ำ - ช่องเดินได้ที่ติดน้ำ */
  pondSpots(): Tile[] {
    const out: Tile[] = [];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (GROUND[y][x] === '~' || !isFloor(x, y)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => GROUND[y + dy]?.[x + dx] === '~')) out.push({ x, y });
    }
    return out;
  }
  /** กรอบห้องประชุม (โต๊ะ+เก้าอี้ประชุม ขยายขอบ) หน่วย px - กล้องใช้ */
  meetRect(): Rect | null { return this.rectOf(this.layout.items.filter((i) => i.kind === 'meettable' || (i.kind === 'chair' && (i.tag === 'meethead' || facesKind(i, 'meettable', this.kindAt)))), 2); }
  bossRect(): Rect | null { return this.rectOf(this.layout.items.filter((i) => i.kind === 'bossdesk' || (i.kind === 'chair' && i.owner === 'boss')), 3); }
  private rectOf(items: LayoutItem[], pad: number): Rect | null {
    if (!items.length) return null;
    let x0 = MW, y0 = MH, x1 = 0, y1 = 0;
    for (const it of items) for (const f of footprint(it)) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x); y1 = Math.max(y1, f.y); }
    return { x: (x0 - pad) * 16, y: (y0 - pad) * 16, w: (x1 - x0 + 1 + pad * 2) * 16, h: (y1 - y0 + 1 + pad * 2) * 16 };
  }

  /* ---------- กฎ ---------- */

  /**
   * ตรวจผังทดลอง (items ทั้งชุด บนพื้นที่ระบุ) - ผ่านแล้วรับประกันว่า:
   *   ทุกชิ้นอยู่บนพื้นที่ถูกชนิด / ไม่ทับกัน / ไม่ทับคนที่ยืนอยู่ (ยกเว้นเจ้าของที่นั่งที่กำลังย้าย)
   *   มีทางเข้า 1 จุด, บอสกับเลขาฯ มีที่นั่ง, มีโต๊ะประชุม+เก้าอี้ประชุม ≥ 2
   *   และทุกที่นั่ง+จุดสำคัญ เดินถึงได้จากทางเข้า (ไม่มีใครติด ไม่มีห้องถูกปิดตาย)
   * @param occupied ช่องที่มีคนยืน/นั่งอยู่ ("x,y") - Set ว่างถ้าไม่สนคน (ตอนนับที่ว่างเฉย ๆ)
   * @param focusId ชิ้นที่กำลังแก้ - ปัญหาของชิ้นอื่นไม่โทษ (ไฮไลต์เฉพาะชิ้นนี้)
   * @param ground พื้นทดลอง (ตอนทาสี) - ไม่ส่ง = พื้นปัจจุบัน
   */
  validate(items: LayoutItem[], occupied: Set<string>, focusId?: string | null, ignoreEmployeeTile?: string | null, ground?: string[]): Verdict {
    const bad = new Set<string>();
    const fail = (reason: string): Verdict => ({ ok: false, reason, bad });
    const g = ground ?? this.ground;
    const floorAt = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH && (tileSpec(g[y][x])?.walkable ?? false);
    const indoorAt = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH && (tileSpec(g[y][x])?.indoor ?? false);
    const wallAt = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH && (g[y][x] === '#' || g[y][x] === 'G');
    const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MW && y < MH;
    const focus = focusId ? items.find((i) => i.id === focusId) ?? null : null;
    const focusTiles = focus ? new Set(footprint(focus).map((f) => key(f.x, f.y))) : null;
    const blame = (t: Tile, itemId: string) => (!focus || itemId === focusId || focusTiles!.has(key(t.x, t.y)));
    const mark = (t: Tile) => bad.add(key(t.x, t.y));

    const seenObj = new Map<string, string>();
    const seenDecal = new Map<string, string>();
    const seenGhost = new Map<string, string>();
    const kindAt = new Map<string, FurnKind>();
    const solidsNew: Tile[] = [];
    let entrances = 0, meettables = 0;
    const owners = new Map<string, number>();

    for (const it of items) {
      const spec = FURN[it.kind];
      if (it.kind === 'entrance') entrances++;
      if (it.kind === 'meettable') meettables++;
      if ((it.kind === 'desk' || it.kind === 'chair') && it.owner) owners.set(it.owner, (owners.get(it.owner) ?? 0) + 1);
      for (const ft of footprint(it)) {
        const k = key(ft.x, ft.y);
        const t = { x: ft.x, y: ft.y };
        if (!inMap(ft.x, ft.y)) { if (blame(t, it.id)) { mark(t); return fail('เกินขอบแผนที่'); } continue; }
        if (spec.ghost) {
          if (!floorAt(ft.x, ft.y) && !wallAt(ft.x, ft.y)) { if (blame(t, it.id)) { mark(t); return fail('ป้ายต้องอยู่บนพื้นหรือผนัง'); } }
          const o = seenGhost.get(k);
          if (o && blame(t, it.id)) { mark(t); return fail('ทับป้ายอื่น'); }
          seenGhost.set(k, it.id);
          continue;
        }
        if (spec.wallOnly) {
          if (!wallAt(ft.x, ft.y)) { if (blame(t, it.id)) { mark(t); return fail('ของบนผนังต้องวางบนช่องผนัง'); } }
          const o = seenObj.get(k);
          if (o && blame(t, it.id)) { mark(t); return fail('ทับของชิ้นอื่น'); }
          seenObj.set(k, it.id);
          continue;
        }
        if (!floorAt(ft.x, ft.y)) { if (blame(t, it.id)) { mark(t); return fail('วางตรงนี้ไม่ได้ (ไม่ใช่พื้น)'); } }
        if (spec.indoorOnly && !indoorAt(ft.x, ft.y)) { if (blame(t, it.id)) { mark(t); return fail('โต๊ะทำงานต้องอยู่ในอาคาร'); } }
        if (spec.decal) {
          // พรม/ตรา/โลโก้ซ้อนกันได้ (วาดเรียงชั้น: พรม < ตรา < โลโก้) - แค่ต้องอยู่บนพื้น
          seenDecal.set(k, it.id);
          continue;
        }
        const o = seenObj.get(k);
        if (o && (blame(t, it.id) || o === focusId)) { mark(t); return fail('ทับของชิ้นอื่น'); }
        seenObj.set(k, it.id);
        kindAt.set(k, it.kind);
        if (ft.solid) {
          solidsNew.push(t);
          if (occupied.has(k) && k !== ignoreEmployeeTile && blame(t, it.id)) { mark(t); return fail('มีคนยืนอยู่ตรงนั้น'); }
        }
      }
    }

    // ---- ของที่ต้องมี / มีได้ชิ้นเดียว ----
    for (const [kind, spec] of Object.entries(FURN)) {
      if (spec.single && items.filter((i) => i.kind === kind).length > 1) return fail(`${spec.label} มีได้ชิ้นเดียว`);
    }
    if (entrances !== 1) return fail(entrances === 0 ? 'ต้องมี "ทางเข้า" 1 จุด (แขกเดินเข้าตรงนี้)' : 'ทางเข้ามีได้จุดเดียว');
    for (const who of ['boss', 'secretary'] as const) {
      const n = owners.get(who) ?? 0;
      if (n !== 1) return fail(n === 0 ? `${who === 'boss' ? 'ผู้บริหาร' : 'เลขาฯ'}ต้องมีที่นั่ง 1 ตัว (เก้าอี้ที่ตั้ง "คนนั่ง" เป็นเขา)` : `${who === 'boss' ? 'ผู้บริหาร' : 'เลขาฯ'}มีที่นั่งได้ตัวเดียว`);
    }
    for (const [who, n] of owners) if (n > 1 && who !== 'boss' && who !== 'secretary') return fail('คนเดียวมีที่นั่งประจำได้ตัวเดียว');
    if (meettables < 1) return fail('ต้องมีโต๊ะประชุมอย่างน้อย 1 ตัว');
    const meetChairs = items.filter((i) => i.kind === 'chair' && i.tag !== 'meethead' && facesKind(i, 'meettable', kindAt)).length;
    if (meetChairs < 2) return fail('โต๊ะประชุมต้องมีเก้าอี้หันเข้าหาอย่างน้อย 2 ตัว');

    // ---- ตารางเดินได้ของผังทดลอง ----
    const grid = ground ? walkableOfGround(g) : baseWalkableCopy();
    for (const t of solidsNew) grid[t.y][t.x] = false;

    // ---- จุดสำคัญ: ที่นั่งทุกตัว, จุดยืนหน้าเครื่อง, ทางเข้า, หน้าโต๊ะบอส (อย่างน้อย 1), หน้าเคาน์เตอร์ PR ----
    const important: Tile[] = [];
    let entranceTile: Tile | null = null;
    const reportSpots: Tile[] = [];
    for (const it of items) {
      if (it.kind === 'entrance') entranceTile = { x: it.x, y: it.y };
      if (it.kind === 'bossdesk') for (let i = 0; i < 3; i++) reportSpots.push({ x: it.x + i, y: it.y + 1 });
      for (const ft of footprint(it)) if (ft.seat) important.push({ x: ft.x, y: ft.y });
      const sp = standSpot(it);
      if (sp) important.push(sp);
      if (it.kind === 'chair' && facesKind(it, 'prcounter', kindAt)) important.push(this.prGuestSpot(seatOf(it)!));
    }
    if (entranceTile) important.push(entranceTile);
    for (const t of important) {
      if (!tileFreeOn(grid, t.x, t.y)) { mark(t); return fail('ปิดทับจุดที่ต้องว่าง (ที่นั่ง/หน้าเครื่อง/หน้าเคาน์เตอร์/ทางเข้า)'); }
    }
    const reach = reachableFrom(grid, entranceTile!);
    for (const t of important) {
      if (!reach.has(key(t.x, t.y))) { mark(t); return fail('ปิดทางเดิน - จะมีที่นั่งหรือจุดสำคัญที่เดินไปไม่ถึงจากทางเข้า'); }
    }
    if (reportSpots.length && !reportSpots.some((t) => tileFreeOn(grid, t.x, t.y) && reach.has(key(t.x, t.y)))) {
      reportSpots.forEach(mark);
      return fail('หน้าโต๊ะผู้บริหารต้องมีที่ยืนรายงานว่างอย่างน้อย 1 ช่อง (แถวใต้โต๊ะ)');
    }
    return ok();
  }

  /** ทาสีช่อง (x,y) เป็น code - ตรวจว่าของบนช่องยังถูกชนิด และทุกอย่างยังเดินถึง */
  validatePaint(x: number, y: number, code: string, occupied: Set<string>): Verdict {
    if (!tileSpec(code) || x < 0 || y < 0 || x >= MW || y >= MH) return { ok: false, reason: 'ระบายตรงนี้ไม่ได้', bad: new Set([key(x, y)]) };
    const rows = this.ground.map((r) => r);
    rows[y] = rows[y].slice(0, x) + code + rows[y].slice(x + 1);
    const walk = tileSpec(code)!.walkable;
    if (!walk && occupied.has(key(x, y))) return { ok: false, reason: 'มีคนยืนอยู่ตรงนั้น', bad: new Set([key(x, y)]) };
    // บอกให้ชัดว่าติดของชิ้นไหน (ดีกว่า "ไม่ใช่พื้น" เฉย ๆ)
    const k = key(x, y);
    const onTile = this.objAt.get(k) ?? this.decalAt.get(k) ?? this.ghostAt.get(k) ?? null;
    if (!walk && onTile) return { ok: false, reason: `มี${FURN[onTile.kind].label}วางอยู่ - ย้ายของออกก่อน`, bad: new Set([k]) };
    const wallItem = this.wallAt.get(k);
    if (walk && wallItem) return { ok: false, reason: `มี${FURN[wallItem.kind].label}ติดผนังอยู่ - ย้ายออกก่อน`, bad: new Set([k]) };
    return this.validate(this.layout.items, occupied, null, null, rows);
  }
  withPaint(x: number, y: number, code: string): string[] {
    const rows = this.ground.map((r) => r);
    rows[y] = rows[y].slice(0, x) + code + rows[y].slice(x + 1);
    return rows;
  }

  /** ผังทดลองที่ชิ้น id ถูกย้าย/หมุน */
  withMoved(id: string, x: number, y: number, dir?: Dir): LayoutItem[] {
    return this.layout.items.map((i) => (i.id === id ? { ...i, x, y, ...(dir ? { dir } : {}) } : i));
  }
  withAdded(it: LayoutItem): LayoutItem[] { return [...this.layout.items, it]; }
  withRemoved(id: string): LayoutItem[] { return this.layout.items.filter((i) => i.id !== id); }
}

/** ช่องที่เดินถึงได้จากจุดเริ่ม บนตารางที่ให้ */
export function reachableFrom(grid: boolean[][], from: Tile): Set<string> {
  const out = new Set<string>();
  if (!tileFreeOn(grid, from.x, from.y)) return out;
  const q: Tile[] = [from];
  out.add(key(from.x, from.y));
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!tileFreeOn(grid, nx, ny)) continue;
      const k = key(nx, ny);
      if (out.has(k)) continue;
      out.add(k);
      q.push({ x: nx, y: ny });
    }
  }
  return out;
}

/** มีเส้นทางเดินจาก a ไป b บนตารางปัจจุบันไหม */
export const canReach = (a: Tile, b: Tile) => findPath(a.x, a.y, b.x, b.y) !== null;

export { isFloor, isIndoor, isWall, type FootTile };
