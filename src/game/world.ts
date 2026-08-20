import { DEPT_BY_ID, ROLES, ROLE_ORDER, type Department } from '@/lib/departments';
import { decalSprite, decorSprite, drawBubble, mk, objSprite, shade, tileSprite, type Surface } from './art';
import { DIRS, GADGETS, buildAtlas, drawGadget, makePalette } from './character';
import { getLang, t } from '@/lib/i18n';
import {
  BH, BOSS_HOME, BW, GROUND, MAX_STAFF, MH, MW, SECRETARY_NAME, SECRETARY_PAL, SECRETARY_TITLE, SEC_HOME,
  TS, findPath, tileFree, type MapObject,
} from './map';
import {
  FURN, MAX_LOGO_CHARS, MAX_SIGN_TEXT, VEC, cloneLayout, defaultLayout, flipDir, footprint, isIndoor, newItemId, nextDir, seatOf, tileSpec,
  type FurnKind, type LayoutItem, type OfficeLayout,
} from './furniture';
import { LayoutState, key, type Rect, type Verdict } from './layout';
import type {
  AgentState, BubbleIcon, Dir, Employee, EmployeeSnapshot, Palette, PersistedEmployee, Pose, Tile,
} from './types';

/** สาเหตุที่ผังเปลี่ยน - หน้าเว็บใช้ตัดสินว่าต้องบันทึกไหม (sync = มาจากเครื่องอื่น ไม่ต้องบันทึกซ้ำ) */
export type LayoutCause = 'user' | 'hire' | 'restore' | 'sync';

/** สิ่งที่แผงจัดออฟฟิศต้องรู้ - world ส่งให้ทุกครั้งที่เปลี่ยน */
export interface EditSnapshot {
  on: boolean;
  selected: {
    id: string; kind: FurnKind; label: string; dir: Dir | null; owner: string | null; dept: string | null;
    /** ป้ายแผนก: ข้อความบนป้าย (ไม่ได้ตั้ง = null) + ข้อความเริ่มต้นที่จะแสดง */
    signText: { value: string | null; fallback: string } | null;
    rotates: boolean; canOwn: boolean; canDelete: boolean;
    /** ขนาดปัจจุบัน + ขอบเขต (เฉพาะชิ้นที่ย่อ/ขยายได้ เช่นโลโก้) */
    size: { w: number; h: number; minW: number; maxW: number; minH: number; maxH: number } | null;
    /** ชั้นพื้น (พรม/ตรา/โลโก้) - จัดลำดับซ้อนได้: ตำแหน่งจากล่าง (0) และจำนวนทั้งหมด */
    zOrder: { index: number; total: number } | null;
    /** ของทั่วไป - ระดับซ้อนเทียบของแถวเดียวกัน (-3..3, 0 = ตามความลึกจริง) */
    depth: number | null;
  } | null;
  /** กำลังถือของใหม่รอวาง */
  placing: FurnKind | null;
  /** กำลังทาสีพื้น (รหัส tile) */
  painting: string | null;
  /** เครื่องมือปัจจุบัน: เลือก/ย้าย, วางของใหม่, ระบายพื้น */
  tool: 'select' | 'place' | 'paint';
  logo: string | null;
  logoFit: 'contain' | 'cover' | 'stretch';
  /** ข้อความล่าสุด (เช่นวางไม่ได้เพราะอะไร) */
  message: string | null;
  itemCount: number;
}

const NAMES = [
  'ต้น', 'แนน', 'เอิร์ธ', 'ฟ้า', 'บอส', 'มิ้น', 'กาย', 'ปอ', 'แจ็ค', 'นุ่น',
  'โอ๊ต', 'พลอย', 'เบส', 'ใบเตย', 'กิ๊ฟ', 'ตูน',
];
/** ชื่อเล่นที่อ่านเป็นผู้หญิง - ให้หน้าตาตรงกับชื่อ (ผมยาว กระโปรง) พนักงานเก่าที่ยังไม่มี fem ใน palette ก็ใช้ตัวนี้ */
const FEM_NAMES = new Set(['แนน', 'ฟ้า', 'มิ้น', 'ปอ', 'นุ่น', 'พลอย', 'ใบเตย', 'กิ๊ฟ', 'ตูน']);
/** ชื่อเล่นอังกฤษ - ใช้ตอนภาษา UI เป็น EN คนจ้างใหม่จะได้ชื่อจากชุดนี้ (คนเก่าชื่อเดิม ไม่แปลง) */
const NAMES_EN = [
  'Ton', 'Nan', 'Earth', 'Fah', 'Boss', 'Mint', 'Guy', 'Por', 'Jack', 'Noon',
  'Oat', 'Ploy', 'Bass', 'Baitoey', 'Gift', 'Toon',
];
const FEM_NAMES_EN = new Set(['Nan', 'Fah', 'Mint', 'Por', 'Noon', 'Ploy', 'Baitoey', 'Gift', 'Toon']);

const STATE_TH: Record<AgentState, string> = {
  work: 'ทำงาน', walk: 'กำลังเดิน', meet: 'ประชุม', think: 'กำลังถกกัน',
  report: 'มารายงาน', coffee: 'ชงกาแฟ', eat: 'กินข้าว', lounge: 'นั่งเล่น',
  bench: 'นั่งสวน', pond: 'ชมบ่อน้ำ', chat: 'คุยกัน', smoke: 'สูบบุหรี่', idle: 'ยืนเล่น',
};
export const stateLabel = (s: AgentState) => t(STATE_TH[s] ?? s);
/** ชื่อที่วาดบนจอ - บอส/เลขาฯ/แขก ชื่อเป็นคำทั่วไปแปลได้ ส่วนชื่อเล่นพนักงานคงเดิม */
const dispName = (e: Employee) => (e.isBoss || e.isSecretary || e.isVisitor ? t(e.name) : e.name);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const dist2 = (a: Tile, b: Tile) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** ช่องบนเส้นตรงจาก a ไป b (ไม่รวม a) - Bresenham */
function lineTiles(a: Tile, b: Tile): Tile[] {
  const out: Tile[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y), sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 200 && (x !== b.x || y !== b.y); n++) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    out.push({ x, y });
  }
  return out;
}
/** แฮชง่าย ๆ จาก id - เอาไว้เลือกของประจำตัวให้คงที่ต่อคน */
const hashId = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const rnd = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

export class World {
  readonly canvas: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private base: Surface;
  private ctx: CanvasRenderingContext2D;

  employees: Employee[] = [];
  /** pod index -> deptId ที่จับจองไว้ */
  private nextId = 1;
  private selected: Employee | null = null;

  /** กล้อง: x/y = มุมบนซ้ายของวิว (base px), z = px จอ ต่อ 1 base px */
  cam = { x: 0, y: 0, z: 3 };
  private minZ = 1; private maxZ = 30; private fitZ = 3;
  private camReady = false;
  follow: string | null = null;
  showNames = true;
  /** กล้องอัตโนมัติ: ซูมเข้าห้องประชุมเองตอนทีมประชุม */
  autoCam = true;
  private camTarget: { x: number; y: number; z: number } | null = null;
  private savedCam: { x: number; y: number; z: number } | null = null;
  /** คิวคำพูด - พูดทีละคน ไม่ให้แย่งกัน */
  private speechQueue: { id: string; text: string; sec: number; onStart?: () => void }[] = [];
  private speechGap = 0;
  /**
   * จำนวนตัวอักษรที่ใส่ในหน้าปัจจุบันของฟองแต่ละคนได้ - renderSpeech เป็นคนคำนวณ
   * (ขึ้นกับซูมและความกว้างฟอง) แล้ว update ใช้ตัดสินว่าพิมพ์ครบหน้าหรือยัง
   */
  private pageLen = new Map<string, number>();
  private blinkT = 0;

  private raf = 0;
  private last = 0;
  private running = true;
  private disposed = false;
  private cleanups: (() => void)[] = [];

  /* ---------- ผังเฟอร์นิเจอร์ ---------- */
  private lay = new LayoutState(defaultLayout());
  /** sprite ทั้งหมดที่ต้องวาด (ชุดคงที่ + เฟอร์นิเจอร์) - สร้างใหม่เมื่อผังเปลี่ยน */
  private objs: MapObject[] = [...this.lay.objs];
  /** โลโก้บริษัท - โหลดจาก data URL ในผัง วาดบนตรา (emblem) */
  private logoImg: HTMLImageElement | null = null;
  private logoSrc: string | null = null;
  private layoutListeners = new Set<(l: OfficeLayout, cause: LayoutCause) => void>();
  private seatListeners = new Set<(id: string, seat: Tile) => void>();
  private editListeners = new Set<(s: EditSnapshot) => void>();
  /** AI ล่ม/ไม่ได้เชื่อม (ข้อความเหตุผล) - พนักงานพักยาว ไม่นั่งทำงาน; null = ปกติ */
  private aiDown: string | null = null;
  /** cache จำนวนที่ว่างต่อแผนก - คำนวณแพง (ลองวางโต๊ะทีละตัว) เลยจำไว้ต่อ rev */
  private roomLeftCache: { rev: string; staff: number; by: Record<string, number> } | null = null;

  /* ---------- โหมดจัดออฟฟิศ ---------- */
  private editOn = false;
  private editSel: string | null = null;
  private editPlacing: { kind: FurnKind; dir: Dir; v: number; dept?: string } | null = null;
  /** กำลังทาสีพื้น: รหัส tile - ลากบนแผนที่เพื่อระบาย */
  private editPaint: string | null = null;
  private paintDown = false;
  /** ลากชิ้นอยู่: ชิ้นไหน จับที่ offset ไหนจาก anchor */
  private editDrag: { id: string; ox: number; oy: number; moved: boolean } | null = null;
  /** ตำแหน่ง ghost ปัจจุบัน + ผลตรวจ (วาดเขียว/แดง) */
  private ghost: { x: number; y: number; dir: Dir; kind: FurnKind; v: number; verdict: Verdict } | null = null;
  private hover: Tile | null = null;
  private editMsg: string | null = null;
  /**
   * ชั้นพื้น (กระเบื้อง ลายพื้น ของติดผนัง เงาผนัง) ไม่เคยเปลี่ยน ยกเว้นน้ำที่มี 4 เฟรม
   * เดิมวาดใหม่ 648 tile ทุกเฟรม (~3 ms/เฟรม ตลอดเวลาที่เปิดหน้า) - วาดครั้งเดียวต่อเฟรมน้ำแล้ว blit ทีเดียว
   */
  private floorLayer: (HTMLCanvasElement | null)[] = [null, null, null, null];
  /** เฟรมล่าสุดที่วาดจริง - ใช้จำกัดเฟรมตอนออฟฟิศนิ่ง */
  private lastRender = 0;
  /**
   * cache ผลตัดบรรทัดของฟองคำพูด - paginate เรียก measureText ทีละตัวอักษร (ไทยไม่มีช่องว่าง)
   * ทั้งหน้าเปลี่ยนเฉพาะตอนพลิกหน้า/ซูม ส่วนที่พิมพ์แล้วเปลี่ยน ~42 ครั้ง/วิ ไม่ใช่ทุกเฟรม
   */
  private pageCache = new Map<string, { key: string; lines: string[]; used: number; wTxt: number }>();
  private shownCache = new Map<string, { key: string; lines: string[] }>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.sctx = canvas.getContext('2d')!;
    this.sctx.imageSmoothingEnabled = false;
    this.base = mk(BW, BH);
    this.ctx = this.base.g;
    this.spawnBoss();
    this.spawnSecretary();
    this.bindInput();
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    // แท็บถูกซ่อน = หยุดลูปทั้งหมด (เบราว์เซอร์หน่วง rAF ให้อยู่แล้ว แต่ตอนกลับมา dt จะกระโดด) - กลับมาค่อยเริ่มนับใหม่
    const onVis = () => {
      if (this.disposed) return;
      cancelAnimationFrame(this.raf);
      if (!document.hidden) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  /** ผู้บริหาร (ตัวผู้ใช้) - ปกตินั่งทำงานในห้องตัวเอง เดินมาห้องประชุมเมื่อมีวาระ */
  private spawnBoss() {
    const pal = { skin: '#e8b088', hair: '#403848', shirt: '#3a4256', pants: '#2a3040', shoes: '#403848' };
    const home = this.lay.homeSeat('boss') ?? { x: BOSS_HOME.x, y: BOSS_HOME.y, dir: BOSS_HOME.dir as Dir };
    this.employees.push({
      id: 'boss',
      name: 'คุณ',
      title: 'ผู้บริหาร',
      deptId: '__boss__',
      role: 'proposer',
      lens: '',
      pal,
      atlas: buildAtlas(pal),
      seat: { x: home.x, y: home.y },
      tx: home.x, ty: home.y,
      px: home.x * TS + 8, py: home.y * TS + TS,
      dir: home.dir, pose: 'sit', frame: 0, animT: 0,
      state: 'work', timer: Number.POSITIVE_INFINITY,
      speed: 44,
      path: null, after: null,
      bubble: null, bubbleT: 0,
      sayFull: '', sayChars: 0, sayT: 0, sayPage: 0, sayHold: 0,
      gadget: null,
      busy: true,
      isBoss: true,
      owner: 'sim',
    });
  }

  /**
   * เลขานุการ - เกิดเองทุกออฟฟิศเหมือนบอส ผู้ใช้ไม่ต้องจ้าง
   * ยืนประจำหน้าห้องประชุม เป็นคนที่ผู้ใช้กดดูประวัติการประชุมผ่านไอคอนบนแถบบน
   */
  private spawnSecretary() {
    const pal = { ...SECRETARY_PAL };
    const home = this.lay.homeSeat('secretary') ?? { x: SEC_HOME.x, y: SEC_HOME.y, dir: SEC_HOME.dir as Dir };
    this.employees.push({
      id: 'secretary',
      name: SECRETARY_NAME,
      title: SECRETARY_TITLE,
      deptId: '__secretary__',
      role: 'verifier',
      lens: '',
      pal,
      atlas: buildAtlas(pal),
      seat: { x: home.x, y: home.y },
      tx: home.x, ty: home.y,
      px: home.x * TS + 8, py: home.y * TS + TS,
      dir: home.dir, pose: 'sit', frame: 0, animT: 0,
      state: 'work', timer: 3,
      speed: 40,
      path: null, after: null,
      bubble: null, bubbleT: 0,
      sayFull: '', sayChars: 0, sayT: 0, sayPage: 0, sayHold: 0,
      gadget: null,
      // ไม่ busy - ให้ decideSecretary() คุมพฤติกรรมของเธอเองแทน AI ทั่วไป
      busy: false,
      isSecretary: true,
      owner: 'sim',
    });
  }

  /**
   * กิจวัตรของเลขาฯ - แยกจาก AI ทั่วไป เพราะเธอต้องอยู่แถวห้องประชุมเสมอ
   * ไม่ไปนั่งโซฟา ไม่ไปชมบ่อน้ำ แต่ก็ต้องไม่ยืนแข็งเป็นรูปปั้น
   * ระหว่างประชุมเธอจะยืนจดอยู่หน้าห้อง ไม่เดินไปไหน
   */
  private decideSecretary(e: Employee) {
    const home = this.homeOf(e);
    const meeting = this.employees.some((o) => o.state === 'meet' || o.state === 'think');
    if (meeting) {
      // ประชุมอยู่ - นั่งจดที่จุดประจำ
      if (e.tx !== home.x || e.ty !== home.y) {
        this.goTo(e, home.x, home.y, () => {
          this.sitAt(e, home.x, home.y, home.dir, 'work', 4);
        });
        return;
      }
      this.sitAt(e, home.x, home.y, home.dir, 'work', 4);
      e.gadget = 'notes';
      e.bubble = 'type'; e.bubbleT = 2.5;
      e.timer = 4 + Math.random() * 3;
      return;
    }

    e.gadget = null; // ไม่มีประชุมก็วางสมุด
    const roll = Math.random();
    if (roll < 0.45) {
      // กลับมาประจำที่ แล้วมองซ้ายขวาเหมือนคอยรับแขก
      this.goTo(e, home.x, home.y, () => {
        this.sitAt(e, home.x, home.y, home.dir, 'work', 6 + Math.random() * 6);
        if (Math.random() < 0.5) { e.bubble = 'type'; e.bubbleT = 2; }
      });
    } else if (roll < 0.7) {
      // เดินเช็คใกล้ ๆ ที่นั่งตัวเอง แล้วเดินกลับ
      const spot = this.pickSpot(e, this.idleSpotsNear(home, 6, 3));
      if (spot) {
        this.goTo(e, spot.x, spot.y, () => {
          e.pose = 'stand'; e.state = 'idle'; e.timer = 2 + Math.random() * 3;
        });
      } else e.timer = 3;
    } else if (roll < 0.85) {
      // ไปกดน้ำแล้วกลับ (ถ้ามีเครื่องกดน้ำและเดินถึง)
      const cooler = this.pickSpot(e, this.lay.spots('cooler'));
      if (cooler) {
        this.goTo(e, cooler.x, cooler.y, () => {
          e.pose = 'stand'; e.dir = 'up'; e.state = 'coffee';
          e.timer = 3 + Math.random() * 3; e.bubble = 'coffee'; e.bubbleT = 3;
        });
      } else e.timer = 3;
    } else {
      // ยืนจดโน้ตอยู่กับที่
      e.pose = 'stand'; e.state = 'idle';
      e.bubble = 'type'; e.bubbleT = 2;
      e.timer = 3 + Math.random() * 3;
    }
  }

  get bossId() { return 'boss'; }
  get secretaryId() { return 'secretary'; }
  private get boss() { return this.employees.find((e) => e.isBoss)!; }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
  }

  /* ============================================================
     จ้าง / เลิกจ้าง
     ============================================================ */
  /** พนักงานที่จ้างมาจริง (ไม่รวมตัวผู้บริหาร) */
  private get staff() { return this.employees.filter((e) => !e.isBoss && !e.isSecretary && !e.isVisitor); }

  seatsLeft(): number {
    return Math.max(0, MAX_STAFF - this.staff.length);
  }

  headcount(deptId: string): number {
    return this.staff.filter((e) => e.deptId === deptId).length;
  }

  /** ช่องที่มีคนอยู่ตอนนี้ (ยืน/นั่ง) - กันวางของทึบทับคน */
  private occupiedTiles(): Set<string> {
    const o = new Set<string>();
    for (const e of this.employees) o.add(key(e.tx, e.ty));
    return o;
  }

  /** ที่นั่งประจำของคนนี้จากผัง (เก้าอี้/โต๊ะที่ owner เป็นเขา) - ไม่มีก็ใช้ที่จำไว้ในตัว */
  private homeOf(e: Employee): { x: number; y: number; dir: Dir } {
    return this.lay.homeSeat(e.id) ?? { x: e.seat.x, y: e.seat.y, dir: e.dir };
  }
  /** ทิศที่คนนี้หันตอนนั่งที่ประจำ */
  private seatDirOf(e: Employee): Dir { return this.homeOf(e).dir; }

  /** จุดยึดของแผนก - ป้ายแผนก > ที่นั่งของคนแผนกนี้ > กลางแผนที่ */
  private deptAnchor(deptId: string): Tile {
    const sign = this.lay.deptSigns().find((d) => d.dept === deptId);
    if (sign) return { x: sign.x, y: sign.y };
    const mates = this.staff.filter((e) => e.deptId === deptId);
    if (mates.length) return { x: Math.round(mates.reduce((a, e) => a + e.seat.x, 0) / mates.length), y: Math.round(mates.reduce((a, e) => a + e.seat.y, 0) / mates.length) };
    return { x: Math.floor(MW / 2), y: Math.floor(MH / 2) };
  }

  /** ที่นั่งว่างที่แผนกนี้เอาไปใช้ได้ เรียงใกล้จุดยึดก่อน - PR ได้เก้าอี้เคาน์เตอร์ PR ก่อน */
  private freeSeatsFor(deptId: string): LayoutItem[] {
    const anchor = this.deptAnchor(deptId);
    const byDist = (a: LayoutItem, b: LayoutItem) => dist2(seatOf(a)!, anchor) - dist2(seatOf(b)!, anchor);
    const work = this.lay.freeWorkSeats().sort(byDist);
    if (deptId !== 'pr') return work;
    const pr = this.lay.prSeats().map((s) => s.item).filter((i) => !i.owner).sort(byDist);
    return [...pr, ...work];
  }

  /** ตำแหน่งที่จะลองวางโต๊ะใหม่ - ในอาคาร ใกล้จุดยึดของแผนกก่อน */
  private *deskCandidates(deptId: string): Generator<{ x: number; y: number; dir: Dir }> {
    const anchor = this.deptAnchor(deptId);
    const tiles: Tile[] = [];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (isIndoor(x, y)) tiles.push({ x, y });
    tiles.sort((a, b) => dist2(a, anchor) - dist2(b, anchor));
    for (const t of tiles) for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) yield { x: t.x, y: t.y, dir };
  }

  /** ลองวางโต๊ะใหม่ให้แผนกนี้ - คืนชิ้นที่ผ่านกฎ (ยังไม่ใส่ในผัง) */
  private tryNewDesk(deptId: string, items: LayoutItem[], occupied: Set<string>, limit = 600): LayoutItem | null {
    let n = 0;
    for (const c of this.deskCandidates(deptId)) {
      if (n++ > limit) break;
      const it: LayoutItem = { id: newItemId(), kind: 'desk', x: c.x, y: c.y, dir: c.dir, v: (c.x * 7 + c.y * 3) % 3 };
      if (this.lay.validate([...items, it], occupied, it.id).ok) return it;
    }
    return null;
  }

  /**
   * จองที่นั่งให้พนักงาน - ที่นั่งว่างใกล้แผนก > วางโต๊ะใหม่ใกล้แผนก
   * แก้ผังในที่ (owner/เพิ่มโต๊ะ) - ผู้เรียกต้อง commitLayout เอง
   */
  private claimSeat(deptId: string, empId: string, prefer?: Tile): { seat: Tile; changed: boolean } | null {
    const free = this.freeSeatsFor(deptId);
    const pick = (prefer && free.find((i) => { const s = seatOf(i)!; return s.x === prefer.x && s.y === prefer.y; })) ?? free[0];
    if (pick) { pick.owner = empId; const st = seatOf(pick)!; return { seat: { x: st.x, y: st.y }, changed: true }; }
    const it = this.tryNewDesk(deptId, this.lay.items, this.occupiedTiles());
    if (!it) return null;
    it.owner = empId;
    this.lay.layout.items.push(it);
    return { seat: { x: it.x, y: it.y }, changed: true };
  }

  /** ที่ว่างของแผนกนี้ - ที่นั่งว่างทั้งหมด + โต๊ะใหม่ที่ยังวางลงได้ใกล้แผนก (ไม่เกินโควตารวม) - ปุ่มจ้างใช้ */
  seatsLeftFor(deptId: string): number {
    const global = this.seatsLeft();
    const c = this.roomLeftCache;
    if (!c || c.rev !== this.lay.layout.rev || c.staff !== this.staff.length) {
      this.roomLeftCache = { rev: this.lay.layout.rev, staff: this.staff.length, by: {} };
    }
    const cache = this.roomLeftCache!;
    if (cache.by[deptId] === undefined) {
      let n = this.freeSeatsFor(deptId).length;
      // จำลองวางโต๊ะเพิ่มทีละตัวใกล้แผนก (แค่พอให้รู้ว่ายังจ้างต่อได้ - ไม่ไล่จนเต็มโควตา เพราะตรวจแพง)
      const items = this.lay.items.map((i) => ({ ...i }));
      const none = new Set<string>();
      const target = Math.min(global, n + 3);
      while (n < target) {
        const placed = this.tryNewDesk(deptId, items, none, 120);
        if (!placed) break;
        items.push(placed);
        n++;
      }
      cache.by[deptId] = Math.min(global, n);
    }
    return cache.by[deptId];
  }

  /** เปลี่ยนชื่อพนักงาน (เฉพาะ staff - บอส/เลขาฯ/แขกไม่ได้) - ชื่อโชว์ทันทีเฟรมถัดไป */
  rename(id: string, name: string): boolean {
    const nm = name.trim().slice(0, 24);
    if (!nm) return false;
    const e = this.staff.find((x) => x.id === id);
    if (!e) return false;
    e.name = nm;
    return true;
  }

  hire(dept: Department): Employee | null {
    if (this.staff.length >= MAX_STAFF) return null;
    const id = crypto.randomUUID(); // ใช้เป็น primary key ใน DB ด้วย
    const claim = this.claimSeat(dept.id, id);
    if (!claim) return null;

    const n = this.headcount(dept.id);
    const usedNames = new Set(this.staff.map((e) => e.name));
    // ชุดชื่อตามภาษา UI ตอนกดจ้าง - ชื่อเป็นข้อมูลถาวร (ลง DB) ไม่ใช่คำแปล สลับภาษาทีหลังคนเดิมชื่อเดิม
    const en = getLang() === 'en';
    const pool = en ? NAMES_EN : NAMES;
    const fems = en ? FEM_NAMES_EN : FEM_NAMES;
    const name = pool.find((nm) => !usedNames.has(nm)) ?? (en ? `Staff ${this.nextId}` : `พนักงาน${this.nextId}`);
    const pal = makePalette(this.nextId++ * 17 + dept.id.length, dept.color, fems.has(name));
    // คนที่ 1 = ผู้เสนอ, 2 = ผู้ค้าน, 3 = ผู้ตรวจสอบ, 4 = ผู้ดูความเป็นไปได้ แล้ววนใหม่
    const role = ROLE_ORDER[n % ROLE_ORDER.length];

    const e = this.spawn({
      id, name, title: ROLES[role].th, deptId: dept.id, role, palette: pal, seat: { ...claim.seat },
    }, dept);
    if (claim.changed) this.commitLayout('hire');
    return e;
  }

  /**
   * สร้างพนักงานจากข้อมูลที่บันทึกไว้ (โหลดออฟฟิศกลับมา) - ต้อง setLayout ก่อน (ถ้ามีผังของออฟฟิศ)
   * ที่นั่งเอาจากผัง: ที่นั่งที่ owner เป็นคนนี้ > ที่นั่งว่างตรง seat เดิม > ที่นั่งว่างใกล้แผนก > วางโต๊ะใหม่
   */
  restore(rows: PersistedEmployee[]) {
    // บอสกับเลขาฯ ไม่ได้มาจากฐานข้อมูล จึงต้องรอดจากการล้างตอนสลับออฟฟิศ
    this.employees = this.employees.filter((e) => e.isBoss || e.isSecretary || e.isVisitor);
    const ids = new Set(rows.map((r) => r.id));
    let changed = false;
    // เจ้าของที่นั่งที่ไม่อยู่แล้ว (โดนเลิกจ้างจากเครื่องอื่น) - ปล่อยว่าง (บอส/เลขาฯ ไม่นับ)
    for (const it of this.lay.items) {
      if ((it.kind === 'desk' || it.kind === 'chair') && it.owner && it.owner !== 'boss' && it.owner !== 'secretary' && !ids.has(it.owner)) { it.owner = null; changed = true; }
    }
    const seatChanged: [string, Tile][] = [];
    for (const r of rows) {
      const dept = DEPT_BY_ID.get(r.deptId);
      if (!dept) continue;
      let seat: Tile | null = null;
      const own = this.lay.homeSeat(r.id);
      if (own) seat = { x: own.x, y: own.y };
      else {
        const c = this.claimSeat(r.deptId, r.id, r.seat);
        if (c) { seat = c.seat; changed = changed || c.changed; }
      }
      if (!seat) { console.warn('[world] ไม่มีที่นั่งให้', r.name, '- ออฟฟิศเต็ม'); continue; }
      this.spawn({ ...r, seat }, dept);
      if (seat.x !== r.seat.x || seat.y !== r.seat.y) seatChanged.push([r.id, seat]);
    }
    if (changed) this.commitLayout('restore'); else this.refreshLayoutIndex();
    for (const [id, seat] of seatChanged) this.seatListeners.forEach((f) => f(id, seat));
  }

  private spawn(rec: PersistedEmployee, dept: Department): Employee {
    // พนักงานที่บันทึกไว้ก่อนมีเพศใน palette - เดาจากชื่อ จะได้หน้าตาสม่ำเสมอทุกจอ
    if (rec.palette.fem === undefined && FEM_NAMES.has(rec.name)) rec = { ...rec, palette: { ...rec.palette, fem: true } };
    const e: Employee = {
      id: rec.id,
      name: rec.name,
      title: rec.title,
      deptId: rec.deptId,
      role: rec.role,
      lens: dept.lenses[rec.role],
      pal: rec.palette,
      atlas: buildAtlas(rec.palette),
      seat: { ...rec.seat },
      tx: rec.seat.x, ty: rec.seat.y,
      px: rec.seat.x * TS + 8, py: rec.seat.y * TS + TS,
      dir: 'up', pose: 'sit', frame: 0, animT: 0,
      state: 'work', timer: 3 + Math.random() * 6,
      speed: 40 + Math.random() * 12,
      path: null, after: null,
      bubble: 'idea', bubbleT: 2,
      sayFull: '', sayChars: 0, sayT: 0, sayPage: 0, sayHold: 0,
      gadget: null,
      busy: false,
      owner: 'sim',
    };
    this.employees.push(e);
    e.dir = this.seatDirOf(e);
    return e;
  }

  /** ข้อมูลที่ต้องบันทึกลง DB ของพนักงานคนหนึ่ง */
  persistable(e: Employee): PersistedEmployee {
    return {
      id: e.id, name: e.name, title: e.title, deptId: e.deptId,
      role: e.role, palette: e.pal, seat: e.seat,
    };
  }

  /**
   * รับตำแหน่งจากเครื่องอื่น (เฟส sync ตำแหน่ง)
   * เฟสนี้ยังไม่มีใครเรียก - มีไว้ให้เฟสถัดไปเป็นแค่ "เอา channel มาป้อนตรงนี้"
   * ไม่ต้องรื้อ update loop
   */
  applyRemoteState(id: string, s: { px: number; py: number; dir: Dir; pose: Pose }) {
    const e = this.employees.find((x) => x.id === id);
    if (!e) return;
    e.owner = 'remote';
    e.remote = { ...s };
  }

  fire(deptId?: string): boolean {
    // ห้ามไล่ตัวผู้บริหารกับเลขาฯ ออก - สองคนนี้ไม่ใช่พนักงานที่จ้างมา
    const fixed = (e: Employee) => e.isBoss || e.isSecretary || e.isVisitor;
    const idx = deptId
      ? this.employees.map((e) => (fixed(e) ? '' : e.deptId)).lastIndexOf(deptId)
      : this.employees.map((e) => !fixed(e)).lastIndexOf(true);
    if (idx < 0) return false;
    const [gone] = this.employees.splice(idx, 1);
    if (this.selected?.id === gone.id) this.selected = null;
    if (this.follow === gone.id) this.follow = null;
    // ที่นั่งยังอยู่ ให้คนต่อไปนั่ง - แค่ปลดเจ้าของ
    const d = this.lay.seatItemOf(gone.id);
    if (d) { d.owner = null; this.commitLayout('user'); }
    return true;
  }

  roster(): EmployeeSnapshot[] {
    return this.staff.map((e) => ({
      id: e.id, name: e.name, title: e.title, deptId: e.deptId, role: e.role,
      state: e.state, color: e.pal.shirt, palette: e.pal,
    }));
  }

  byDept(deptId: string): Employee[] {
    return this.staff.filter((e) => e.deptId === deptId);
  }

  /* ============================================================
     การเคลื่อนที่พื้นฐาน
     ============================================================ */
  private goTo(e: Employee, x: number, y: number, after: (() => void) | null): boolean {
    const p = findPath(e.tx, e.ty, x, y);
    if (!p) { after?.(); return false; }
    if (p.length === 0) { after?.(); return true; }
    e.path = p;
    e.after = after;
    e.state = 'walk';
    e.pose = 'walk';
    return true;
  }

  private walk(e: Employee, x: number, y: number): Promise<void> {
    return new Promise((resolve) => this.goTo(e, x, y, () => resolve()));
  }

  private sitAt(e: Employee, x: number, y: number, dir: Dir, state: AgentState, dur: number) {
    e.tx = x; e.ty = y;
    e.px = x * TS + 8; e.py = y * TS + TS;
    e.dir = dir; e.pose = 'sit'; e.state = state; e.timer = dur;
  }

  bubble(id: string, icon: BubbleIcon, sec = 2.5) {
    const e = this.employees.find((x) => x.id === id);
    if (e) { e.bubble = icon; e.bubbleT = sec; }
  }

  /**
   * ฟองคำพูดข้อความจริง - เข้าคิวไว้ แล้วพูดทีละคน
   * ถ้าปล่อยให้พูดพร้อมกันจะกลายเป็นแย่งกันพูด (คอล LLM 3 ตัวเสร็จไล่ ๆ กัน)
   * และฟองซ้อนกันจนดูไม่ออกว่าใครพูด
   */
  say(id: string, text: string, sec?: number, onStart?: () => void) {
    const t = text.trim();
    if (!t) return;
    // ไม่ตัดคิวทิ้งแล้ว - ทุกคนต้องได้พูด ไม่งั้นเห็นแค่คนแรกคนเดียว
    // การประชุมจะยาวเท่าที่บทสนทนายาว (page.tsx รอ waitForSpeech() ก่อนสรุป)
    // sec ที่ส่งมาคือเวลาค้างหลังพิมพ์จบ (อ่านหน้าสุดท้าย) ไม่ใช่อายุทั้งฟอง
    // ข้อความยาวจะถูกแบ่งหน้าแล้วพลิกเองจนครบ ไม่โดนตัดกลางคันเหมือนเดิม
    this.speechQueue.push({ id, text: t, onStart, sec: sec ?? 3 });
  }

  /** พูดทันทีโดยไม่ต้องรอคิว (ใช้ตอนมารายงานที่โต๊ะ) */
  sayNow(id: string, text: string, sec?: number) {
    this.speechQueue = [];
    this.speechGap = 0;
    const e = this.employees.find((x) => x.id === id);
    const t = text.trim();
    if (!e || !t) return;
    this.employees.forEach((o) => { o.sayFull = ''; o.sayChars = 0; o.sayT = 0; o.sayPage = 0; o.sayHold = 0; });
    e.sayFull = t;
    e.sayChars = 0;
    e.sayPage = 0;
    e.sayHold = sec ?? 4;
    this.pageLen.delete(e.id); // ความยาวหน้าเป็นของข้อความก่อน - ต้องวัดใหม่ตอนวาด
    e.sayT = Number.POSITIVE_INFINITY; // จบเองเมื่อพิมพ์ครบทุกหน้าและค้างครบ
    e.bubble = null;
    e.bubbleT = 0;
  }

  /** ดึงคนถัดไปในคิวขึ้นมาพูด เมื่อคนก่อนหน้าพูดจบแล้ว */
  private pumpSpeech(dt: number) {
    if (this.speechGap > 0) { this.speechGap -= dt; return; }
    if (!this.speechQueue.length) return;
    if (this.employees.some((e) => e.sayT > 0)) return; // ยังมีคนพูดอยู่ รอก่อน

    const next = this.speechQueue[0];
    const e = this.employees.find((x) => x.id === next.id);
    if (!e) { this.speechQueue.shift(); return; }
    // คนพูดยังเดินอยู่ - อย่าบล็อกทั้งคิว ข้ามไปหาคนถัดไปที่พร้อมพูด (คนที่เดินจะได้พูดเมื่อถึงที่)
    // ถ้าไม่มีใครพร้อมเลย ค่อยรอ
    if (e.path) {
      const readyIdx = this.speechQueue.findIndex((q) => { const o = this.employees.find((x) => x.id === q.id); return o && !o.path; });
      if (readyIdx < 0) return;
      const [ready] = this.speechQueue.splice(readyIdx, 1);
      this.speechQueue.unshift(ready);
      return; // รอบหน้าจะหยิบตัวนี้
    }

    this.speechQueue.shift();
    e.sayFull = next.text;
    e.sayChars = 0;
    e.sayPage = 0;
    e.sayHold = next.sec;
    this.pageLen.delete(e.id); // ความยาวหน้าเป็นของข้อความก่อน - ต้องวัดใหม่ตอนวาด
    e.sayT = Number.POSITIVE_INFINITY; // จบเองเมื่อพิมพ์ครบทุกหน้าและค้างครบ
    e.bubble = null; // กันฟองไอคอนซ้อนกับฟองข้อความ
    e.bubbleT = 0;
    next.onStart?.(); // เช่น หันไปหาคนที่กำลังค้าน + ให้คนนั้นมีปฏิกิริยา
  }

  /** รอจนคุยกันจบทั้งคิว - ใช้กันไม่ให้สรุปทับบทสนทนาที่ยังไม่จบ */
  waitForSpeech(timeoutMs = 120_000): Promise<void> {
    if (!this.isSpeaking()) return Promise.resolve();
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        if (this.disposed || !this.isSpeaking() || performance.now() - started > timeoutMs) {
          resolve();
          return;
        }
        window.setTimeout(tick, 150);
      };
      tick();
    });
  }

  /** ปฏิกิริยาสั้น ๆ เป็นไอคอน (เช่นโดนพาดพิงตอนถูกค้าน) */
  react(id: string, icon: BubbleIcon, sec = 2) {
    const e = this.employees.find((x) => x.id === id);
    if (!e || e.sayT > 0) return; // กำลังพูดอยู่ อย่าไปทับฟองข้อความ
    e.bubble = icon;
    e.bubbleT = sec;
  }

  /** หันหน้าไปหาอีกคน (ใช้ตอนพูดกับใครเป็นการเฉพาะ) */
  faceToward(id: string, targetId: string) {
    const e = this.employees.find((x) => x.id === id);
    const t = this.employees.find((x) => x.id === targetId);
    if (!e || !t || e.path) return;
    const dx = t.px - e.px;
    const dy = t.py - e.py;
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  clearSay(ids?: string[]) {
    this.speechQueue = ids
      ? this.speechQueue.filter((q) => !ids.includes(q.id))
      : [];
    this.employees.forEach((e) => {
      if (ids && !ids.includes(e.id)) return;
      e.sayFull = ''; e.sayChars = 0; e.sayT = 0;
    });
  }

  /** มีใครกำลังพูดหรือรอคิวพูดอยู่ไหม */
  isSpeaking() {
    return this.speechQueue.length > 0 || this.employees.some((e) => e.sayT > 0);
  }

  /* ============================================================
     Choreography ที่ผูกกับงานจริง (chat -> ประชุม -> รายงาน)
     ============================================================ */

  /** เรียกทีมเข้าห้องประชุม - บอสเดินมาจากห้องตัวเองด้วย resolve เมื่อทุกคนนั่งครบ */
  async gather(ids: string[]): Promise<void> {
    const team = ids
      .map((id) => this.employees.find((e) => e.id === id))
      .filter((e): e is Employee => !!e);
    if (!team.length) return;

    const seats = this.lay.meetSeats();
    const head = this.lay.headSeat();
    const walkers = team.map((e, i) => {
      e.busy = true;
      e.path = null;
      e.after = null;
      const s = seats[i % Math.max(1, seats.length)] ?? this.homeOf(e);
      e.bubble = 'board'; e.bubbleT = 2.5;
      // หยิบโน้ตบุ๊ก/แท็บเล็ต/สมุดติดมือไปประชุม - แต่ละคนถือประจำตัวไม่เปลี่ยน
      e.gadget = GADGETS[hashId(e.id) % GADGETS.length];
      return this.walk(e, s.x, s.y).then(() => {
        this.sitAt(e, s.x, s.y, s.dir, 'meet', 9999);
      });
    });

    // บอสออกจากห้องตัวเองมานั่งหัวโต๊ะ
    const boss = this.boss;
    boss.path = null;
    boss.after = null;
    boss.state = 'walk';
    // หัวโต๊ะ (เก้าอี้ที่ตั้งเป็นหัวโต๊ะ) - ไม่มีก็นั่งเก้าอี้ประชุมตัวที่ทีมไม่ได้ใช้ ไม่มีอีกก็อยู่บ้านตัวเอง
    const bossSeat = head ?? seats.find((_, i) => i >= team.length) ?? this.homeOf(boss);
    walkers.push(
      this.walk(boss, bossSeat.x, bossSeat.y).then(() => {
        this.sitAt(boss, bossSeat.x, bossSeat.y, bossSeat.dir, 'meet', Number.POSITIVE_INFINITY);
      }),
    );

    await Promise.all(walkers);
  }

  /** ระหว่างรอคำตอบจาก LLM - ให้คนในห้องประชุมสลับกันพูด */
  setDeliberating(ids: string[]) {
    ids.forEach((id) => {
      const e = this.employees.find((x) => x.id === id);
      if (e) { e.state = 'think'; e.timer = 9999; }
    });
  }

  /** ให้คนหนึ่งเดินมารายงานที่โต๊ะผู้บริหาร - resolve เมื่อถึงที่ */
  async report(id: string): Promise<void> {
    const e = this.employees.find((x) => x.id === id);
    if (!e) return;
    e.busy = true;
    e.path = null;
    e.after = null;
    // หน้าโต๊ะบอส (แถวใต้โต๊ะ) - ไม่มีโต๊ะ/ถึงไม่ได้ ก็ยืนข้างบอส
    const boss = this.boss;
    const spots = this.lay.reportSpots();
    const spot = this.pickSpot(e, spots)
      ?? this.pickSpot(e, [{ x: boss.tx, y: boss.ty + 1 }, { x: boss.tx - 1, y: boss.ty }, { x: boss.tx + 1, y: boss.ty }, { x: boss.tx, y: boss.ty - 1 }])
      ?? spots[0] ?? { x: boss.tx, y: boss.ty + 1 };
    await this.walk(e, spot.x, spot.y);
    e.pose = 'stand';
    e.dir = spot.y > boss.ty ? 'up' : spot.y < boss.ty ? 'down' : spot.x < boss.tx ? 'right' : 'left';
    e.state = 'report';
    e.timer = 9999;
    e.bubble = 'talk';
    e.bubbleT = 4;
  }

  /** เลิกประชุม - ทุกคนกลับโต๊ะตัวเอง */
  disperse(ids: string[]) {
    this.clearSay(); // เลิกประชุมแล้วห้ามมีฟองค้างไปพูดตอนเดิน

    // บอสกลับไปนั่งห้องตัวเอง
    const boss = this.boss;
    boss.path = null;
    boss.after = null;
    const home = this.homeOf(boss);
    this.goTo(boss, home.x, home.y, () => {
      this.sitAt(boss, home.x, home.y, home.dir, 'work', Number.POSITIVE_INFINITY);
    });

    ids.forEach((id) => {
      const e = this.employees.find((x) => x.id === id);
      if (!e) return;
      e.path = null;
      e.after = null;
      // goTo เรียก callback เสมอ ไม่ว่าจะเดินถึงหรือหาเส้นทางไม่เจอ - busy จึงถูกปลดแน่นอน
      this.goTo(e, e.seat.x, e.seat.y, () => {
        this.sitAt(e, e.seat.x, e.seat.y, this.seatDirOf(e), 'work', 8 + Math.random() * 10);
        e.busy = false;
        e.gadget = null; // ถึงโต๊ะแล้ววางของ
      });
    });
  }

  /* ============================================================
     แขก/ลูกค้าเดินเข้ามาถาม (คำถามจาก LINE / MCP / API)
     ไม่ใช่การประชุม - คนนอกเดินจากประตูสวนเข้ามาหาคนตอบ คุยกันหน้าเคาน์เตอร์ แล้วเดินออกไป
     server ตอบเร็วแค่ไหนก็ปล่อยไป animation เล่นตามจังหวะที่คนดูอ่านทัน (ฟองคำพูดแบ่งหน้าเอง)
     ============================================================ */

  /** จุดที่แขกโผล่/หายไป - ขอบขวาสุดของสวน แถวประตูล็อบบี้ */
  private gateTile(): Tile {
    const g = this.lay.entrance();
    if (g && tileFree(g.x, g.y)) return g;
    for (const t of [{ x: MW - 1, y: 8 }, { x: MW - 1, y: 7 }, { x: MW - 2, y: 8 }, { x: MW - 2, y: 7 }, { x: MW - 1, y: 9 }]) {
      if (tileFree(t.x, t.y)) return t;
    }
    return g ?? { x: MW - 1, y: 8 };
  }

  /** ช่องว่างเดินได้ในอาคาร (ไม่ใช่ที่นั่ง/จุดยืนของใคร) - สุ่มมาเป็นที่ยืนเล่น */
  private idleSpots(): Tile[] {
    const out: Tile[] = [];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (!isIndoor(x, y) || !tileFree(x, y) || this.lay.at(x, y)) continue;
      out.push({ x, y });
    }
    // สุ่มชุดย่อยพอ ไม่ต้องทั้งแผนที่
    for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
    return out.slice(0, 12);
  }
  private idleSpotsNear(c: Tile, rx: number, ry: number): Tile[] {
    const out: Tile[] = [];
    for (let y = c.y - ry; y <= c.y + ry; y++) for (let x = c.x - rx; x <= c.x + rx; x++) {
      if ((x === c.x && y === c.y) || !tileFree(x, y) || this.lay.at(x, y)) continue;
      out.push({ x, y });
    }
    return out;
  }

  /**
   * ที่ยืนของแขกเมื่อมาถึงคนตอบ + ที่ยืน/นั่งของคนตอบ
   *   PR  = แขกยืนหน้าเคาน์เตอร์ (ใต้เคาน์เตอร์ 1 ช่อง) คนตอบนั่งที่เดิมหันลง - เหมือน Pokémon Center
   *   แผนกอื่น = แขกยืนหน้าประตูห้อง (ทางเดินแถว 10) คนตอบเดินมายืนรับที่ประตูด้านใน
   */
  private visitorSpots(host: Employee): { guest: Tile; guestDir: Dir; host: Tile; hostDir: Dir; hostSit: boolean } {
    // ตัดสินจาก "ที่นั่งจริง" ไม่ใช่แผนก - นั่งเคาน์เตอร์ PR = แขกยืนหน้าเคาน์เตอร์, นั่งโต๊ะ = แขกยืนหน้าโต๊ะ
    const home = this.homeOf(host);
    if (this.lay.isPrSeat(host.seat)) {
      const g = this.lay.prGuestSpot(home);
      return { guest: g, guestDir: flipDir(home.dir), host: host.seat, hostDir: home.dir, hostSit: true };
    }
    const freeTile = (t: Tile) => tileFree(t.x, t.y) && !this.employees.some((o) => o !== host && o.tx === t.x && o.ty === t.y);
    // คนตอบนั่งที่เดิม แขกยืนหน้าโต๊ะ (พ้นโต๊ะไป 1 ช่อง) หรือช่องว่างข้าง ๆ
    const dir = home.dir;
    const v = VEC[dir];
    const flip: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const cands: Tile[] = [
      { x: host.seat.x + v.x * 2, y: host.seat.y + v.y * 2 },
      { x: host.seat.x - v.x, y: host.seat.y - v.y },
      { x: host.seat.x + v.y, y: host.seat.y + v.x }, { x: host.seat.x - v.y, y: host.seat.y - v.x },
    ];
    const g = cands.find(freeTile) ?? cands[0];
    const gd: Dir = g.x === host.seat.x + v.x * 2 && g.y === host.seat.y + v.y * 2 ? flip[dir]
      : g.x < host.seat.x ? 'right' : g.x > host.seat.x ? 'left' : g.y < host.seat.y ? 'down' : 'up';
    return { guest: g, guestDir: gd, host: host.seat, hostDir: flip[gd], hostSit: true };
  }

  /** สร้างแขกที่ประตูสวน - คืน id (สุ่มหน้าตาจากชื่อ จะได้คนเดิมหน้าเดิมถ้าถามซ้ำ) */
  /**
   * มอเตอร์ไซค์ของแมสเซนเจอร์ (ต่อคน) - ขี่เข้ามาจากขอบแผนที่ จอดหน้าตึก แล้วคนขี่ลงเดินเข้าไปส่ง ขากลับขี่ออก
   * px/py = ตำแหน่งพิกเซล, tx/ty = ช่องที่จอด, rider = มีคนขี่อยู่ (วาดคนบนรถ), to = ปลายทางที่กำลังขี่ไป, done = เรียกเมื่อถึง
   */
  private bikes = new Map<string, { px: number; py: number; tx: number; ty: number; rider: Palette | null; to: { px: number; py: number } | null; queue: { px: number; py: number }[]; done: (() => void) | null; face: 'left' | 'right'; rev: number; puffT: number }>();
  /** ควันท่อ (พิกเซล) - เกิดตอนเร่งเครื่อง/วิ่ง ลอยออกไปด้านหลังแล้วจาง */
  private puffs: { x: number; y: number; vx: number; t: number }[] = [];

  /**
   * ที่จอดมอไซค์: ถ้าผู้ใช้วาง "ที่จอดมอไซค์" ไว้ในผัง ใช้อันที่ใกล้ประตูที่สุด (ต้องกลางแจ้งและมีแนวถนนถึงขอบ)
   * ไม่มีก็ใช้ช่องกลางแจ้งว่างที่ใกล้ประตูที่สุด (รัศมี 2)
   */
  private parkingSpot(): Tile {
    const gate = this.gateTile();
    const marked = this.lay.items.filter((i) => i.kind === 'parking' && !isIndoor(i.x, i.y) && this.ridePath({ x: i.x, y: i.y }))
      .map((i) => ({ t: { x: i.x, y: i.y }, d: Math.abs(i.x - gate.x) + Math.abs(i.y - gate.y) }))
      .sort((a, b) => a.d - b.d);
    if (marked[0]) return marked[0].t;
    const cands: { t: Tile; d: number }[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = { x: gate.x + dx, y: gate.y + dy };
      if ((dx === 0 && dy === 0) || t.x < 0 || t.y < 0 || t.x >= MW || t.y >= MH) continue;
      if (isIndoor(t.x, t.y) || !tileFree(t.x, t.y) || this.lay.at(t.x, t.y)) continue;
      if (!this.ridePath(t)) continue;
      cands.push({ t, d: Math.abs(dx) + Math.abs(dy) + (dy < 0 ? 0.5 : 0) });
    }
    cands.sort((a, b) => a.d - b.d);
    return cands[0]?.t ?? gate;
  }
  /** ช่องที่รถวิ่งผ่านได้: กลางแจ้ง เดินได้ และไม่มีของตั้งพื้น (ของบนพื้นอย่างพรม/ที่จอดขี่ทับได้) */
  private rideOk(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= MW || y >= MH || isIndoor(x, y) || !tileFree(x, y)) return false;
    const it = this.lay.at(x, y);
    return !it || it.kind === 'parking' || !!FURN[it.kind].decal;
  }
  /**
   * เส้นทางรถจาก "ขอบแผนที่" มาถึงช่องนี้ (BFS บนพื้นกลางแจ้ง เลี้ยวได้เหมือนคนเดิน) - คืนลำดับช่องจากขอบ -> ปลายทาง หรือ null
   * จุดแรกคือช่องริมขอบ (รถจะโผล่จากนอกจอเลยช่องนั้นไปอีก 1 ช่อง)
   */
  private ridePath(t: Tile): Tile[] | null {
    if (!this.rideOk(t.x, t.y) && !(this.lay.at(t.x, t.y)?.kind === 'parking')) return null;
    const key = (x: number, y: number) => y * MW + x;
    const prev = new Map<number, number>();
    const q: Tile[] = [t];
    prev.set(key(t.x, t.y), -1);
    let edge: Tile | null = null;
    while (q.length) {
      const c = q.shift()!;
      if (c.x === 0 || c.y === 0 || c.x === MW - 1 || c.y === MH - 1) { edge = c; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = c.x + dx, ny = c.y + dy;
        if (prev.has(key(nx, ny)) || !this.rideOk(nx, ny)) continue;
        prev.set(key(nx, ny), key(c.x, c.y));
        q.push({ x: nx, y: ny });
      }
    }
    if (!edge) return null;
    const path: Tile[] = [];
    let k: number | undefined = key(edge.x, edge.y);
    while (k !== undefined && k !== -1) { path.push({ x: k % MW, y: Math.floor(k / MW) }); k = prev.get(k); }
    return path; // เรียงจากขอบ -> ปลายทาง
  }
  /** จุดนอกจอถัดจากช่องริมขอบ (ให้รถโผล่/หายไปจริง ๆ) */
  private offscreenOf(edge: Tile): { px: number; py: number } {
    const px = edge.x * TS + 8, py = edge.y * TS + TS;
    if (edge.x === MW - 1) return { px: px + TS * 1.5, py };
    if (edge.x === 0) return { px: px - TS * 1.5, py };
    if (edge.y === MH - 1) return { px, py: py + TS * 1.5 };
    return { px, py: py - TS * 1.5 };
  }
  private toPx = (t: Tile) => ({ px: t.x * TS + 8, py: t.y * TS + TS });

  /**
   * แมสเซนเจอร์ขี่มอไซค์เข้ามาจากขอบแผนที่ (ฝั่งที่ใกล้ประตู) มาจอดหน้าตึก แล้วลงจากรถ
   * resolve เป็น id ตัวละคร (ยืนอยู่ข้างรถ) - จากนั้นใช้ visitorApproach ต่อได้เลย
   */
  /** ที่จอดล่าสุดที่แมสเซนเจอร์เลือก + เหตุผล (ดีบัก/แถบสถานะ) */
  lastParking: { x: number; y: number; marked: boolean } | null = null;
  spawnCourierRideIn(name: string): Promise<string> {
    const park = this.parkingSpot();
    this.lastParking = { x: park.x, y: park.y, marked: this.lay.items.some((i) => i.kind === 'parking' && i.x === park.x && i.y === park.y) };
    console.info('[courier] parking at', park, 'marked spots:', this.lay.items.filter((i) => i.kind === 'parking').map((i) => `${i.x},${i.y} indoor=${isIndoor(i.x, i.y)} path=${!!this.ridePath({ x: i.x, y: i.y })}`));
    const s = Array.from(name).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const pal: Palette = { ...makePalette(s, '#ffb000', false), helmet: '#e8622a' };
    const id = `courier-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const path = this.ridePath(park) ?? [park];
    const start = this.offscreenOf(path[0]);
    const queue = path.map(this.toPx);
    // กล้องตามรถตั้งแต่โผล่จากขอบ - จะได้เห็นวิ่งเข้ามาจอด (ซูมเข้าหน่อยเหมือนตอนตามแขก)
    this.camTarget = null; this.follow = id;
    if (this.cam.z < this.fitZ * 2) this.cam.z = this.fitZ * 2.5;
    return new Promise((resolve) => {
      this.bikes.set(id, {
        px: start.px, py: start.py, tx: park.x, ty: park.y, rider: pal, to: queue.shift() ?? null, queue,
        face: start.px > (queue[0]?.px ?? start.px) ? 'left' : 'right', rev: 0, puffT: 0,
        done: () => {
          // ถึงที่จอด - เร่งเครื่องแง๊น ๆ แป๊บนึง แล้วลงจากรถ (สร้างตัวละครยืนข้างรถ ถือซอง)
          const b = this.bikes.get(id);
          if (!b) return;
          b.to = null; b.done = null; b.rev = 1.2;
          window.setTimeout(() => {
            b.rider = null;
            const vid = this.spawnVisitor(name, s, { courier: true, at: park, bikeId: id });
            resolve(vid);
          }, 900);
        },
      });
    });
  }

  /** แมสเซนเจอร์เดินกลับไปที่รถ ขึ้นรถ แล้วขี่ออกไปทางขอบแผนที่ */
  async courierLeave(visitorId: string): Promise<void> {
    const g = this.employees.find((x) => x.id === visitorId);
    if (!g) return;
    g.path = null; g.after = null;
    const bikeId = this.bikeOf.get(visitorId);
    const b = bikeId ? this.bikes.get(bikeId) : undefined;
    const spot = b ? { x: b.tx, y: b.ty } : this.gateTile();
    await this.walk(g, spot.x, spot.y);
    this.employees = this.employees.filter((x) => x.id !== g.id);
    if (this.selected?.id === g.id) this.selected = null;
    if (this.follow === g.id) this.follow = null;
    if (!b || !bikeId) return;
    b.rider = g.pal;
    const path = (this.ridePath({ x: b.tx, y: b.ty }) ?? [{ x: b.tx, y: b.ty }]).slice().reverse(); // ปลายทาง -> ขอบ
    const out = [...path.slice(1).map(this.toPx), this.offscreenOf(path[path.length - 1])];
    b.face = (out[0]?.px ?? b.px) < b.px ? 'left' : 'right';
    this.camTarget = null; this.follow = bikeId; // กล้องตามตอนขี่ออก
    b.rev = 0.8; // สตาร์ทเครื่อง แง๊น ๆ ก่อนออกตัว
    await new Promise<void>((r) => window.setTimeout(r, 800));
    await new Promise<void>((resolve) => { b.queue = out; b.to = b.queue.shift() ?? null; b.done = () => { this.bikes.delete(bikeId); resolve(); }; });
    this.bikeOf.delete(visitorId);
  }
  /** ตัวละครแมสเซนเจอร์ -> รถของเขา */
  private bikeOf = new Map<string, string>();
  private riderAtlases = new Map<string, HTMLCanvasElement>();
  private riderAtlas(pal: Palette): HTMLCanvasElement {
    const k = JSON.stringify(pal);
    let a = this.riderAtlases.get(k);
    if (!a) { a = buildAtlas(pal); this.riderAtlases.set(k, a); }
    return a;
  }

  /** ขยับมอไซค์ที่กำลังวิ่ง (เรียกจาก update ทุกเฟรม) */
  private updateBikes(dt: number) {
    this.bikes.forEach((b) => {
      const back = b.face === 'left' ? 1 : -1; // ควันออกท้ายรถ (ด้านตรงข้ามกับที่หัน)
      if (b.rev > 0) {
        b.rev -= dt;
        b.puffT -= dt;
        if (b.puffT <= 0) { b.puffT = 0.12; this.puffs.push({ x: b.px + back * 8, y: b.py - 5, vx: back * 14, t: 0.7 }); }
      }
      if (!b.to) return;
      const dx = b.to.px - b.px, dy = b.to.py - b.py;
      const dist = Math.hypot(dx, dy);
      // วิ่งช้าลงเมื่อใกล้ที่จอด (เหลือ 2 ช่องสุดท้าย) จะได้เห็นเบรก-เข้าซอง
      const slow = b.queue.length === 0 && dist < TS * 2 ? 0.55 : 1;
      const step = 64 * slow * dt;
      b.puffT -= dt;
      if (b.puffT <= 0) { b.puffT = 0.11; this.puffs.push({ x: b.px + back * 8 + (Math.random() * 2 - 1), y: b.py - 5, vx: back * 12, t: 0.7 }); }
      if (dist <= step) {
        b.px = b.to.px; b.py = b.to.py;
        b.to = b.queue.shift() ?? null; // ช่องถัดไปในเส้นทาง
        if (!b.to) { const f = b.done; b.done = null; f?.(); }
        return;
      }
      b.px += (dx / dist) * step; b.py += (dy / dist) * step;
      if (Math.abs(dx) > 0.5) b.face = dx < 0 ? 'left' : 'right';
    });
    for (const q of this.puffs) { q.t -= dt; q.x += q.vx * dt; q.y -= 6 * dt; }
    this.puffs = this.puffs.filter((q) => q.t > 0);
  }

  spawnVisitor(name: string, seed?: number, opts: { courier?: boolean; at?: Tile; bikeId?: string } = {}): string {
    const id = `visitor-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const gate = opts.at ?? this.gateTile();
    const s = seed ?? Array.from(name).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
    // เสื้อโทนอบอุ่นให้ต่างจากพนักงาน (พนักงานใส่สีแผนก) - ดูออกทันทีว่าเป็นคนนอก
    const shirts = ['#d9a066', '#c46b6b', '#7aa2c9', '#a08ad6', '#e0c060', '#8fbf7f'];
    // แมสเซนเจอร์: เสื้อกั๊กส้ม + หมวกกันน็อก + ถือซองเอกสาร และมีมอไซค์จอดข้างประตู
    const pal = opts.courier
      ? { ...makePalette(s, '#ffb000', false), helmet: '#e8622a' }
      : makePalette(s, shirts[s % shirts.length], s % 2 === 1);
    if (opts.courier && opts.bikeId) this.bikeOf.set(id, opts.bikeId);
    else if (opts.courier) {
      // เรียกตรง ๆ โดยไม่ได้ขี่เข้ามา - วางรถจอดไว้หน้าตึกให้เลย
      const spot = this.parkingSpot();
      this.bikes.set(`bike-${id}`, { px: spot.x * TS + 8, py: spot.y * TS + TS, tx: spot.x, ty: spot.y, rider: null, to: null, queue: [], done: null, face: 'left', rev: 0, puffT: 0 });
      this.bikeOf.set(id, `bike-${id}`);
    }
    this.employees.push({
      id, name, title: opts.courier ? 'แมสเซนเจอร์' : 'ลูกค้า', deptId: '__visitor__', role: 'proposer', lens: '',
      pal, atlas: buildAtlas(pal),
      seat: { ...gate },
      tx: gate.x, ty: gate.y, px: gate.x * TS + 8, py: gate.y * TS + TS,
      dir: 'left', pose: 'stand', frame: 0, animT: 0,
      state: 'idle', timer: Number.POSITIVE_INFINITY,
      speed: 46,
      path: null, after: null,
      bubble: null, bubbleT: 0,
      sayFull: '', sayChars: 0, sayT: 0, sayPage: 0, sayHold: 0,
      gadget: opts.courier ? 'envelope' : null,
      busy: true, isVisitor: true, owner: 'sim',
    });
    if (opts.courier) { const e = this.employees[this.employees.length - 1]; e.speed = 58; }
    return id;
  }
  /** แมสเซนเจอร์ยื่นซองให้แล้ว - ซองย้ายไปอยู่กับคนรับ (คนรับถือแฟ้ม/โน้ต) */
  handOver(courierId: string, hostId: string) {
    const c = this.employees.find((x) => x.id === courierId);
    const h = this.employees.find((x) => x.id === hostId);
    if (c) c.gadget = null;
    if (h) { h.gadget = 'notes'; h.bubble = 'idea'; h.bubbleT = 2; }
  }

  /**
   * แขกเดินเข้ามาหาคนตอบ พร้อมกันนั้นคนตอบเตรียมรับ (PR นั่งหันลง / แผนกอื่นเดินมาที่ประตู)
   * resolve เมื่อทั้งคู่เข้าที่ - จากนั้นใช้ say(guest, คำถาม) / say(host, คำตอบ) ได้เลย
   */
  async visitorApproach(visitorId: string, hostId: string): Promise<void> {
    const g = this.employees.find((x) => x.id === visitorId);
    const h = this.employees.find((x) => x.id === hostId);
    if (!g) return;
    if (!h) { const sp = this.pickSpot(g, this.idleSpots()); if (sp) await this.walk(g, sp.x, sp.y); return; }
    const spot = this.visitorSpots(h);
    h.busy = true; h.path = null; h.after = null;
    this.clearSay([h.id]);
    const hostGo = spot.hostSit
      ? this.walk(h, spot.host.x, spot.host.y).then(() => this.sitAt(h, spot.host.x, spot.host.y, spot.hostDir, 'report', 9999))
      : this.walk(h, spot.host.x, spot.host.y).then(() => { h.pose = 'stand'; h.dir = spot.hostDir; h.state = 'report'; h.timer = 9999; });
    const guestGo = this.walk(g, spot.guest.x, spot.guest.y).then(() => { g.pose = 'stand'; g.dir = spot.guestDir; g.state = 'idle'; });
    await Promise.all([hostGo, guestGo]);
    if (h) { h.bubble = 'talk'; h.bubbleT = 2; }
  }

  /** คนตอบกำลังคิด (รอ LLM) - ฟองคิดค้างไว้จนกว่าจะพูด */
  visitorHostThinking(hostId: string) {
    const h = this.employees.find((x) => x.id === hostId);
    if (h) { h.bubble = 'type'; h.bubbleT = 9999; }
  }

  /**
   * แขกไปนั่งรอที่โซฟาล็อบบี้ (คนตอบต้องไปปรึกษาทีมก่อน) - resolve เมื่อนั่งแล้ว
   * โซฟาเต็มก็ยืนรอข้าง ๆ - ไม่ให้แขกยืนขวางหน้าเคาน์เตอร์ระหว่างรอ
   */
  async visitorWait(visitorId: string): Promise<void> {
    const g = this.employees.find((x) => x.id === visitorId);
    if (!g) return;
    g.path = null; g.after = null;
    const free = this.pickSpot(g, this.lay.loungeSeats().filter((q) => q.item.kind === 'sofa'));
    if (free) {
      const dir = this.lay.loungeSeats().find((q) => q.x === free.x && q.y === free.y)?.dir ?? 'down';
      await this.walk(g, free.x, free.y);
      this.sitAt(g, free.x, free.y, dir, 'lounge', Number.POSITIVE_INFINITY);
    } else {
      const spot = this.pickSpot(g, this.idleSpots()) ?? { x: g.tx, y: g.ty };
      await this.walk(g, spot.x, spot.y);
      g.pose = 'stand'; g.dir = 'left'; g.state = 'idle';
    }
    g.bubble = 'coffee'; g.bubbleT = 3;
  }

  /** คนตอบเดินกลับมาหาแขก (ที่โซฟา/ที่ยืนรอ) มายืนตรงหน้า หันเข้าหากัน - resolve เมื่อถึง */
  async visitorReturn(hostId: string, visitorId: string): Promise<void> {
    const h = this.employees.find((x) => x.id === hostId);
    const g = this.employees.find((x) => x.id === visitorId);
    if (!h || !g) return;
    h.busy = true; h.path = null; h.after = null;
    // ยืนหน้าแขก 1 ช่อง (ด้านล่างถ้าเดินได้ ไม่งั้นซ้าย/ขวา)
    const cands: Tile[] = [{ x: g.tx, y: g.ty + 1 }, { x: g.tx - 1, y: g.ty }, { x: g.tx + 1, y: g.ty }, { x: g.tx, y: g.ty - 1 }];
    const spot = cands.find((t) => tileFree(t.x, t.y) && !this.employees.some((o) => o !== h && o.tx === t.x && o.ty === t.y)) ?? cands[0];
    await this.walk(h, spot.x, spot.y);
    h.pose = 'stand'; h.state = 'report'; h.timer = 9999;
    this.faceToward(h.id, g.id);
    this.faceToward(g.id, h.id);
    if (g.pose === 'sit') g.pose = 'sit';
  }

  /** แขกเดินกลับออกประตูสวนแล้วหายไป คนตอบกลับที่ประจำ - resolve เมื่อแขกพ้นจอ */
  async visitorLeave(visitorId: string, hostId?: string): Promise<void> {
    const g = this.employees.find((x) => x.id === visitorId);
    if (hostId) {
      const h = this.employees.find((x) => x.id === hostId);
      if (h) {
        h.bubble = null; h.bubbleT = 0;
        h.path = null; h.after = null;
        this.goTo(h, h.seat.x, h.seat.y, () => {
          this.sitAt(h, h.seat.x, h.seat.y, this.seatDirOf(h), 'work', 6 + Math.random() * 6);
          h.busy = false;
        });
      }
    }
    if (!g) return;
    g.path = null; g.after = null;
    const gate = this.gateTile();
    await this.walk(g, gate.x, gate.y);
    const bk = this.bikeOf.get(g.id); if (bk) { this.bikes.delete(bk); this.bikeOf.delete(g.id); }
    this.employees = this.employees.filter((x) => x.id !== g.id);
    if (this.selected?.id === g.id) this.selected = null;
    if (this.follow === g.id) this.follow = null;
  }

  /* ============================================================
     AI ล่ม / ไม่ได้เชื่อม -> ทั้งออฟฟิศพักยาว
     ============================================================ */
  isAiDown() { return this.aiDown; }
  /** หน้าเว็บบอกสถานะ AI - down (มีเหตุผล) = ทุกคนลุกจากโต๊ะไปพัก, null = กลับมาทำงานตามปกติ */
  setAiDown(reason: string | null) {
    const was = !!this.aiDown;
    this.aiDown = reason;
    if (!!reason === was) return;
    this.employees.forEach((e) => {
      if (e.busy || e.isBoss || e.isVisitor || !Number.isFinite(e.timer)) return;
      // เพิ่งรู้ว่า AI ล่ม: คนที่นั่งโต๊ะอยู่ทยอยลุกใน 1-5 วิ / AI กลับมา: คนที่พักอยู่ทยอยกลับใน 2-8 วิ
      if (reason && e.state === 'work') e.timer = Math.min(e.timer, 1 + Math.random() * 4);
      else if (!reason && e.state !== 'work' && e.state !== 'walk') e.timer = Math.min(e.timer, 2 + Math.random() * 6);
    });
  }
  /** จุดยืนสูบบุหรี่ - นอกตึก ใกล้ทางเข้าถ้ามี ไม่มีก็ที่ว่างกลางแจ้งที่ไหนก็ได้ */
  private smokeSpots(): Tile[] {
    const ent = this.lay.entrance();
    const pick = (near: boolean) => {
      const out: Tile[] = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        if (isIndoor(x, y) || !tileFree(x, y) || this.lay.at(x, y)) continue;
        if (near && ent && (Math.abs(x - ent.x) > 5 || Math.abs(y - ent.y) > 4)) continue;
        out.push({ x, y });
      }
      return out;
    };
    const near = ent ? pick(true) : [];
    const all = near.length ? near : pick(false);
    for (let i = all.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [all[i], all[j]] = [all[j], all[i]]; }
    return all.slice(0, 10);
  }
  /** พฤติกรรมตอน AI ล่ม - ไม่มีใครนั่งทำงาน: กาแฟ ข้าว โซฟา สวน สูบบุหรี่ คุยกัน (พักนานกว่าปกติ) */
  private decideBreak(e: Employee) {
    const roll = Math.random();
    const long = (a: number, b: number) => a + Math.random() * b;
    if (roll < 0.2) {
      const spot = this.pickSpot(e, this.lay.spots('cooler'));
      if (spot) {
        this.goTo(e, spot.x, spot.y, () => {
          e.pose = 'stand'; e.dir = 'up'; e.state = 'coffee';
          e.timer = long(8, 10); e.bubble = 'coffee'; e.bubbleT = 4;
        });
        return;
      }
    }
    if (roll < 0.38) {
      const spot = this.pickSpot(e, this.lay.spots('counter'));
      if (spot) {
        this.goTo(e, spot.x, spot.y, () => {
          e.pose = 'stand'; e.dir = 'up'; e.state = 'eat';
          e.timer = long(10, 12); e.bubble = 'food'; e.bubbleT = 5;
        });
        return;
      }
    }
    if (roll < 0.56) {
      const seats = this.lay.loungeSeats();
      const s = this.pickSpot(e, seats);
      if (s) {
        const dir = seats.find((q) => q.x === s.x && q.y === s.y)?.dir ?? 'down';
        this.goTo(e, s.x, s.y, () => {
          this.sitAt(e, s.x, s.y, dir, 'lounge', long(12, 14));
          e.bubble = 'music'; e.bubbleT = 4;
        });
        return;
      }
    }
    if (roll < 0.76) {
      const s = this.pickSpot(e, this.smokeSpots());
      if (s) {
        this.goTo(e, s.x, s.y, () => {
          e.pose = 'stand'; e.dir = rnd<Dir>(['down', 'left', 'right']); e.state = 'smoke';
          e.timer = long(10, 12); e.bubble = 'smoke'; e.bubbleT = 5;
        });
        return;
      }
    }
    if (roll < 0.9) {
      const b = this.pickSpot(e, this.lay.benchSeats());
      if (b) {
        this.goTo(e, b.x, b.y, () => {
          this.sitAt(e, b.x, b.y, 'down', 'bench', long(12, 14));
          e.bubble = rnd<BubbleIcon>(['music', 'coffee', 'smoke']); e.bubbleT = 4;
        });
        return;
      }
      const s = this.pickSpot(e, this.lay.pondSpots());
      if (s) {
        this.goTo(e, s.x, s.y, () => {
          e.pose = 'stand'; e.dir = 'right'; e.state = 'pond';
          e.timer = long(8, 10); e.bubble = 'idea'; e.bubbleT = 3;
        });
        return;
      }
    }
    // ไปคุยกับคนที่ยืนพักอยู่ หรือไม่ก็ยืนเล่นแถวนั้น
    const other = this.employees.find((o) => o !== e && !o.busy && o.pose !== 'walk' && (o.state === 'smoke' || o.state === 'coffee' || o.state === 'idle' || o.state === 'eat'));
    if (other) {
      const spot = ([[other.tx - 1, other.ty], [other.tx + 1, other.ty], [other.tx, other.ty + 1]] as const)
        .find(([x, y]) => tileFree(x, y) && !this.lay.at(x, y) && !this.spotTaken(x, y, e));
      if (spot) {
        this.goTo(e, spot[0], spot[1], () => {
          e.pose = 'stand';
          e.dir = spot[0] < other.tx ? 'right' : spot[0] > other.tx ? 'left' : 'up';
          e.state = 'chat'; e.timer = long(6, 8); e.bubble = 'talk'; e.bubbleT = 3;
        });
        return;
      }
    }
    const s = this.pickSpot(e, this.idleSpots());
    if (!s) { e.timer = 3; return; }
    this.goTo(e, s.x, s.y, () => { e.pose = 'stand'; e.state = 'idle'; e.timer = long(4, 6); });
  }

  /* ============================================================
     AI สุ่มพฤติกรรมตอนว่าง
     ============================================================ */
  private decide(e: Employee) {
    if (e.busy) { e.timer = 5; return; }
    if (this.aiDown) { this.decideBreak(e); return; }
    if (e.isSecretary) { this.decideSecretary(e); return; }
    const roll = Math.random();

    if (roll < 0.36) {
      this.goTo(e, e.seat.x, e.seat.y, () => {
        this.sitAt(e, e.seat.x, e.seat.y, this.seatDirOf(e), 'work', 10 + Math.random() * 16);
        if (Math.random() < 0.5) { e.bubble = 'type'; e.bubbleT = 2; }
      });
    } else if (roll < 0.5) {
      const spot = this.pickSpot(e, this.lay.spots('cooler'));
      if (!spot) { e.timer = 2; return; }
      this.goTo(e, spot.x, spot.y, () => {
        e.pose = 'stand'; e.dir = 'up'; e.state = 'coffee';
        e.timer = 3 + Math.random() * 4; e.bubble = 'coffee'; e.bubbleT = 3;
      });
    } else if (roll < 0.6) {
      const spot = this.pickSpot(e, this.lay.spots('counter'));
      if (!spot) { e.timer = 2; return; }
      this.goTo(e, spot.x, spot.y, () => {
        e.pose = 'stand'; e.dir = 'up'; e.state = 'eat';
        e.timer = 5 + Math.random() * 6; e.bubble = 'food'; e.bubbleT = 4;
      });
    } else if (roll < 0.72) {
      const seats = this.lay.loungeSeats();
      const s = this.pickSpot(e, seats);
      if (s) {
        const dir = seats.find((q) => q.x === s.x && q.y === s.y)?.dir ?? 'down';
        this.goTo(e, s.x, s.y, () => {
          this.sitAt(e, s.x, s.y, dir, 'lounge', 6 + Math.random() * 8);
          e.bubble = 'music'; e.bubbleT = 3;
        });
      } else e.timer = 2;
    } else if (roll < 0.86) {
      if (Math.random() < 0.6) {
        const s = this.pickSpot(e, this.lay.benchSeats());
        if (s) {
          this.goTo(e, s.x, s.y, () => {
            this.sitAt(e, s.x, s.y, 'down', 'bench', 10 + Math.random() * 12);
            e.bubble = rnd<BubbleIcon>(['music', 'idea', 'coffee']); e.bubbleT = 3;
          });
          return;
        }
      }
      const s = this.pickSpot(e, this.lay.pondSpots());
      if (!s) { e.timer = 2; return; }
      this.goTo(e, s.x, s.y, () => {
        e.pose = 'stand'; e.dir = 'right'; e.state = 'pond';
        e.timer = 6 + Math.random() * 8; e.bubble = 'idea'; e.bubbleT = 3;
      });
    } else if (roll < 0.93) {
      const s = this.pickSpot(e, this.idleSpots());
      if (!s) { e.timer = 2; return; }
      this.goTo(e, s.x, s.y, () => {
        e.pose = 'stand'; e.state = 'idle'; e.timer = 2 + Math.random() * 4;
      });
    } else {
      const other = this.employees.find((o) => o !== e && o.state === 'work' && !o.busy);
      if (other) {
        const spot = ([[other.tx - 1, other.ty], [other.tx + 1, other.ty], [other.tx, other.ty - 1]] as const)
          .find(([x, y]) => tileFree(x, y) && !this.spotTaken(x, y, e));
        if (spot) {
          this.goTo(e, spot[0], spot[1], () => {
            e.pose = 'stand';
            e.dir = spot[0] < other.tx ? 'right' : spot[0] > other.tx ? 'left' : 'down';
            e.state = 'chat'; e.timer = 4 + Math.random() * 4;
            e.bubble = 'talk'; e.bubbleT = 4;
            other.bubble = 'talk'; other.bubbleT = 4;
          });
          return;
        }
      }
      e.timer = 2;
    }
  }

  /* ============================================================
     Update / Render
     ============================================================ */
  private update(dt: number) {
    this.updateBikes(dt);
    for (const e of this.employees) {
      if (e.bubbleT > 0) { e.bubbleT -= dt; if (e.bubbleT <= 0) e.bubble = null; }

      // ตัวที่คนอื่นเป็นเจ้าของ - ไม่คิดเส้นทางเอง แค่ไล่ตามค่าที่ได้รับ
      if (e.owner === 'remote') {
        if (e.remote) {
          const k = Math.min(1, dt * 12);
          e.px += (e.remote.px - e.px) * k;
          e.py += (e.remote.py - e.py) * k;
          e.dir = e.remote.dir;
          e.pose = e.remote.pose;
          e.tx = Math.round((e.px - 8) / TS);
          e.ty = Math.round((e.py - TS) / TS);
        }
        e.animT += dt * (e.pose === 'walk' ? 9 : 2.2);
        e.frame = Math.floor(e.animT) % 4;
        continue;
      }
      if (e.sayT > 0) {
        /**
         * กล่องข้อความแบบเกม Pokémon: พิมพ์ทีละตัวจนเต็มหน้า -> ค้างให้อ่าน -> พลิกหน้า
         * ความยาวหน้าถูกคำนวณตอนวาด (renderSpeech เก็บไว้ที่ this.pageLen) เพราะขึ้นกับซูม
         * ถ้ายังไม่เคยวาด (คนพูดอยู่นอกจอ) ให้พิมพ์ต่อไปเรื่อย ๆ จนจบแล้วค้างตามปกติ
         */
        const rest = e.sayFull.length - e.sayPage;
        const pageLen = Math.min(rest, this.pageLen.get(e.id) ?? rest);
        if (e.sayChars < pageLen) {
          e.sayChars = Math.min(pageLen, e.sayChars + dt * 42); // ~42 ตัวอักษร/วินาที
        } else {
          e.sayHold -= dt;
          if (e.sayHold <= 0) {
            if (e.sayPage + pageLen < e.sayFull.length) {
              // ยังมีหน้าถัดไป - พลิก
              e.sayPage += pageLen;
              e.sayChars = 0;
              e.sayHold = 2.2;
            } else {
              e.sayFull = ''; e.sayChars = 0; e.sayPage = 0; e.sayT = 0;
              this.pageLen.delete(e.id);
              this.pageCache.delete(e.id);
              this.shownCache.delete(e.id);
              this.speechGap = 0.5; // เว้นจังหวะก่อนคนถัดไปพูด
            }
          }
        }
      }

      if (e.path && e.path.length) {
        const n = e.path[0];
        const gx = n.x * TS + 8, gy = n.y * TS + TS;
        const dx = gx - e.px, dy = gy - e.py;
        const dist = Math.hypot(dx, dy);
        const step = e.speed * dt;
        if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? 'right' : 'left';
        else if (dy !== 0) e.dir = dy > 0 ? 'down' : 'up';

        if (dist <= step) {
          e.px = gx; e.py = gy; e.tx = n.x; e.ty = n.y;
          e.path.shift();
          if (!e.path.length) {
            e.path = null;
            // ถึงแล้วแต่มีคนยืน/นั่งอยู่ก่อน (จุดยืนธรรมดา ไม่ใช่ที่นั่ง/โต๊ะตัวเอง) -> ขยับไปช่องข้าง ๆ ก่อนค่อยทำต่อ
            const blocked = this.employees.some((o) => o !== e && !o.path?.length && o.tx === e.tx && o.ty === e.ty);
            if (blocked && !this.lay.at(e.tx, e.ty) && !(e.tx === e.seat.x && e.ty === e.seat.y)) {
              const alt = this.freeNeighbor(e);
              if (alt) { const f = e.after; e.after = null; this.goTo(e, alt.x, alt.y, f); continue; }
            }
            const f = e.after; e.after = null;
            f?.();
          }
        } else {
          e.px += (dx / dist) * step;
          e.py += (dy / dist) * step;
        }
        if (e.path) e.pose = 'walk';
        e.animT += step;
        e.frame = Math.floor(e.animT / 4) % 4;
        continue;
      }

      e.animT += dt * (e.pose === 'sit' ? 4.2 : 2.2);
      e.frame = Math.floor(e.animT) % 4;
      if (e.pose === 'walk') e.pose = 'stand';

      // ระหว่างรอ LLM ให้มีไอคอนขยับบ้าง แต่พอเริ่มมีคนพูดจริงต้องเงียบ
      // ไม่งั้นไอคอนสุ่มจะเด้งแข่งกับบทสนทนาจนดูมั่ว
      if (e.state === 'think' && !e.bubble && !this.isSpeaking() && Math.random() < dt * 0.7) {
        e.bubble = rnd<BubbleIcon>(['talk', 'idea', 'board', 'question']);
        e.bubbleT = 1.6 + Math.random();
      }

      e.timer -= dt;
      if (e.timer <= 0) {
        if (e.busy) { e.timer = 5; continue; }
        if (e.state === 'work' && !this.aiDown && Math.random() < 0.55) {
          e.timer = 6 + Math.random() * 10;
          e.bubble = rnd<BubbleIcon>(['type', 'idea', 'talk']);
          e.bubbleT = 2;
        } else this.decide(e);
      }
    }
    this.pumpSpeech(dt);
  }

  /** ชั้นพื้นของเฟรมน้ำ wf - วาดครั้งแรกที่ขอ แล้วใช้ซ้ำตลอด */
  private floor(wf: number): HTMLCanvasElement {
    const hit = this.floorLayer[wf];
    if (hit) return hit;
    const { c, g: ctx } = mk(BW, BH);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) ctx.drawImage(tileSprite(GROUND[y][x], x, y, wf), x * TS, y * TS);
    }
    // ลายพื้น (พรม/ตรา) ต้องมาหลังปูกระเบื้อง แต่ก่อนเงาผนังกับของทุกชิ้น - ตราวาดโลโก้ทับถ้ามี
    this.lay.decals.forEach((d) => {
      // กรอบโลโก้แสดงเฉพาะตอนยังไม่มีรูป (หรือในโหมดจัด) - มีรูปแล้ววาดรูปอย่างเดียว
      const hasLogo = !!(this.logoImg && this.logoImg.complete && this.logoImg.naturalWidth > 0);
      if (d.type !== 'logo' || !hasLogo || this.editOn) ctx.drawImage(decalSprite(d), d.x * TS, d.y * TS);
      if (d.type === 'logo' && hasLogo) this.drawLogoInto(ctx, d.x * TS + 1, d.y * TS + 1, d.w * TS - 2, d.h * TS - 2);
    });
    this.lay.wallDecor.forEach((d) => {
      if (d.type !== 'logo') { ctx.drawImage(decorSprite(d.type), d.x * TS, d.y * TS); return; }
      // ป้ายโลโก้ติดผนัง: กรอบทอง พื้นครีม แล้ววาดรูปโลโก้ให้พอดี
      const w = (d.w ?? 1) * TS, h = (d.h ?? 1) * TS, x0 = d.x * TS, y0 = d.y * TS;
      ctx.fillStyle = '#3a2c1a'; ctx.fillRect(x0 + 1, y0 + 2, w - 2, h - 3);
      ctx.fillStyle = '#f0e2c0'; ctx.fillRect(x0 + 2, y0 + 3, w - 4, h - 5);
      ctx.fillStyle = '#d8b060'; ctx.fillRect(x0 + 1, y0 + 2, w - 2, 1); ctx.fillRect(x0 + 1, y0 + 2, 1, h - 3);
      ctx.fillStyle = '#a07830'; ctx.fillRect(x0 + 1, y0 + h - 2, w - 2, 1); ctx.fillRect(x0 + w - 2, y0 + 2, 1, h - 3);
      this.drawLogoInto(ctx, x0 + 3, y0 + 4, w - 6, h - 7);
    });

    ctx.fillStyle = 'rgba(20,10,0,.13)';
    for (let y = 1; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (GROUND[y][x] !== '#' && GROUND[y - 1][x] === '#') ctx.fillRect(x * TS, y * TS, TS, 3);
        if (GROUND[y][x] !== '#' && x > 0 && GROUND[y][x - 1] === '#') ctx.fillRect(x * TS, y * TS, 2, TS);
      }
    }
    this.floorLayer[wf] = c;
    return c;
  }

  private render() {
    const ctx = this.ctx;
    const wf = Math.floor(performance.now() / 200) % 4;
    ctx.drawImage(this.floor(wf), 0, 0);

    type Item =
      | { sort: number; kind: 'obj'; o: MapObject }
      | { sort: number; kind: 'emp'; e: Employee };
    const list: Item[] = [];
    this.objs.forEach((o) => {
      const seat = o.type === 'chair' || o.type === 'sofa' || o.type === 'bench';
      // ระดับซ้อนที่ผู้ใช้ตั้ง (zb) เลื่อนความลึกทีละแถว - ค่าเริ่มต้นเรียงตามแถวจริง
      list.push({ sort: (o.y + (o.zb ?? 0)) * TS + TS - (seat ? 0.5 : 0), kind: 'obj', o });
      // เก้าอี้ที่คนหันหลัง/หันข้าง: พนักพิงส่วนที่อยู่ "หน้า" คนต้องวาดทับตัวคน ไม่งั้นดูเหมือนยืนหน้าเก้าอี้
      if (o.type === 'chair' && o.dir && o.dir !== 'down') {
        list.push({ sort: o.y * TS + TS + 0.5, kind: 'obj', o: { ...o, type: 'chairfront' } });
      }
    });
    this.employees.forEach((e) => list.push({ sort: e.py, kind: 'emp', e }));
    list.sort((a, b) => a.sort - b.sort);
    // มอไซค์แมสเซนเจอร์ (วิ่งอยู่/จอดอยู่) - วาดตามตำแหน่งพิกเซล มีคนขี่ก็วาดคนซ้อนบนเบาะ
    const drawBike = (b: { px: number; py: number; rider: Palette | null; face: 'left' | 'right'; rev: number; to: unknown }) => {
      const s = objSprite({ type: 'bike', x: 0, y: 0 });
      // เร่งเครื่อง = สั่นซ้ายขวา 1 พิกเซล / วิ่งอยู่ = กระเด้งขึ้นลงตามถนน
      const jit = b.rev > 0 ? (Math.floor(performance.now() / 45) % 2 ? 1 : -1) : 0;
      const bob = b.rev <= 0 && b.to ? (Math.floor(performance.now() / 90) % 2 ? -1 : 0) : 0;
      const x = Math.round(b.px - 8 - (s.ox ?? 0)) + jit, y = Math.round(b.py - TS - s.oy) + bob;
      if (b.rider) {
        // คนขี่วาด "ก่อน" รถ: หัว-ลำตัวโผล่เหนือเบาะ ส่วนสะโพก/ขาโดนตัวถังบังไป = ดูเหมือนคร่อมรถจริง ๆ
        const atlas = this.riderAtlas(b.rider);
        const di = DIRS.indexOf(b.face);
        ctx.drawImage(atlas, 4 * 16, di * 24, 16, 20, Math.round(b.px - 8) + jit, Math.round(b.py - 35) + bob, 16, 20);
      }
      ctx.save();
      if (b.face === 'right') { ctx.translate(x + s.c.width, 0); ctx.scale(-1, 1); ctx.drawImage(s.c, 0, y); }
      else ctx.drawImage(s.c, x, y);
      ctx.restore();
    };
    const bikeItems: { sort: number; b: { px: number; py: number; rider: Palette | null; face: 'left' | 'right'; rev: number; to: unknown } }[] = [];
    this.bikes.forEach((b) => bikeItems.push({ sort: b.py - 0.25, b }));

    let bi = 0;
    for (const it of list) {
      while (bi < bikeItems.length && bikeItems[bi].sort <= it.sort) drawBike(bikeItems[bi++].b);
      if (it.kind === 'obj') {
        const s = objSprite(it.o);
        ctx.drawImage(s.c, it.o.x * TS - (s.ox ?? 0), it.o.y * TS - s.oy);
        // ป้ายตั้งพื้น: วาดโลโก้ลงแผ่นป้าย (กินสองช่อง) - ต้องวาดหลังสไปรต์ช่องขวา (part 1) ไม่งั้นแผ่นป้ายช่องขวาทับโลโก้ครึ่งหนึ่ง
        if (it.o.type === 'logostand' && (it.o.part ?? 0) === 1) this.drawLogoInto(ctx, (it.o.x - 1) * TS + 3, it.o.y * TS - 7, 2 * TS - 6, 10);
      } else {
        const e = it.e;
        ctx.fillStyle = 'rgba(0,0,0,.20)';
        ctx.fillRect((e.px - 4) | 0, (e.py - 2) | 0, 8, 1);
        ctx.fillRect((e.px - 3) | 0, (e.py - 3) | 0, 6, 1);
        const di = DIRS.indexOf(e.dir);
        const col = (e.pose === 'sit' ? 4 : 0) + (e.pose === 'walk' || e.pose === 'sit' ? e.frame : 1);
        ctx.drawImage(e.atlas, col * 16, di * 24, 16, 24, (e.px - 8) | 0, (e.py - 24) | 0, 16, 24);
        // ของในมือ - วาดทับตัวละครในพิกัดเดียวกัน (สไปรต์ 16x24 มุมบนซ้ายอยู่ที่ px-8, py-24)
        if (e.gadget) {
          ctx.save();
          ctx.translate((e.px - 8) | 0, (e.py - 24) | 0);
          drawGadget(ctx, e.gadget, e.dir, e.pose, e.frame);
          ctx.restore();
        }
        if (this.selected?.id === e.id) {
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 1;
          ctx.strokeRect(((e.px - 8) + 0.5) | 0, ((e.py - 25) + 0.5) | 0, 15, 25);
        }
      }
    }
    while (bi < bikeItems.length) drawBike(bikeItems[bi++].b);
    // ควันท่อ - ก้อนเทาเล็ก ๆ จางลงตามเวลา
    for (const q of this.puffs) {
      const a = Math.max(0, Math.min(1, q.t / 0.7));
      ctx.fillStyle = `rgba(150,158,168,${(0.55 * a).toFixed(2)})`;
      const r = q.t < 0.35 ? 2 : 1;
      ctx.fillRect(Math.round(q.x) - r, Math.round(q.y) - r, r * 2, r * 2);
    }

    this.employees.forEach((e) => {
      if (e.bubble) drawBubble(ctx, (e.px - 2) | 0, (e.py - 38) | 0, e.bubble);
    });

    if (this.editOn) this.renderEdit(ctx);

    /* ---- ส่งลงจอจริงผ่านกล้อง ---- */
    const s = this.sctx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.imageSmoothingEnabled = false;
    s.fillStyle = '#0d1119';
    s.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = this.cam.z;
    const ox = Math.round(-this.cam.x * z);
    const oy = Math.round(-this.cam.y * z);
    s.setTransform(z, 0, 0, z, ox, oy);
    s.drawImage(this.base.c, 0, 0);
    s.setTransform(1, 0, 0, 1, 0, 0);

    /* ---- ป้ายชื่อโซนแผนก + ชื่อพนักงาน (วาดนอก transform ให้ font ไทยคม) ---- */
    const plateSize = clamp(Math.round(3.4 * z), 9, 30);
    s.textAlign = 'center';
    s.font = `700 ${plateSize}px "Segoe UI","Noto Sans Thai",sans-serif`;
    // ป้ายแผนก = ชิ้น deptsign ในผัง (ผู้ใช้ย้ายได้) - วาดกลางช่องของป้าย
    const plates = this.lay.deptSigns().map((d) => ({ deptId: d.dept, text: d.text, bx: (d.x + 0.5) * TS, by: (d.y + 0.5) * TS + 4 }));
    plates.forEach(({ deptId, text, bx, by }) => {
      const d = DEPT_BY_ID.get(deptId);
      if (!d) return;
      const cx = bx * z + ox;
      const cy = by * z + oy;
      // ข้อความที่ผู้ใช้ตั้งเองมาก่อน ไม่ตั้ง = ชื่อย่อแผนก
      const label = text || t(d.shortTh);
      const w = s.measureText(label).width + plateSize;
      s.fillStyle = 'rgba(10,14,20,.72)';
      s.fillRect(cx - w / 2, cy - plateSize, w, plateSize * 1.5);
      s.fillStyle = d.color;
      s.fillRect(cx - w / 2, cy - plateSize, w, Math.max(2, plateSize * 0.2));
      s.fillStyle = '#fff';
      s.fillText(label, cx, cy + plateSize * 0.3);
    });

    // ป้ายชื่อต้องมาก่อนฟองคำพูดเสมอ ไม่งั้นชื่อจะไปทับข้อความในฟองจนอ่านไม่ออก
    // ชื่อคนพูดไม่หายไปไหน เพราะฟองมีหัวข้อเป็นชื่อ+บทบาทของเขาอยู่แล้ว
    if (this.showNames) {
      const fs = clamp(Math.round(4.4 * z), 11, 40);
      s.font = `600 ${fs}px "Segoe UI","Noto Sans Thai",sans-serif`;
      s.lineWidth = Math.max(2, fs / 5);
      s.lineJoin = 'round';
      this.employees.forEach((e) => {
        const x = e.px * z + ox;
        const y = (e.py - 27) * z + oy;
        if (x < -80 || x > this.canvas.width + 80 || y < -20 || y > this.canvas.height + 20) return;
        const nm = dispName(e);
        s.strokeStyle = 'rgba(10,14,20,.85)';
        s.strokeText(nm, x, y);
        s.fillStyle = e.busy ? '#ffd166' : '#fff';
        s.fillText(nm, x, y);
      });
    }

    this.renderSpeech(s, z, ox, oy);
  }

  /**
   * ฟองคำพูดข้อความจริง - วาดบนเลเยอร์จอ (ไม่ใช่ base canvas)
   * เพราะข้อความไทยที่ 16px จะอ่านไม่ออก
   * ตัดบรรทัดทีละตัวอักษร เพราะภาษาไทยไม่มีช่องว่างระหว่างคำ
   */
  /**
   * แบ่งข้อความเป็นบรรทัดตามความกว้างฟอง แล้วบอกว่าหน้านี้ใส่ได้กี่ตัวอักษร
   * ตัดทีละตัวอักษร (ไทยไม่มีช่องว่าง) คืนทั้งบรรทัดที่ได้และจำนวนตัวที่กินไป
   */
  private paginate(
    s: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number,
  ): { lines: string[]; used: number } {
    const lines: string[] = [];
    let cur = '';
    let used = 0;
    for (const ch of text) {
      if (ch === '\n') {
        lines.push(cur); cur = ''; used++;
        if (lines.length >= maxLines) return { lines, used };
        continue;
      }
      const next = cur + ch;
      if (s.measureText(next).width > maxW && cur) {
        lines.push(cur);
        if (lines.length >= maxLines) return { lines, used };
        cur = ch;
      } else cur = next;
      used++;
    }
    if (cur) lines.push(cur);
    return { lines, used };
  }

  private renderSpeech(s: CanvasRenderingContext2D, z: number, ox: number, oy: number) {
    const talking = this.employees.filter((e) => e.sayT > 0);
    if (!talking.length) return;

    const fs = clamp(Math.round(3.9 * z), 11, 26);
    const pad = Math.round(fs * 0.55);
    const lh = Math.round(fs * 1.42);
    const maxW = clamp(z * 105, 190, 460);
    const maxLines = 3;

    s.font = `500 ${fs}px "Segoe UI","Noto Sans Thai",sans-serif`;
    s.textAlign = 'left';
    s.textBaseline = 'top';

    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // คนที่อยู่ล่างของจอวาดทีหลัง จะได้ทับคนที่อยู่ไกลกว่า
    talking.sort((a, b) => a.py - b.py);

    for (const e of talking) {
      // คนพูดอยู่นอกจอ (เช่นกล้องซูมอยู่ในห้องประชุม แต่คนที่โต๊ะพูด)
      // ถ้าวาดฟองไว้ริมจอจะดูเหมือนฟองไปโผล่ผิดตัว - ข้ามไปเลย
      const sx = e.px * z + ox;
      const sy = e.py * z + oy;
      if (sx < -20 || sx > this.canvas.width + 20 || sy < -20 || sy > this.canvas.height + 40) {
        // นอกจอ - ไม่วาด แต่ต้องมี pageLen ไม่งั้น update() จะรอค่าที่ไม่มีวันมา
        if (!this.pageLen.has(e.id)) this.pageLen.set(e.id, e.sayFull.length - e.sayPage);
        continue;
      }

      // หน้าปัจจุบันจุได้กี่ตัวอักษร - คำนวณจากข้อความทั้งหน้า (ไม่ใช่แค่ที่พิมพ์แล้ว)
      // จะได้ไม่มีตัวอักษรกระโดดบรรทัดตอนกำลังพิมพ์ แล้วส่งให้ update ใช้ตัดสินว่าจบหน้าหรือยัง
      const rest = e.sayFull.slice(e.sayPage);
      // ทั้งหน้า: เปลี่ยนเฉพาะตอนพลิกหน้า/ซูม/ข้อความใหม่ - cache ไว้ ไม่งั้น measureText นับร้อยครั้งทุกเฟรม
      const fullKey = `${e.sayPage}|${fs}|${maxW}|${e.sayFull.length}`;
      let full = this.pageCache.get(e.id);
      if (!full || full.key !== fullKey) {
        const pg = this.paginate(s, rest, maxW - pad * 2, maxLines);
        full = { key: fullKey, lines: pg.lines, used: pg.used, wTxt: Math.max(0, ...pg.lines.map((l) => s.measureText(l).width)) };
        this.pageCache.set(e.id, full);
      }
      this.pageLen.set(e.id, full.used);
      const morePages = e.sayPage + full.used < e.sayFull.length;
      const pageDone = e.sayChars >= full.used;

      const nChars = Math.floor(e.sayChars);
      const shown = rest.slice(0, nChars);
      if (!shown) continue;
      // ส่วนที่พิมพ์แล้ว: เปลี่ยน ~42 ครั้ง/วิ (ตามความเร็วพิมพ์) ไม่ใช่ทุกเฟรม
      const shownKey = `${fullKey}|${nChars}`;
      let sh = this.shownCache.get(e.id);
      if (!sh || sh.key !== shownKey) {
        sh = { key: shownKey, lines: this.paginate(s, shown, maxW - pad * 2, maxLines).lines };
        this.shownCache.set(e.id, sh);
      }
      const { lines } = sh;
      if (!lines.length) continue;

      // แถบชื่อในฟอง - ตอนซ้อนกันหลายฟองจะได้รู้ว่าใครพูด
      const nameFs = Math.max(9, Math.round(fs * 0.82));
      const nameH = Math.round(nameFs * 1.35);
      const label = `${dispName(e)} / ${t(e.title.replace(/^\S+\s/, ''))}`;
      s.font = `700 ${nameFs}px "Segoe UI","Noto Sans Thai",sans-serif`;
      const wName = s.measureText(label).width;
      s.font = `500 ${fs}px "Segoe UI","Noto Sans Thai",sans-serif`;

      // ขนาดฟองคิดจากข้อความทั้งหน้า ไม่ใช่แค่ที่พิมพ์แล้ว - ฟองจะได้ไม่ค่อย ๆ บวมตอนพิมพ์
      // เผื่อที่ให้ลูกศรพลิกหน้าที่มุมขวาล่างด้วย
      const wTxt = Math.max(wName, full.wTxt);
      const w = Math.ceil(wTxt + pad * 2 + (morePages ? fs * 0.9 : 0));
      const h = nameH + Math.max(1, full.lines.length) * lh + pad * 2;
      const H = this.canvas.height;
      const cx = e.px * z + ox;
      const headY = (e.py - 27) * z + oy; // เหนือหัวเล็กน้อย
      const footY = e.py * z + oy;
      const x0 = clamp(Math.round(cx - w / 2), 4, Math.max(4, this.canvas.width - w - 4));

      // วางเหนือหัวเป็นหลัก - ฟองอยู่ใกล้หน้าคนพูดที่สุด อ่านออกทันทีว่าใครพูด
      // วางใต้ตัวเฉพาะเมื่อเหนือหัวไม่มีที่จริง ๆ (ชนขอบบนจอ) ไม่ใช่ตัดสินจากตำแหน่งครึ่งจอ
      const below = headY - Math.round(fs * 0.7) - h < 4;
      const gap = 6;
      const overlaps = (a: number, b: number) =>
        placed.some((p) => x0 < p.x1 + 4 && x0 + w > p.x0 - 4 && a < p.y1 + 4 && b > p.y0 - 4);

      let y0: number;
      let y1: number;
      if (below) {
        y0 = footY + Math.round(fs * 0.5);
        for (let guard = 0; guard < 8 && overlaps(y0, y0 + h); guard++) {
          const hit = placed.find((p) => x0 < p.x1 + 4 && x0 + w > p.x0 - 4 && y0 < p.y1 + 4 && y0 + h > p.y0 - 4)!;
          y0 = hit.y1 + gap;
        }
        y0 = clamp(y0, 4, Math.max(4, H - h - 4));
        y1 = y0 + h;
      } else {
        y1 = headY - Math.round(fs * 0.7);
        for (let guard = 0; guard < 8 && overlaps(y1 - h, y1); guard++) {
          const hit = placed.find((p) => x0 < p.x1 + 4 && x0 + w > p.x0 - 4 && y1 - h < p.y1 + 4 && y1 > p.y0 - 4)!;
          y1 = hit.y0 - gap;
        }
        y1 = clamp(y1, h + 4, Math.max(h + 4, H - 4));
        y0 = y1 - h;
      }

      const r = Math.min(8, fs * 0.5);
      s.beginPath();
      s.moveTo(x0 + r, y0);
      s.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
      s.arcTo(x0 + w, y1, x0, y1, r);
      s.arcTo(x0, y1, x0, y0, r);
      s.arcTo(x0, y0, x0 + w, y0, r);
      s.closePath();
      s.fillStyle = 'rgba(250,251,253,.97)';
      s.fill();
      s.strokeStyle = e.pal.shirt;
      s.lineWidth = Math.max(2, fs / 7);
      s.stroke();

      // หางฟองชี้ไปหาคนพูด (ชี้ขึ้นถ้าฟองอยู่ใต้ตัว)
      const tailX = clamp(cx, x0 + r + 6, x0 + w - r - 6);
      const tailW = Math.max(5, fs * 0.4);
      const baseY = below ? y0 + 1 : y1 - 1;
      const tipY = below ? y0 - tailW * 1.5 : y1 + tailW * 1.5;
      s.beginPath();
      s.moveTo(tailX - tailW, baseY);
      s.lineTo(tailX, tipY);
      s.lineTo(tailX + tailW, baseY);
      s.closePath();
      s.fillStyle = 'rgba(250,251,253,.97)';
      s.fill();

      s.font = `700 ${nameFs}px "Segoe UI","Noto Sans Thai",sans-serif`;
      s.fillStyle = shade(e.pal.shirt, 0.72);
      s.fillText(label, x0 + pad, y0 + pad);

      s.font = `500 ${fs}px "Segoe UI","Noto Sans Thai",sans-serif`;
      s.fillStyle = '#1b2331';
      lines.forEach((l, i) => s.fillText(l, x0 + pad, y0 + pad + nameH + i * lh));

      // ลูกศรพลิกหน้าแบบเกม Pokémon - กะพริบที่มุมขวาล่างเมื่อพิมพ์ครบหน้าและยังมีหน้าต่อ
      if (morePages && pageDone && Math.floor(this.blinkT * 2.5) % 2 === 0) {
        const aw = Math.max(4, fs * 0.32);
        const ax = x0 + w - pad - aw;
        const ay = y1 - pad - aw * 0.4;
        s.beginPath();
        s.moveTo(ax - aw, ay - aw);
        s.lineTo(ax + aw, ay - aw);
        s.lineTo(ax, ay + aw * 0.4);
        s.closePath();
        s.fillStyle = shade(e.pal.shirt, 0.72);
        s.fill();
      }
      // หน้าอื่น ๆ ก่อนหน้า - จุดเล็กบอกว่าอ่านถึงไหนแล้ว (หน้า 2/3 เป็นต้น)
      if (e.sayPage > 0 || morePages) {
        const total = this.countPages(s, e.sayFull, maxW - pad * 2, maxLines);
        const cur = this.countPages(s, e.sayFull.slice(0, e.sayPage), maxW - pad * 2, maxLines) + 1;
        s.font = `600 ${Math.max(8, Math.round(fs * 0.62))}px "Segoe UI","Noto Sans Thai",sans-serif`;
        s.fillStyle = 'rgba(27,35,49,.45)';
        s.textAlign = 'right';
        s.fillText(`${Math.min(cur, total)}/${total}`, x0 + w - pad, y0 + pad * 0.6);
        s.textAlign = 'left';
      }

      placed.push({ x0, y0, x1: x0 + w, y1 });
    }
    s.textBaseline = 'alphabetic';
  }

  /** นับว่าข้อความนี้ต้องใช้กี่หน้าที่ความกว้าง/จำนวนบรรทัดนี้ */
  private countPages(s: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): number {
    if (!text) return 0;
    let n = 0;
    let at = 0;
    while (at < text.length && n < 50) {
      const { used } = this.paginate(s, text.slice(at), maxW, maxLines);
      if (used <= 0) break;
      at += used;
      n++;
    }
    return n;
  }

  /** มีอะไรขยับให้ต้องวาดเต็มสปีดไหม - ไม่มี = ออฟฟิศนิ่ง วาด 30 fps พอ (จอ 144Hz ไม่ต้องวาด 144 ครั้ง/วิ ให้คนนั่งพิมพ์งาน) */
  private isActive(): boolean {
    if (this.camTarget || this.follow) return true;
    for (const e of this.employees) {
      if (e.path?.length || e.sayT > 0 || e.owner === 'remote') return true;
    }
    return false;
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    if (document.hidden) return; // visibilitychange จะปลุกให้เอง
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.blinkT += dt; // ลูกศรพลิกหน้ากะพริบแม้ตอนหยุดเกม
    if (this.running) this.update(dt);
    if (!this.isActive() && now - this.lastRender < 33) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.lastRender = now;

    if (this.camTarget) {
      const k = Math.min(1, dt * 3.2);
      this.cam.z += (this.camTarget.z - this.cam.z) * k;
      this.cam.x += (this.camTarget.x - this.cam.x) * k;
      this.cam.y += (this.camTarget.y - this.cam.y) * k;
      const near =
        Math.abs(this.camTarget.z - this.cam.z) < 0.02 &&
        Math.hypot(this.camTarget.x - this.cam.x, this.camTarget.y - this.cam.y) < 0.6;
      if (near) { this.cam = { ...this.camTarget }; this.camTarget = null; }
      this.clampCam();
    } else if (this.follow) {
      const e = this.employees.find((x) => x.id === this.follow) ?? this.bikes.get(this.follow);
      if (e) {
        const tx = e.px - this.canvas.width / this.cam.z / 2;
        const ty = e.py - this.canvas.height / this.cam.z / 2;
        const k = Math.min(1, dt * 6);
        this.cam.x += (tx - this.cam.x) * k;
        this.cam.y += (ty - this.cam.y) * k;
        this.clampCam();
      }
    }
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };


  /* ============================================================
     ผังเฟอร์นิเจอร์ - API ให้หน้าเว็บ + สิ่งที่พฤติกรรมพนักงานต้องถาม
     ============================================================ */

  /** จุดในรายการที่ (1) ว่าง (2) ไม่มีคนอื่นยืน/นั่ง (3) เดินไปถึงได้ - สุ่มมาหนึ่งจุด, null ถ้าไม่มี */
  private pickSpot<T extends Tile>(e: Employee, spots: T[]): T | null {
    const ok = spots.filter((t) =>
      tileFree(t.x, t.y)
      && !this.spotTaken(t.x, t.y, e)
      && findPath(e.tx, e.ty, t.x, t.y) !== null);
    return ok.length ? rnd(ok) : null;
  }

  /**
   * ช่องนี้ "ถูกจอง" ไหม - มีคนยืน/นั่งอยู่ หรือมีคนกำลังเดินไปจะหยุดตรงนั้น (ไม่นับตัวเอง)
   * เดินผ่านกันได้ (pathfinding ไม่สนคน) แต่ห้ามหยุดซ้อนกัน - คนที่กำลังเดินจึงนับที่ปลายทาง ไม่ใช่ที่เท้าอยู่ตอนนี้
   */
  private spotTaken(x: number, y: number, except?: Employee): boolean {
    return this.employees.some((o) => {
      if (o === except) return false;
      const t: Tile = o.path?.length ? o.path[o.path.length - 1] : { x: o.tx, y: o.ty };
      return t.x === x && t.y === y;
    });
  }

  /** ช่องว่างข้าง ๆ ที่ยังไม่มีใครจอง - ไว้ขยับหลบตอนเดินไปถึงแล้วเจอคนยืนอยู่ก่อน */
  private freeNeighbor(e: Employee): Tile | null {
    const cand: Tile[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const x = e.tx + dx, y = e.ty + dy;
      if (!tileFree(x, y) || this.lay.at(x, y) || this.spotTaken(x, y, e)) continue;
      if (isIndoor(x, y) !== isIndoor(e.tx, e.ty)) continue; // ไม่หลบทะลุออกนอก/เข้าในตึก
      if (findPath(e.tx, e.ty, x, y) === null) continue;
      cand.push({ x, y });
    }
    return cand.length ? rnd(cand) : null;
  }

  private refreshLayoutIndex() {
    this.lay.index();
    this.objs = [...this.lay.objs];
    this.roomLeftCache = null;
    this.floorLayer = [null, null, null, null]; // พื้น/พรม/ของบนผนัง อยู่ในชั้นพื้นที่ cache ไว้
    this.syncLogo();
    this.repathWalkers();
  }

  /** วาดโลโก้ให้พอดีกรอบ (contain, กึ่งกลาง) - ไม่มีรูปก็ไม่วาด */
  private drawLogoInto(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number) {
    const img = this.logoImg;
    if (!img || !img.complete || img.naturalWidth <= 0 || W <= 0 || H <= 0) return;
    const fit = this.lay.layout.logoFit ?? 'contain';
    ctx.imageSmoothingEnabled = true;
    if (fit === 'stretch') {
      ctx.drawImage(img, x, y, W, H);
    } else if (fit === 'cover') {
      // เต็มกรอบ ตัดส่วนเกินตรงกลาง
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const sw = W / k, sh = H / k;
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, W, H);
    } else {
      const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      ctx.drawImage(img, x + Math.round((W - w) / 2), y + Math.round((H - h) / 2), w, h);
    }
    ctx.imageSmoothingEnabled = false;
  }
  /** วิธีใส่โลโก้ในกรอบ (ทุกป้าย) */
  setLogoFit(fit: 'contain' | 'cover' | 'stretch') {
    if ((this.lay.layout.logoFit ?? 'contain') === fit) return;
    this.lay.layout.logoFit = fit;
    this.commitLayout('user');
  }
  getLogoFit(): 'contain' | 'cover' | 'stretch' { return this.lay.layout.logoFit ?? 'contain'; }

  /** โหลดรูปโลโก้จากผัง (ครั้งเดียวต่อค่า) - โหลดเสร็จค่อยวาดชั้นพื้นใหม่ */
  private syncLogo() {
    const src = this.lay.layout.logo ?? null;
    if (src === this.logoSrc) return;
    this.logoSrc = src;
    if (!src) { this.logoImg = null; return; }
    const img = new Image();
    img.onload = () => { if (this.logoSrc === src) this.floorLayer = [null, null, null, null]; };
    img.src = src;
    this.logoImg = img;
  }

  /** ผังเปลี่ยนโดยเครื่องนี้ - ออก rev ใหม่ สร้างดัชนี แล้วบอกหน้าเว็บให้บันทึก */
  private commitLayout(cause: LayoutCause) {
    this.lay.layout.rev = newItemId();
    this.refreshLayoutIndex();
    const snap = cloneLayout(this.lay.layout);
    this.layoutListeners.forEach((f) => f(snap, cause));
    this.emitEdit();
  }

  /** ของเพิ่งถูกวาง/ย้าย - คนที่กำลังเดินให้คิดเส้นทางใหม่ (ทางเก่าอาจถูกขวาง) */
  private repathWalkers() {
    for (const e of this.employees) {
      if (!e.path?.length) continue;
      const goal = e.path[e.path.length - 1];
      const np = findPath(e.tx, e.ty, goal.x, goal.y);
      if (np && np.length) e.path = np;
      // หาทางไม่เจอ = ปล่อยเดินทางเดิม (กฎวางกันไม่ให้จุดสำคัญถูกตัดขาดอยู่แล้ว - เกิดได้เฉพาะจุดสุ่ม)
    }
  }

  /** ผังปัจจุบัน (สำเนา) */
  getLayout(): OfficeLayout { return cloneLayout(this.lay.layout); }
  /** ตรวจผังปัจจุบันตามกฎทั้งหมด (ใช้ในเทสต์/ดีบัก) */
  validateLayout(): Verdict { return this.lay.validate(this.lay.items, new Set(), null); }

  /**
   * ใช้ผังชุดใหม่ (โหลดจาก DB / realtime จากเครื่องอื่น / รีเซ็ต) แล้วจัดคนให้ตรงกับผัง
   * เจ้าของโต๊ะเปลี่ยนที่ -> ย้ายที่นั่ง, พนักงานที่ไม่มีโต๊ะในผังนี้ -> หาโต๊ะให้ (แก้ผังต่อ = commit ออกไปให้บันทึก)
   */
  setLayout(next: OfficeLayout, cause: LayoutCause = 'sync') {
    this.lay.set(cloneLayout(next));
    this.editSel = this.lay.item(this.editSel ?? '') ? this.editSel : null;
    this.editDrag = null; this.ghost = null;
    let changed = false;
    const ids = new Set(this.staff.map((e) => e.id));
    for (const it of this.lay.items) {
      if ((it.kind === 'desk' || it.kind === 'chair') && it.owner && it.owner !== 'boss' && it.owner !== 'secretary' && !ids.has(it.owner)) { it.owner = null; changed = true; }
    }
    // บอส/เลขาฯ: ผังนี้ไม่มีที่นั่งให้ (ผังเก่า/พัง) - ตั้งเก้าอี้ให้ที่ตำแหน่งที่จำไว้ หรือวางเก้าอี้ใหม่
    for (const who of ['boss', 'secretary'] as const) {
      const e = this.employees.find((x) => x.id === who);
      if (!e || this.lay.seatItemOf(who)) continue;
      const at = this.lay.items.find((i) => i.kind === 'chair' && !i.owner && !this.lay.isRoleChair(i) && i.x === e.seat.x && i.y === e.seat.y);
      if (at) { at.owner = who; changed = true; continue; }
      const it: LayoutItem = { id: newItemId(), kind: 'chair', x: e.seat.x, y: e.seat.y, dir: e.dir, v: who === 'boss' ? 1 : 2, owner: who };
      this.lay.layout.items.push(it); changed = true;
    }
    for (const e of this.employees) {
      if (e.isVisitor) continue;
      let it = this.lay.seatItemOf(e.id);
      if (!it) {
        const c = this.claimSeat(e.deptId, e.id, e.seat);
        if (c) { changed = changed || c.changed; it = this.lay.seatItemOf(e.id); if (!it) { this.moveSeat(e, c.seat); continue; } }
      }
      if (it) { const st = seatOf(it)!; this.moveSeat(e, { x: st.x, y: st.y }); }
    }
    if (changed) this.commitLayout(cause === 'sync' ? 'user' : cause);
    else { this.refreshLayoutIndex(); if (cause !== 'sync') { const snap = cloneLayout(this.lay.layout); this.layoutListeners.forEach((f) => f(snap, cause)); } }
    this.emitEdit();
  }

  /** ย้ายที่นั่งประจำของคน - นั่งอยู่ที่เดิมก็เดินไปที่ใหม่, ติดงานอยู่ก็แค่จำไว้ (กลับมาแล้วไปเอง) */
  private moveSeat(e: Employee, seat: Tile) {
    const same = e.seat.x === seat.x && e.seat.y === seat.y;
    e.seat = { ...seat };
    const dir = this.seatDirOf(e);
    if (same) {
      // แค่หมุน - หันตามโต๊ะถ้านั่งอยู่
      if (e.pose === 'sit' && e.tx === seat.x && e.ty === seat.y) e.dir = dir;
      return;
    }
    if (!e.isBoss && !e.isSecretary) this.seatListeners.forEach((f) => f(e.id, { ...seat }));
    // บอส busy ตลอด (ไม่ใช่ AI สุ่ม) - ย้ายบ้านตอนไม่ได้ประชุมให้เดินไปนั่งที่ใหม่
    if (e.isBoss) {
      if (e.state === 'work') { e.path = null; e.after = null; this.goTo(e, seat.x, seat.y, () => this.sitAt(e, seat.x, seat.y, this.seatDirOf(e), 'work', Number.POSITIVE_INFINITY)); }
      return;
    }
    if (e.busy) return;
    if (e.state === 'work' || e.state === 'walk' || e.isSecretary) {
      e.path = null; e.after = null;
      this.goTo(e, seat.x, seat.y, () => this.sitAt(e, seat.x, seat.y, this.seatDirOf(e), 'work', 8 + Math.random() * 8));
    }
  }

  onLayoutChange(f: (l: OfficeLayout, cause: LayoutCause) => void): () => void {
    this.layoutListeners.add(f);
    return () => { this.layoutListeners.delete(f); };
  }
  onSeatChange(f: (id: string, seat: Tile) => void): () => void {
    this.seatListeners.add(f);
    return () => { this.seatListeners.delete(f); };
  }
  onEditChange(f: (s: EditSnapshot) => void): () => void {
    this.editListeners.add(f);
    f(this.editSnapshot());
    return () => { this.editListeners.delete(f); };
  }

  /* ---------- โหมดจัดออฟฟิศ ---------- */

  editSnapshot(): EditSnapshot {
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    const spec = it ? FURN[it.kind] : null;
    return {
      on: this.editOn,
      selected: it && spec ? {
        id: it.id, kind: it.kind, label: t(spec.label) + (it.kind === 'deptsign' && it.dept ? ` · ${t(DEPT_BY_ID.get(it.dept)?.shortTh ?? it.dept)}` : ''),
        dir: it.dir ?? null, owner: it.owner ?? null, dept: it.dept ?? null,
        signText: it.kind === 'deptsign' ? { value: it.text ?? null, fallback: (it.dept && t(DEPT_BY_ID.get(it.dept)?.shortTh ?? '')) || '' } : null,
        rotates: !!spec.rotates,
        // ที่นั่งประจำตั้งได้กับโต๊ะทำงาน และเก้าอี้ที่ไม่ใช่เก้าอี้ประชุม/หัวโต๊ะ (เก้าอี้ PR ตั้งได้ - คนนั่งเคาน์เตอร์)
        canOwn: it.kind === 'desk' || (it.kind === 'chair' && it.tag !== 'meethead' && !this.lay.meetSeats().some((m) => m.item.id === it.id)),
        canDelete: !spec.unique && !it.owner,
        size: spec.resizable ? { w: it.w ?? spec.resizable.defW, h: it.h ?? spec.resizable.defH, minW: spec.resizable.minW, maxW: spec.resizable.maxW, minH: spec.resizable.minH, maxH: spec.resizable.maxH } : null,
        zOrder: spec.decal ? (() => { const all = this.lay.decalItems(); return { index: all.findIndex((d) => d.id === it.id), total: all.length }; })() : null,
        depth: !spec.decal && !spec.ghost && !spec.wallOnly ? (it.z ?? 0) : null,
      } : null,
      placing: this.editPlacing?.kind ?? null,
      painting: this.editPaint,
      tool: this.editPlacing ? 'place' : this.editPaint ? 'paint' : 'select',
      logo: this.lay.layout.logo ?? null,
      logoFit: this.lay.layout.logoFit ?? 'contain',
      message: this.editMsg,
      itemCount: this.lay.items.length,
    };
  }
  private emitEdit() { const snap = this.editSnapshot(); this.editListeners.forEach((f) => f(snap)); }
  private say_(msg: string | null) { this.editMsg = msg; this.emitEdit(); }

  isEditMode() { return this.editOn; }
  setEditMode(on: boolean) {
    if (this.editOn === on) return;
    this.editOn = on;
    this.editSel = null; this.editPlacing = null; this.editPaint = null; this.paintDown = false; this.editDrag = null; this.ghost = null; this.hover = null; this.editMsg = null;
    this.canvas.classList.toggle('editing', on);
    this.canvas.classList.remove('painting');
    this.canvas.style.cursor = '';
    this.emitEdit();
  }
  editSelect(id: string | null) {
    this.editSel = id && this.lay.item(id) ? id : null;
    this.editPlacing = null; this.editPaint = null; this.ghost = null;
    this.say_(null);
  }
  /** เริ่มถือของใหม่ - คลิกบนแผนที่เพื่อวาง (Esc ยกเลิก) - ป้ายแผนกต้องระบุ dept */
  editStartPlace(kind: FurnKind, extra: { dept?: string } = {}) {
    if (!this.editOn) return;
    const spec = FURN[kind];
    if (this.lay.items.length >= 400) { this.say_(t('ของเยอะเกินไปแล้ว (400 ชิ้น) - ลบบางชิ้นก่อน')); return; }
    if ((spec.unique || spec.single) && this.lay.items.some((i) => i.kind === kind)) {
      const ex = this.lay.items.find((i) => i.kind === kind)!;
      this.editSel = ex.id; this.editPlacing = null; this.editPaint = null;
      this.say_(t('{label} มีได้ชิ้นเดียว - เลือกชิ้นเดิมให้แล้ว ลากไปที่ใหม่ได้เลย', { label: t(spec.label) }));
      return;
    }
    this.editSel = null; this.editPaint = null;
    this.editPlacing = { kind, dir: kind === 'chair' ? 'down' : 'up', v: spec.variants ? Math.floor(Math.random() * spec.variants) : 0, ...(extra.dept ? { dept: extra.dept } : {}) };
    this.ghost = null;
    this.say_(t('คลิกบนแผนที่เพื่อวาง{label}{rotate}{wall} - Esc ยกเลิก', { label: t(spec.label), rotate: spec.rotates ? t(' (R หมุน)') : '', wall: spec.wallOnly ? t(' - วางบนช่องผนัง') : '' }));
  }
  /** เริ่มทาสีพื้น/ผนัง - ลากบนแผนที่ (Esc เลิก) */
  editStartPaint(code: string) {
    if (!this.editOn || !tileSpec(code)) return;
    this.editSel = null; this.editPlacing = null; this.ghost = null;
    this.editPaint = code;
    this.canvas.classList.add('painting');
    this.say_(t('ลากบนแผนที่เพื่อระบาย "{label}" - Esc/คลิกขวา กลับโหมดเลือก', { label: t(tileSpec(code)!.label) }));
  }
  /** กลับโหมด "เลือก/ย้าย" - วางของ/ระบายอยู่ก็เลิก (คงชิ้นที่เลือกไว้) */
  editSelectTool() {
    this.editPlacing = null; this.editPaint = null; this.paintDown = false; this.ghost = null;
    this.canvas.classList.remove('painting');
    this.say_(null);
  }
  editCancel() {
    if (this.editPlacing) { this.editPlacing = null; this.ghost = null; this.say_(null); return; }
    if (this.editPaint) { this.editPaint = null; this.paintDown = false; this.canvas.classList.remove('painting'); this.say_(null); return; }
    if (this.editSel) { this.editSel = null; this.say_(null); }
  }
  /** ระบายช่องเดียว - ผ่านกฎค่อยลง (ของบนช่องต้องยังถูกชนิด ทุกอย่างยังเดินถึง) */
  private paintAt(x: number, y: number) {
    const code = this.editPaint;
    if (!code || x < 0 || y < 0 || x >= MW || y >= MH) return;
    if (this.lay.ground[y][x] === code) return;
    const v = this.lay.validatePaint(x, y, code, this.occupiedTiles());
    if (!v.ok) { this.editMsg = t('ระบายไม่ได้: {reason}', { reason: t(v.reason ?? '') }); this.emitEdit(); return; }
    this.lay.layout.ground = this.lay.withPaint(x, y, code);
    this.editMsg = null;
    this.commitLayout('user');
  }
  /** ตั้ง/ลบโลโก้บริษัท (data URL) */
  setLogo(dataUrl: string | null) {
    if (dataUrl && (!dataUrl.startsWith('data:image/') || dataUrl.length > MAX_LOGO_CHARS)) { this.say_(t('โลโก้ใหญ่เกินไป - ย่อรูปแล้วลองใหม่')); return; }
    this.lay.layout.logo = dataUrl;
    // ยังไม่มีชิ้น "โลโก้" บนพื้น - วางให้ทับตรา (หรือกลางล็อบบี้) แล้วเลือกไว้ให้ลาก/ย่อขยายต่อ
    if (dataUrl && !this.lay.items.some((i) => i.kind === 'logo')) {
      const rs = FURN.logo.resizable!;
      const emblem = this.lay.items.find((i) => i.kind === 'emblem');
      const cands: Tile[] = [emblem ? { x: emblem.x, y: emblem.y } : { x: 9, y: 9 }, { x: 9, y: 9 }, { x: 14, y: 9 }, { x: 4, y: 12 }];
      for (const c of cands) {
        const it: LayoutItem = { id: newItemId(), kind: 'logo', x: c.x, y: c.y, w: rs.defW, h: rs.defH };
        if (this.lay.validate(this.lay.withAdded(it), new Set(), it.id).ok) { this.lay.layout.items.push(it); if (this.editOn) this.editSel = it.id; break; }
      }
    }
    this.commitLayout('user');
  }
  /**
   * เลื่อนลำดับซ้อนของชิ้นชั้นพื้นที่เลือก (พรม/ตรา/โลโก้): +1 ขึ้นหน้า, -1 ลงหลัง, 'top'/'bottom' สุดขั้ว
   * ทำโดยตั้ง z ใหม่ให้ทุกชิ้นชั้นพื้นตามลำดับปัจจุบันแล้วสลับ - เข้าใจง่าย บันทึกได้
   */
  editZ(dir: 1 | -1 | 'top' | 'bottom') {
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    if (!it) return;
    const spec = FURN[it.kind];
    if (!spec.decal) {
      // ของทั่วไป: ระดับซ้อนเป็นตัวเลื่อนความลึก -3..3 (ไม่ต้องเรียงกับชิ้นอื่น)
      if (spec.ghost || spec.wallOnly) return;
      const cur = it.z ?? 0;
      const next = dir === 'top' ? 3 : dir === 'bottom' ? -3 : Math.max(-3, Math.min(3, cur + dir));
      if (next === cur) return;
      it.z = next === 0 ? undefined : next;
      this.say_(null);
      this.commitLayout('user');
      return;
    }
    const all = this.lay.decalItems();
    const i = all.findIndex((d) => d.id === it.id);
    if (i < 0) return;
    const j = dir === 'top' ? all.length - 1 : dir === 'bottom' ? 0 : Math.max(0, Math.min(all.length - 1, i + dir));
    if (j === i) return;
    all.splice(i, 1); all.splice(j, 0, it);
    all.forEach((d, n) => { d.z = n; });
    this.say_(null);
    this.commitLayout('user');
  }
  /** ระดับซ้อนของของทั่วไปกลับเป็นอัตโนมัติ */
  editZReset() {
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    if (!it || FURN[it.kind].decal || it.z === undefined) return;
    it.z = undefined;
    this.commitLayout('user');
  }
  /** ตั้งข้อความบนป้ายแผนกที่เลือก - ว่าง = กลับไปใช้ชื่อย่อแผนก */
  editSetSignText(text: string) {
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    if (!it || it.kind !== 'deptsign') return;
    const t = text.trim().slice(0, MAX_SIGN_TEXT);
    if ((it.text ?? '') === t) return;
    if (t) it.text = t; else delete it.text;
    this.commitLayout('user');
  }
  /** ย่อ/ขยายชิ้นที่เลือก (โลโก้) ทีละช่อง - ผ่านกฎค่อยลง */
  editResize(dw: number, dh: number) {
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    const rs = it ? FURN[it.kind].resizable : null;
    if (!it || !rs) return;
    const w = Math.min(rs.maxW, Math.max(rs.minW, (it.w ?? rs.defW) + dw));
    const h = Math.min(rs.maxH, Math.max(rs.minH, (it.h ?? rs.defH) + dh));
    if (w === (it.w ?? rs.defW) && h === (it.h ?? rs.defH)) return;
    const trial = this.lay.items.map((i) => (i.id === it.id ? { ...i, w, h } : i));
    const v = this.lay.validate(trial, this.occupiedTiles(), it.id);
    if (!v.ok) { this.say_(t('ขยายไม่ได้: {reason}', { reason: t(v.reason ?? '') })); return; }
    it.w = w; it.h = h;
    this.say_(null);
    this.commitLayout('user');
  }
  getLogo(): string | null { return this.lay.layout.logo ?? null; }
  /** กรอบห้องประชุม/โต๊ะบอส (px) - กล้องอัตโนมัติใช้ */
  meetingRect(): Rect { return this.lay.meetRect() ?? { x: 9 * TS, y: 0, w: 17 * TS, h: 8 * TS }; }
  bossRect(): Rect { return this.lay.bossRect() ?? { x: 0, y: 0, w: 10 * TS, h: 7 * TS }; }
  editRotate() {
    if (this.editPlacing) {
      if (FURN[this.editPlacing.kind].rotates) { this.editPlacing.dir = nextDir(this.editPlacing.dir); this.updateGhost(); }
      return;
    }
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    if (!it || !FURN[it.kind].rotates) return;
    const dir = nextDir(it.dir ?? 'up');
    const v = this.lay.validate(this.lay.withMoved(it.id, it.x, it.y, dir), this.occupiedTiles(), it.id, it.owner ? this.tileOf(it.owner) : null);
    if (!v.ok) { this.say_(t('หมุนไม่ได้: {reason}', { reason: t(v.reason ?? '') })); return; }
    it.dir = dir;
    this.afterItemChanged(it);
    this.commitLayout('user');
  }
  editDelete() {
    const it = this.editSel ? this.lay.item(this.editSel) : null;
    if (!it) return;
    if (it.owner) {
      const who = this.employees.find((e) => e.id === it.owner);
      this.say_(t('ที่นั่งนี้เป็นของ{name} - เปลี่ยน "คนนั่ง" เป็นว่าง (ย้ายเขาไปที่อื่นก่อน) แล้วค่อยลบ', { name: who ? dispName(who) : t('คน') }));
      return;
    }
    if (FURN[it.kind].unique) { this.say_(t('{label} ลบไม่ได้ - ลากไปที่ใหม่แทน', { label: t(FURN[it.kind].label) })); return; }
    // ลบแล้วผังต้องยังผ่านกฎ (เช่นเก้าอี้ประชุมต้องเหลือ ≥ 2, โต๊ะประชุมต้องมี)
    const v = this.lay.validate(this.lay.withRemoved(it.id), new Set(), null);
    if (!v.ok) { this.say_(t('ลบไม่ได้: {reason}', { reason: t(v.reason ?? '') })); return; }
    this.lay.layout.items = this.lay.layout.items.filter((i) => i.id !== it.id);
    this.editSel = null;
    this.say_(null);
    this.commitLayout('user');
  }
  /** ให้คนนี้นั่งที่นั่งนี้ประจำ (สลับกับคนเดิมถ้ามี) - null = ปล่อยว่าง (ต้องไม่ทำให้ใครไร้ที่นั่ง) */
  editAssignSeat(itemId: string, employeeId: string | null): boolean {
    const it = this.lay.item(itemId);
    if (!it || (it.kind !== 'desk' && it.kind !== 'chair')) return false;
    if (it.kind === 'chair' && (it.tag === 'meethead' || this.lay.meetSeats().some((m) => m.item.id === it.id))) {
      this.say_(t('เก้าอี้ประชุม/หัวโต๊ะใช้เป็นที่นั่งประจำไม่ได้ - ย้ายออกจากโต๊ะประชุมก่อน')); return false;
    }
    const prevOwner = it.owner ? this.employees.find((e) => e.id === it.owner) ?? null : null;
    if (!employeeId) {
      if (prevOwner) { this.say_(t('{name} ต้องมีที่นั่ง - เลือกคนอื่นมานั่งแทน หรือย้ายเขาไปที่ว่างก่อน', { name: dispName(prevOwner) })); return false; }
      return true;
    }
    const e = this.employees.find((x) => x.id === employeeId && !x.isVisitor);
    if (!e) return false;
    if (it.owner === e.id) return true;
    const mine = this.lay.seatItemOf(e.id);
    // สลับ: คนเดิมของที่นั่งนี้ไปนั่งที่เก่าของเรา (ถ้ามี) - ห้ามมีใครไร้ที่นั่ง
    if (prevOwner && !mine) { this.say_(t('{name} จะไม่มีที่นั่ง - ย้าย{name}ไปที่ว่างก่อน', { name: dispName(prevOwner) })); return false; }
    if (mine) mine.owner = prevOwner ? prevOwner.id : null;
    it.owner = e.id;
    if (prevOwner && mine) { const st = seatOf(mine)!; this.moveSeat(prevOwner, { x: st.x, y: st.y }); }
    const st = seatOf(it)!;
    this.moveSeat(e, { x: st.x, y: st.y });
    this.say_(null);
    this.commitLayout('user');
    return true;
  }
  /** คืนผังเริ่มต้น - พนักงานที่มีจะถูกจัดที่นั่งใหม่ในห้องแผนกตัวเอง */
  editReset() {
    const fresh = defaultLayout();
    fresh.logo = this.lay.layout.logo ?? null; // โลโก้ไม่ใช่ "ผัง" - คงไว้
    this.editSel = null; this.editPlacing = null; this.ghost = null;
    this.setLayout(fresh, 'user');
    this.say_(t('คืนผังเริ่มต้นแล้ว'));
  }
  /** ชิ้นที่พนักงานคนนี้ยืน/นั่งอยู่ - ใช้ยกเว้นตอนตรวจ "ทับคน" ให้เจ้าของโต๊ะที่กำลังย้าย */
  private tileOf(empId: string): string | null {
    const e = this.employees.find((x) => x.id === empId);
    return e ? key(e.tx, e.ty) : null;
  }
  /** ที่นั่งย้าย/หมุนแล้ว - เจ้าของตามไป */
  private afterItemChanged(it: LayoutItem) {
    if (!it.owner) return;
    const st = seatOf(it);
    const e = this.employees.find((x) => x.id === it.owner);
    if (e && st) this.moveSeat(e, { x: st.x, y: st.y });
  }

  private tileAtClient(clientX: number, clientY: number): Tile {
    const d = this.toDev(clientX, clientY);
    const wx = this.cam.x + d.x / this.cam.z;
    const wy = this.cam.y + d.y / this.cam.z;
    return { x: Math.floor(wx / TS), y: Math.floor(wy / TS) };
  }

  /** คำนวณ ghost ใหม่จาก hover ปัจจุบัน (ตอนลาก/ถือของ) */
  private updateGhost() {
    const h = this.hover;
    if (!h) { this.ghost = null; return; }
    if (this.editPlacing) {
      const it: LayoutItem = { id: '__ghost__', kind: this.editPlacing.kind, x: h.x, y: h.y, dir: this.editPlacing.dir, v: this.editPlacing.v, ...(this.editPlacing.dept ? { dept: this.editPlacing.dept } : {}) };
      const verdict = this.lay.validate(this.lay.withAdded(it), this.occupiedTiles(), it.id);
      this.ghost = { x: h.x, y: h.y, dir: it.dir!, kind: it.kind, v: it.v ?? 0, verdict };
      return;
    }
    if (this.editDrag) {
      const it = this.lay.item(this.editDrag.id);
      if (!it) { this.ghost = null; return; }
      const x = h.x - this.editDrag.ox, y = h.y - this.editDrag.oy;
      if (x !== it.x || y !== it.y) this.editDrag.moved = true;
      const verdict = this.lay.validate(this.lay.withMoved(it.id, x, y), this.occupiedTiles(), it.id, it.owner ? this.tileOf(it.owner) : null);
      this.ghost = { x, y, dir: it.dir ?? 'up', kind: it.kind, v: it.v ?? 0, verdict };
    }
  }

  /** ปล่อยเมาส์ตอนลาก/วาง - ลงมือจริงถ้าผ่านกฎ */
  private editDrop() {
    const g = this.ghost;
    if (this.editPlacing) {
      if (!g) return;
      if (!g.verdict.ok) { this.say_(t('วางไม่ได้: {reason}', { reason: t(g.verdict.reason ?? '') })); return; }
      const rs = FURN[g.kind].resizable;
      const it: LayoutItem = { id: newItemId(), kind: g.kind, x: g.x, y: g.y, ...(FURN[g.kind].rotates ? { dir: g.dir } : {}), v: g.v, ...(this.editPlacing.dept ? { dept: this.editPlacing.dept } : {}), ...(rs ? { w: rs.defW, h: rs.defH } : {}) };
      this.lay.layout.items.push(it);
      this.editPlacing = null; this.ghost = null;
      this.editSel = it.id;
      this.say_(null);
      this.commitLayout('user');
      return;
    }
    if (this.editDrag) {
      const it = this.lay.item(this.editDrag.id);
      const moved = this.editDrag.moved;
      this.editDrag = null;
      if (!it) { this.ghost = null; return; }
      if (moved && g) {
        if (!g.verdict.ok) { this.ghost = null; this.say_(t('วางไม่ได้: {reason}', { reason: t(g.verdict.reason ?? '') })); return; }
        it.x = g.x; it.y = g.y;
        this.afterItemChanged(it);
        this.ghost = null;
        this.say_(null);
        this.commitLayout('user');
      } else {
        this.ghost = null;
        this.emitEdit();
      }
    }
  }

  /** วาดชั้นจัดออฟฟิศ: ตาราง, กรอบชิ้นที่เลือก, ghost เขียว/แดง, ช่องที่มีปัญหา */
  private renderEdit(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // ตารางบาง ๆ บนพื้นเท่านั้น
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const c = GROUND[y][x];
      if (c === '#' || c === 'G' || c === '~') continue;
      ctx.fillRect(x * TS, y * TS, TS, 1); ctx.fillRect(x * TS, y * TS, 1, TS);
    }
    const outline = (tiles: Tile[], color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      for (const t of tiles) ctx.strokeRect(t.x * TS + 0.5, t.y * TS + 0.5, TS - 1, TS - 1);
    };
    const sel = this.editSel ? this.lay.item(this.editSel) : null;
    if (sel && !this.editDrag) outline(footprint(sel).map((f) => ({ x: f.x, y: f.y })), '#ffd166');
    if (this.hover && !this.ghost) {
      if (this.editPaint) {
        // ตัวอย่างสีที่กำลังจะระบาย
        ctx.globalAlpha = 0.8;
        ctx.drawImage(tileSprite(this.editPaint, this.hover.x, this.hover.y, 0), this.hover.x * TS, this.hover.y * TS);
        ctx.globalAlpha = 1;
        outline([this.hover], '#8fe0a0');
      } else outline([this.hover], 'rgba(255,255,255,0.45)');
    }
    const g = this.ghost;
    if (g) {
      const it: LayoutItem = { id: '__ghost__', kind: g.kind, x: g.x, y: g.y, dir: g.dir, v: g.v };
      const fp = footprint(it);
      ctx.fillStyle = g.verdict.ok ? 'rgba(80,220,120,0.35)' : 'rgba(230,70,70,0.40)';
      for (const f of fp) ctx.fillRect(f.x * TS, f.y * TS, TS, TS);
      ctx.globalAlpha = 0.75;
      for (const f of fp) {
        if (f.layer === 'obj' && f.obj) { const s = objSprite(f.obj); ctx.drawImage(s.c, f.x * TS - (s.ox ?? 0), f.y * TS - s.oy); }
        else if (f.layer === 'decal' && f.decal) ctx.drawImage(decalSprite(f.decal), f.x * TS, f.y * TS);
        else if (f.layer === 'wall' && f.wall) ctx.drawImage(decorSprite(f.wall), f.x * TS, f.y * TS);
      }
      ctx.globalAlpha = 1;
      if (!g.verdict.ok && g.verdict.bad.size) {
        ctx.fillStyle = 'rgba(230,70,70,0.45)';
        for (const k of g.verdict.bad) { const [x, y] = k.split(',').map(Number); ctx.fillRect(x * TS, y * TS, TS, TS); }
      }
      outline(fp.map((f) => ({ x: f.x, y: f.y })), g.verdict.ok ? '#8fe0a0' : '#ff7a7a');
    }
    ctx.restore();
  }

  /* ============================================================
     กล้อง / อินพุต
     ============================================================ */
  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    // กินพื้นที่ของกรอบให้เต็มทั้งกว้างและสูง
    // เดิมคิดความสูงจากอัตราส่วนของแผนที่ (w * BH/BW) จอกว้าง ๆ จึงเหลือที่ว่างข้างล่างเป็นแถบ
    const w = Math.max(280, Math.floor(parent.clientWidth));
    const h = Math.max(200, Math.floor(parent.clientHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.sctx.imageSmoothingEnabled = false;
    // "พอดีจอ" ต้องเห็นแผนที่ทั้งผืน จึงต้องเอาด้านที่คับกว่าเป็นตัวกำหนด
    // (ขอบดำที่เหลือคืออัตราส่วนแมพกับจอไม่เท่ากัน - ผู้ใช้ซูมเข้าเองได้)
    this.fitZ = Math.min(this.canvas.width / BW, this.canvas.height / BH);
    this.minZ = this.fitZ * 0.6;
    this.maxZ = this.fitZ * 12;
    if (!this.camReady) { this.resetView(); this.camReady = true; }
    else { this.cam.z = clamp(this.cam.z, this.minZ, this.maxZ); this.clampCam(); }
  }

  resetView() {
    this.follow = null;
    this.camTarget = null;
    this.savedCam = null;
    this.cam.z = this.fitZ;
    // จัดกลางทั้งสองแกน เพราะตอนนี้กรอบอาจกว้างหรือสูงเกินแผนที่ก็ได้
    this.cam.x = (BW - this.canvas.width / this.cam.z) / 2;
    this.cam.y = (BH - this.canvas.height / this.cam.z) / 2;
    this.clampCam();
  }

  zoomPercent() { return Math.round((this.cam.z / this.fitZ) * 100); }

  private clampInto(c: { x: number; y: number; z: number }) {
    const vw = this.canvas.width / c.z;
    const vh = this.canvas.height / c.z;
    const m = 20;
    c.x = vw >= BW + m * 2 ? (BW - vw) / 2 : clamp(c.x, -m, BW + m - vw);
    c.y = vh >= BH + m * 2 ? (BH - vh) / 2 : clamp(c.y, -m, BH + m - vh);
  }
  private clampCam() { this.clampInto(this.cam); }

  /** เลื่อนกล้องแบบนุ่ม ๆ ไปครอบกรอบที่ระบุ (หน่วย base px) */
  focusRect(rect: { x: number; y: number; w: number; h: number }, pad = 26) {
    if (!this.autoCam) return;
    const cw = this.canvas.width, ch = this.canvas.height;
    const z = clamp(
      Math.min(cw / (rect.w + pad * 2), ch / (rect.h + pad * 2)),
      this.minZ, this.maxZ,
    );
    const t = {
      z,
      x: rect.x + rect.w / 2 - cw / z / 2,
      y: rect.y + rect.h / 2 - ch / z / 2,
    };
    this.clampInto(t);
    this.camTarget = t;
    this.follow = null;
  }

  /** จำมุมกล้องปัจจุบันไว้ แล้วค่อยคืนหลังจบงาน */
  saveView() { if (this.autoCam && !this.savedCam) this.savedCam = { ...this.cam }; }
  restoreView() {
    if (!this.savedCam) return;
    const t = { ...this.savedCam };
    this.savedCam = null;
    if (!this.autoCam) return;
    this.clampInto(t);
    this.camTarget = t;
    this.follow = null;
  }

  setAutoCam(v: boolean) {
    this.autoCam = v;
    if (!v) { this.camTarget = null; this.savedCam = null; }
  }

  private toDev(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (this.canvas.width / r.width),
      y: (clientY - r.top) * (this.canvas.height / r.height),
    };
  }

  zoomAt(clientX: number, clientY: number, factor: number) {
    const d = this.toDev(clientX, clientY);
    const wx = this.cam.x + d.x / this.cam.z;
    const wy = this.cam.y + d.y / this.cam.z;
    this.cam.z = clamp(this.cam.z * factor, this.minZ, this.maxZ);
    this.cam.x = wx - d.x / this.cam.z;
    this.cam.y = wy - d.y / this.cam.z;
    this.clampCam();
  }

  zoomCenter(factor: number) {
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  focus(id: string | null) {
    this.camTarget = null;
    this.follow = id;
    if (id && this.cam.z < this.fitZ * 2) this.cam.z = this.fitZ * 2.5;
  }

  setPaused(p: boolean) { this.running = !p; }
  isPaused() { return !this.running; }

  /**
   * เดินเวลาจำลองไปข้างหน้าทันทีโดยไม่ต้องรอ requestAnimationFrame
   * ใช้ตอนดีบัก/เทสต์ (เช่นในเบราว์เซอร์ที่ throttle rAF) - ไม่ได้ถูกเรียกจาก UI
   */
  debugStep(seconds: number) {
    let left = seconds;
    while (left > 0) {
      const d = Math.min(0.05, left);
      this.update(d);
      left -= d;
    }
  }

  private bindInput() {
    const cv = this.canvas;
    const ptrs = new Map<number, { x: number; y: number }>();
    let drag: { sx: number; sy: number; cx: number; cy: number } | null = null;
    let pinch: { d: number; z: number } | null = null;
    let moved = 0;

    // ผู้ใช้แตะกล้องเมื่อไหร่ กล้องอัตโนมัติหยุดทันที ไม่แย่งกัน
    const takeOver = () => { this.camTarget = null; this.savedCam = null; this.follow = null; };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      takeOver();
      const f = Math.pow(1.0016, -ev.deltaY * (ev.deltaMode === 1 ? 16 : 1));
      this.zoomAt(ev.clientX, ev.clientY, clamp(f, 0.2, 5));
    };
    const onDown = (ev: PointerEvent) => {
      cv.setPointerCapture(ev.pointerId);
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      // โหมดจัดออฟฟิศ: กดบนของ = เริ่มลากชิ้นนั้น (ไม่เลื่อนกล้อง) / ถือของอยู่ = รอปล่อยเพื่อวาง
      if (this.editOn && ev.button === 2) return; // คลิกขวาจัดการที่ contextmenu
      if (this.editOn && ptrs.size === 1 && ev.button === 0) {
        const t = this.tileAtClient(ev.clientX, ev.clientY);
        this.hover = t;
        if (this.editPaint) { this.paintDown = true; this.paintAt(t.x, t.y); moved = 0; drag = null; return; }
        if (this.editPlacing) { this.updateGhost(); moved = 0; drag = null; return; }
        // ของซ้อนกัน (เช่นโต๊ะบนพรม): คลิกครั้งแรกได้ชิ้นบน คลิกซ้ำที่เดิมวนไปชิ้นถัดไปข้างล่าง
        const stack = this.lay.allAt(t.x, t.y);
        const curIdx = this.editSel ? stack.findIndex((i) => i.id === this.editSel) : -1;
        const hit = stack.length ? stack[curIdx >= 0 ? (curIdx + 1) % stack.length : 0] : null;
        if (hit) {
          this.editSel = hit.id;
          this.editDrag = { id: hit.id, ox: t.x - hit.x, oy: t.y - hit.y, moved: false };
          this.ghost = null;
          this.say_(null);
          moved = 0; drag = null;
          cv.classList.add('grabbing');
          return;
        }
      }
      if (ptrs.size === 1) { moved = 0; drag = { sx: ev.clientX, sy: ev.clientY, cx: this.cam.x, cy: this.cam.y }; }
      else if (ptrs.size === 2) {
        drag = null;
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
      }
      cv.classList.add('grabbing');
    };
    const onMove = (ev: PointerEvent) => {
      if (this.editOn) {
        const t = this.tileAtClient(ev.clientX, ev.clientY);
        if (!this.hover || this.hover.x !== t.x || this.hover.y !== t.y) {
          const prev = this.hover;
          this.hover = t;
          // โหมดเลือก: ชี้โดนของ = มือจับ (บอกว่าลาก/คลิกได้)
          if (!this.editPlacing && !this.editPaint && !this.editDrag) cv.style.cursor = this.lay.at(t.x, t.y) ? 'grab' : '';
          if (this.editPlacing || this.editDrag) this.updateGhost();
          // ลากเร็ว pointer กระโดดข้ามช่อง - ระบายทุกช่องบนเส้นระหว่างจุดก่อนกับจุดนี้ (เส้นผนังจะได้ไม่มีรู)
          if (this.editPaint && this.paintDown) {
            if (prev) for (const q of lineTiles(prev, t)) this.paintAt(q.x, q.y);
            else this.paintAt(t.x, t.y);
          }
        }
        if (this.editDrag || (this.editPaint && this.paintDown)) return; // ลากของ/ระบายอยู่ ไม่เลื่อนกล้อง
      }
      if (!ptrs.has(ev.pointerId)) return;
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && ptrs.size >= 2) {
        takeOver();
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 4) {
          const target = clamp(pinch.z * (d / pinch.d), this.minZ, this.maxZ);
          this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / this.cam.z);
        }
        return;
      }
      if (drag) {
        const r = cv.getBoundingClientRect();
        const k = cv.width / r.width;
        moved = Math.max(moved, Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy));
        if (moved > 3) takeOver();
        this.cam.x = drag.cx - (ev.clientX - drag.sx) * k / this.cam.z;
        this.cam.y = drag.cy - (ev.clientY - drag.sy) * k / this.cam.z;
        this.clampCam();
      }
    };
    const onUp = (ev: PointerEvent) => {
      ptrs.delete(ev.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (this.editOn && ptrs.size === 0 && this.editPaint) { this.paintDown = false; drag = null; cv.classList.remove('grabbing'); return; }
      if (this.editOn && ptrs.size === 0 && (this.editDrag || this.editPlacing)) {
        this.hover = this.tileAtClient(ev.clientX, ev.clientY);
        this.updateGhost();
        this.editDrop();
        drag = null;
        cv.classList.remove('grabbing');
        return;
      }
      if (ptrs.size === 0) {
        if (this.editOn && drag && moved <= 3) {
          // คลิกที่ว่างในโหมดจัด = ยกเลิกการเลือก
          this.editSel = null; this.say_(null);
        } else if (drag && moved <= 3) {
          const d = this.toDev(ev.clientX, ev.clientY);
          const wx = this.cam.x + d.x / this.cam.z;
          const wy = this.cam.y + d.y / this.cam.z;
          const hit = this.employees.find(
            (e) => Math.abs(e.px - wx) < 8 && wy > e.py - 24 && wy < e.py,
          );
          this.selected = hit ?? null;
        }
        drag = null;
        cv.classList.remove('grabbing');
      }
    };
    const onResize = () => this.resize();
    const onLeave = () => { if (this.editOn && !this.editDrag && !this.editPlacing) this.hover = null; };
    // คลิกขวา = กลับโหมดเลือก (เลิกถือของ/ระบาย) ไม่เปิดเมนูเบราว์เซอร์
    const onContext = (ev: MouseEvent) => { if (!this.editOn) return; ev.preventDefault(); this.editSelectTool(); };
    // ดับเบิลคลิกของที่หมุนได้ = หมุน (ไม่ต้องหาปุ่ม R)
    const onDbl = (ev: MouseEvent) => {
      if (!this.editOn || this.editPlacing || this.editPaint) return;
      const t = this.tileAtClient(ev.clientX, ev.clientY);
      const hit = this.lay.at(t.x, t.y);
      if (hit && FURN[hit.kind].rotates) { this.editSel = hit.id; this.editRotate(); }
    };
    // คีย์ลัดโหมดจัด: R หมุน, Delete ลบ, Esc ยกเลิก - ไม่ทำงานตอนพิมพ์ในช่องข้อความ
    const onKey = (ev: KeyboardEvent) => {
      if (!this.editOn) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
      if (ev.key === 'r' || ev.key === 'R') { this.editRotate(); ev.preventDefault(); }
      else if (ev.key === ']') { this.editResize(1, 0); ev.preventDefault(); }
      else if (ev.key === '[') { this.editResize(-1, 0); ev.preventDefault(); }
      else if (ev.key === '=' || ev.key === '+') { this.editResize(0, 1); ev.preventDefault(); }
      else if (ev.key === '-' || ev.key === '_') { this.editResize(0, -1); ev.preventDefault(); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { this.editDelete(); ev.preventDefault(); }
      else if (ev.key === 'Escape') { this.editCancel(); ev.preventDefault(); }
    };

    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('contextmenu', onContext);
    cv.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);

    this.cleanups.push(() => {
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('contextmenu', onContext);
      cv.removeEventListener('dblclick', onDbl);
      window.removeEventListener('keydown', onKey);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    });
  }
}


