import { DEPT_BY_ID, ROLES, ROLE_ORDER, type Department } from '@/lib/departments';
import { decorSprite, drawBubble, mk, objSprite, shade, tileSprite, type Surface } from './art';
import { DIRS, buildAtlas, makePalette } from './character';
import {
  BENCH_SEATS, BH, BOSS_DESK, BOSS_HOME, BOSS_SEAT, BW, COOLER_STAND, DESK_SEATS, GROUND, IDLE_SPOTS,
  MEET_SEATS, MH, MW, OBJECTS, PANTRY_TABLE, PODS, POND_SPOTS, REPORT_SPOTS,
  SOFA_SEATS, TS, WALL_DECOR, findPath, tileFree,
} from './map';
import type { AgentState, BubbleIcon, Dir, Employee, EmployeeSnapshot, Tile } from './types';

const NAMES = [
  'ต้น', 'แนน', 'เอิร์ธ', 'ฟ้า', 'บอส', 'มิ้น', 'กาย', 'ปอ', 'แจ็ค', 'นุ่น',
  'โอ๊ต', 'พลอย', 'เบส', 'ใบเตย', 'กิ๊ฟ', 'ตูน',
];

const STATE_TH: Record<AgentState, string> = {
  work: 'ทำงาน', walk: 'กำลังเดิน', meet: 'ประชุม', think: 'กำลังถกกัน',
  report: 'มารายงาน', coffee: 'ชงกาแฟ', eat: 'กินข้าว', lounge: 'นั่งเล่น',
  bench: 'นั่งสวน', pond: 'ชมบ่อน้ำ', chat: 'คุยกัน', idle: 'ยืนเล่น',
};
export const stateLabel = (s: AgentState) => STATE_TH[s] ?? s;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rnd = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

export class World {
  readonly canvas: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private base: Surface;
  private ctx: CanvasRenderingContext2D;

  employees: Employee[] = [];
  /** pod index -> deptId ที่จับจองไว้ */
  private podDept: (string | null)[] = PODS.map(() => null);
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
  /** คิวคำพูด — พูดทีละคน ไม่ให้แย่งกัน */
  private speechQueue: { id: string; text: string; sec: number; onStart?: () => void }[] = [];
  private speechGap = 0;

  private raf = 0;
  private last = 0;
  private running = true;
  private disposed = false;
  private cleanups: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.sctx = canvas.getContext('2d')!;
    this.sctx.imageSmoothingEnabled = false;
    this.base = mk(BW, BH);
    this.ctx = this.base.g;
    this.spawnBoss();
    this.bindInput();
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** ผู้บริหาร (ตัวผู้ใช้) — ปกตินั่งทำงานในห้องตัวเอง เดินมาห้องประชุมเมื่อมีวาระ */
  private spawnBoss() {
    const pal = { skin: '#e8b088', hair: '#403848', shirt: '#3a4256', pants: '#2a3040', shoes: '#403848' };
    this.employees.push({
      id: 'boss',
      name: 'คุณ',
      title: '👑 ผู้บริหาร',
      deptId: '__boss__',
      role: 'proposer',
      lens: '',
      pal,
      atlas: buildAtlas(pal),
      seat: { x: BOSS_HOME.x, y: BOSS_HOME.y },
      tx: BOSS_HOME.x, ty: BOSS_HOME.y,
      px: BOSS_HOME.x * TS + 8, py: BOSS_HOME.y * TS + TS,
      dir: BOSS_HOME.dir, pose: 'sit', frame: 0, animT: 0,
      state: 'work', timer: Number.POSITIVE_INFINITY,
      speed: 44,
      path: null, after: null,
      bubble: null, bubbleT: 0,
      sayFull: '', sayChars: 0, sayT: 0,
      busy: true,
      isBoss: true,
    });
  }

  get bossId() { return 'boss'; }
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
  private get staff() { return this.employees.filter((e) => !e.isBoss); }

  seatsLeft(): number {
    const taken = new Set(this.staff.map((e) => `${e.seat.x},${e.seat.y}`));
    return DESK_SEATS.filter((s) => !taken.has(`${s.x},${s.y}`)).length;
  }

  headcount(deptId: string): number {
    return this.staff.filter((e) => e.deptId === deptId).length;
  }

  private claimSeat(deptId: string): Tile | null {
    const taken = new Set(this.staff.map((e) => `${e.seat.x},${e.seat.y}`));
    const free = (t: Tile) => !taken.has(`${t.x},${t.y}`);

    // 1) pod ของแผนกนี้ที่ยังมีที่ว่าง
    for (let i = 0; i < PODS.length; i++) {
      if (this.podDept[i] !== deptId) continue;
      const s = PODS[i].find(free);
      if (s) return s;
    }
    // 2) pod ที่ยังไม่มีเจ้าของ
    for (let i = 0; i < PODS.length; i++) {
      if (this.podDept[i] !== null) continue;
      this.podDept[i] = deptId;
      const s = PODS[i].find(free);
      if (s) return s;
    }
    // 3) ที่ว่างที่ไหนก็ได้
    return DESK_SEATS.find(free) ?? null;
  }

  hire(dept: Department): Employee | null {
    const seat = this.claimSeat(dept.id);
    if (!seat) return null;

    const n = this.headcount(dept.id);
    const id = `emp_${this.nextId++}`;
    const usedNames = new Set(this.staff.map((e) => e.name));
    const name = NAMES.find((nm) => !usedNames.has(nm)) ?? `พนักงาน${this.nextId}`;
    const pal = makePalette(this.nextId * 17 + dept.id.length, dept.color);
    // คนที่ 1 = ผู้เสนอ, 2 = ผู้ค้าน, 3 = ผู้ตรวจสอบ, 4 = ผู้ดูความเป็นไปได้ แล้ววนใหม่
    const role = ROLE_ORDER[n % ROLE_ORDER.length];

    const e: Employee = {
      id, name,
      title: `${ROLES[role].icon} ${ROLES[role].th}`,
      deptId: dept.id,
      role,
      lens: dept.lenses[role],
      pal,
      atlas: buildAtlas(pal),
      seat: { ...seat },
      tx: seat.x, ty: seat.y,
      px: seat.x * TS + 8, py: seat.y * TS + TS,
      dir: 'down', pose: 'sit', frame: 0, animT: 0,
      state: 'work', timer: 3 + Math.random() * 6,
      speed: 40 + Math.random() * 12,
      path: null, after: null,
      bubble: 'idea', bubbleT: 2,
      sayFull: '', sayChars: 0, sayT: 0,
      busy: false,
    };
    this.employees.push(e);
    return e;
  }

  fire(deptId?: string): boolean {
    // ห้ามไล่ตัวผู้บริหารออก
    const idx = deptId
      ? this.employees.map((e) => (e.isBoss ? '' : e.deptId)).lastIndexOf(deptId)
      : this.employees.map((e) => !e.isBoss).lastIndexOf(true);
    if (idx < 0) return false;
    const [gone] = this.employees.splice(idx, 1);
    if (this.selected?.id === gone.id) this.selected = null;
    if (this.follow === gone.id) this.follow = null;
    // ปล่อย pod คืนถ้าไม่มีคนของแผนกนั้นเหลือแล้ว
    if (!this.employees.some((e) => e.deptId === gone.deptId)) {
      this.podDept = this.podDept.map((d) => (d === gone.deptId ? null : d));
    }
    return true;
  }

  roster(): EmployeeSnapshot[] {
    return this.staff.map((e) => ({
      id: e.id, name: e.name, title: e.title, deptId: e.deptId, role: e.role,
      state: e.state, color: e.pal.shirt,
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
   * ฟองคำพูดข้อความจริง — เข้าคิวไว้ แล้วพูดทีละคน
   * ถ้าปล่อยให้พูดพร้อมกันจะกลายเป็นแย่งกันพูด (คอล LLM 3 ตัวเสร็จไล่ ๆ กัน)
   * และฟองซ้อนกันจนดูไม่ออกว่าใครพูด
   */
  say(id: string, text: string, sec?: number, onStart?: () => void) {
    const t = text.trim();
    if (!t) return;
    // ไม่ตัดคิวทิ้งแล้ว — ทุกคนต้องได้พูด ไม่งั้นเห็นแค่คนแรกคนเดียว
    // การประชุมจะยาวเท่าที่บทสนทนายาว (page.tsx รอ waitForSpeech() ก่อนสรุป)
    this.speechQueue.push({
      id, text: t, onStart,
      sec: sec ?? clamp(2.5 + t.length * 0.055, 4.5, 9),
    });
  }

  /** พูดทันทีโดยไม่ต้องรอคิว (ใช้ตอนมารายงานที่โต๊ะ) */
  sayNow(id: string, text: string, sec?: number) {
    this.speechQueue = [];
    this.speechGap = 0;
    const e = this.employees.find((x) => x.id === id);
    const t = text.trim();
    if (!e || !t) return;
    this.employees.forEach((o) => { o.sayFull = ''; o.sayChars = 0; o.sayT = 0; });
    e.sayFull = t;
    e.sayChars = 0;
    e.sayT = sec ?? clamp(3 + t.length * 0.07, 6, 14);
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
    // คนพูดยังเดินอยู่ — รอให้นั่งลงก่อน ไม่งั้นจะกลายเป็น "เดินไปพูดไป"
    // ถือคิวไว้ทั้งแถวเพื่อรักษาลำดับการสนทนา
    if (e.path) return;

    this.speechQueue.shift();
    e.sayFull = next.text;
    e.sayChars = 0;
    e.sayT = next.sec;
    e.bubble = null; // กันฟองไอคอนซ้อนกับฟองข้อความ
    e.bubbleT = 0;
    next.onStart?.(); // เช่น หันไปหาคนที่กำลังค้าน + ให้คนนั้นมีปฏิกิริยา
  }

  /** รอจนคุยกันจบทั้งคิว — ใช้กันไม่ให้สรุปทับบทสนทนาที่ยังไม่จบ */
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

  /** เรียกทีมเข้าห้องประชุม — บอสเดินมาจากห้องตัวเองด้วย resolve เมื่อทุกคนนั่งครบ */
  async gather(ids: string[]): Promise<void> {
    const team = ids
      .map((id) => this.employees.find((e) => e.id === id))
      .filter((e): e is Employee => !!e);
    if (!team.length) return;

    const walkers = team.map((e, i) => {
      e.busy = true;
      e.path = null;
      e.after = null;
      const s = MEET_SEATS[i % MEET_SEATS.length];
      e.bubble = 'board'; e.bubbleT = 2.5;
      return this.walk(e, s.x, s.y).then(() => {
        this.sitAt(e, s.x, s.y, s.dir, 'meet', 9999);
      });
    });

    // บอสออกจากห้องตัวเองมานั่งหัวโต๊ะ
    const boss = this.boss;
    boss.path = null;
    boss.after = null;
    boss.state = 'walk';
    walkers.push(
      this.walk(boss, BOSS_SEAT.x, BOSS_SEAT.y).then(() => {
        this.sitAt(boss, BOSS_SEAT.x, BOSS_SEAT.y, BOSS_SEAT.dir, 'meet', Number.POSITIVE_INFINITY);
      }),
    );

    await Promise.all(walkers);
  }

  /** ระหว่างรอคำตอบจาก LLM — ให้คนในห้องประชุมสลับกันพูด */
  setDeliberating(ids: string[]) {
    ids.forEach((id) => {
      const e = this.employees.find((x) => x.id === id);
      if (e) { e.state = 'think'; e.timer = 9999; }
    });
  }

  /** ให้คนหนึ่งเดินมารายงานที่โต๊ะผู้บริหาร — resolve เมื่อถึงที่ */
  async report(id: string): Promise<void> {
    const e = this.employees.find((x) => x.id === id);
    if (!e) return;
    e.busy = true;
    e.path = null;
    e.after = null;
    const spot = REPORT_SPOTS.find((s) => !this.employees.some((o) => o !== e && o.tx === s.x && o.ty === s.y))
      ?? REPORT_SPOTS[0];
    await this.walk(e, spot.x, spot.y);
    e.pose = 'stand';
    e.dir = 'up';
    e.state = 'report';
    e.timer = 9999;
    e.bubble = 'talk';
    e.bubbleT = 4;
  }

  /** เลิกประชุม — ทุกคนกลับโต๊ะตัวเอง */
  disperse(ids: string[]) {
    this.clearSay(); // เลิกประชุมแล้วห้ามมีฟองค้างไปพูดตอนเดิน

    // บอสกลับไปนั่งห้องตัวเอง
    const boss = this.boss;
    boss.path = null;
    boss.after = null;
    this.goTo(boss, BOSS_HOME.x, BOSS_HOME.y, () => {
      this.sitAt(boss, BOSS_HOME.x, BOSS_HOME.y, BOSS_HOME.dir, 'work', Number.POSITIVE_INFINITY);
    });

    ids.forEach((id) => {
      const e = this.employees.find((x) => x.id === id);
      if (!e) return;
      e.path = null;
      e.after = null;
      // goTo เรียก callback เสมอ ไม่ว่าจะเดินถึงหรือหาเส้นทางไม่เจอ — busy จึงถูกปลดแน่นอน
      this.goTo(e, e.seat.x, e.seat.y, () => {
        this.sitAt(e, e.seat.x, e.seat.y, 'down', 'work', 8 + Math.random() * 10);
        e.busy = false;
      });
    });
  }

  /* ============================================================
     AI สุ่มพฤติกรรมตอนว่าง
     ============================================================ */
  private decide(e: Employee) {
    if (e.busy) { e.timer = 5; return; }
    const roll = Math.random();

    if (roll < 0.36) {
      this.goTo(e, e.seat.x, e.seat.y, () => {
        this.sitAt(e, e.seat.x, e.seat.y, 'down', 'work', 10 + Math.random() * 16);
        if (Math.random() < 0.5) { e.bubble = 'type'; e.bubbleT = 2; }
      });
    } else if (roll < 0.5) {
      this.goTo(e, COOLER_STAND.x, COOLER_STAND.y, () => {
        e.pose = 'stand'; e.dir = 'up'; e.state = 'coffee';
        e.timer = 3 + Math.random() * 4; e.bubble = 'coffee'; e.bubbleT = 3;
      });
    } else if (roll < 0.6) {
      const spot = rnd(PANTRY_TABLE);
      this.goTo(e, spot.x, spot.y, () => {
        e.pose = 'stand'; e.dir = 'up'; e.state = 'eat';
        e.timer = 5 + Math.random() * 6; e.bubble = 'food'; e.bubbleT = 4;
      });
    } else if (roll < 0.72) {
      const free = SOFA_SEATS.filter((s) => !this.employees.some((o) => o !== e && o.tx === s.x && o.ty === s.y));
      if (free.length) {
        const s = rnd(free);
        this.goTo(e, s.x, s.y, () => {
          this.sitAt(e, s.x, s.y, 'down', 'lounge', 6 + Math.random() * 8);
          e.bubble = 'music'; e.bubbleT = 3;
        });
      } else e.timer = 2;
    } else if (roll < 0.86) {
      if (Math.random() < 0.6) {
        const free = BENCH_SEATS.filter((s) => !this.employees.some((o) => o !== e && o.tx === s.x && o.ty === s.y));
        if (free.length) {
          const s = rnd(free);
          this.goTo(e, s.x, s.y, () => {
            this.sitAt(e, s.x, s.y, 'down', 'bench', 10 + Math.random() * 12);
            e.bubble = rnd<BubbleIcon>(['music', 'idea', 'coffee']); e.bubbleT = 3;
          });
          return;
        }
      }
      const s = rnd(POND_SPOTS);
      this.goTo(e, s.x, s.y, () => {
        e.pose = 'stand'; e.dir = 'right'; e.state = 'pond';
        e.timer = 6 + Math.random() * 8; e.bubble = 'idea'; e.bubbleT = 3;
      });
    } else if (roll < 0.93) {
      const s = rnd(IDLE_SPOTS);
      this.goTo(e, s.x, s.y, () => {
        e.pose = 'stand'; e.state = 'idle'; e.timer = 2 + Math.random() * 4;
      });
    } else {
      const other = this.employees.find((o) => o !== e && o.state === 'work' && !o.busy);
      if (other) {
        const spot = ([[other.tx - 1, other.ty], [other.tx + 1, other.ty], [other.tx, other.ty - 1]] as const)
          .find(([x, y]) => tileFree(x, y));
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
    for (const e of this.employees) {
      if (e.bubbleT > 0) { e.bubbleT -= dt; if (e.bubbleT <= 0) e.bubble = null; }
      if (e.sayT > 0) {
        e.sayT -= dt;
        e.sayChars = Math.min(e.sayFull.length, e.sayChars + dt * 42); // ~42 ตัวอักษร/วินาที
        if (e.sayT <= 0) {
          e.sayFull = ''; e.sayChars = 0;
          this.speechGap = 0.5; // เว้นจังหวะก่อนคนถัดไปพูด
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
        if (e.state === 'work' && Math.random() < 0.55) {
          e.timer = 6 + Math.random() * 10;
          e.bubble = rnd<BubbleIcon>(['type', 'idea', 'talk']);
          e.bubbleT = 2;
        } else this.decide(e);
      }
    }
    this.pumpSpeech(dt);
  }

  private render() {
    const ctx = this.ctx;
    const wf = Math.floor(performance.now() / 200) % 4;

    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) ctx.drawImage(tileSprite(GROUND[y][x], x, y, wf), x * TS, y * TS);
    }
    WALL_DECOR.forEach((d) => ctx.drawImage(decorSprite(d.type), d.x * TS, d.y * TS));

    ctx.fillStyle = 'rgba(20,10,0,.13)';
    for (let y = 1; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (GROUND[y][x] !== '#' && GROUND[y - 1][x] === '#') ctx.fillRect(x * TS, y * TS, TS, 3);
        if (GROUND[y][x] !== '#' && x > 0 && GROUND[y][x - 1] === '#') ctx.fillRect(x * TS, y * TS, 2, TS);
      }
    }

    type Item =
      | { sort: number; kind: 'obj'; o: (typeof OBJECTS)[number] }
      | { sort: number; kind: 'emp'; e: Employee };
    const list: Item[] = [];
    OBJECTS.forEach((o) => {
      const seat = o.type === 'chair' || o.type === 'sofa' || o.type === 'bench';
      list.push({ sort: o.y * TS + TS - (seat ? 0.5 : 0), kind: 'obj', o });
    });
    this.employees.forEach((e) => list.push({ sort: e.py, kind: 'emp', e }));
    list.sort((a, b) => a.sort - b.sort);

    for (const it of list) {
      if (it.kind === 'obj') {
        const s = objSprite(it.o);
        ctx.drawImage(s.c, it.o.x * TS - (s.ox ?? 0), it.o.y * TS - s.oy);
      } else {
        const e = it.e;
        ctx.fillStyle = 'rgba(0,0,0,.20)';
        ctx.fillRect((e.px - 4) | 0, (e.py - 2) | 0, 8, 1);
        ctx.fillRect((e.px - 3) | 0, (e.py - 3) | 0, 6, 1);
        const di = DIRS.indexOf(e.dir);
        const col = (e.pose === 'sit' ? 4 : 0) + (e.pose === 'walk' || e.pose === 'sit' ? e.frame : 1);
        ctx.drawImage(e.atlas, col * 16, di * 24, 16, 24, (e.px - 8) | 0, (e.py - 24) | 0, 16, 24);
        if (this.selected?.id === e.id) {
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 1;
          ctx.strokeRect(((e.px - 8) + 0.5) | 0, ((e.py - 25) + 0.5) | 0, 15, 25);
        }
      }
    }

    this.employees.forEach((e) => {
      if (e.bubble) drawBubble(ctx, (e.px - 2) | 0, (e.py - 38) | 0, e.bubble);
    });

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
    this.podDept.forEach((deptId, i) => {
      if (!deptId) return;
      const d = DEPT_BY_ID.get(deptId);
      if (!d) return;
      const pod = PODS[i];
      const cx = ((pod[0].x + pod[1].x) / 2 + 0.5) * TS * z + ox;
      const cy = (pod[0].y * TS - 4) * z + oy;
      const label = `${d.emoji} ${d.shortTh}`;
      const w = s.measureText(label).width + plateSize;
      s.fillStyle = 'rgba(10,14,20,.72)';
      s.fillRect(cx - w / 2, cy - plateSize, w, plateSize * 1.5);
      s.fillStyle = d.color;
      s.fillRect(cx - w / 2, cy - plateSize, w, Math.max(2, plateSize * 0.2));
      s.fillStyle = '#fff';
      s.fillText(label, cx, cy + plateSize * 0.3);
    });

    this.renderSpeech(s, z, ox, oy);

    if (this.showNames) {
      const fs = clamp(Math.round(4.4 * z), 11, 40);
      s.font = `600 ${fs}px "Segoe UI","Noto Sans Thai",sans-serif`;
      s.lineWidth = Math.max(2, fs / 5);
      s.lineJoin = 'round';
      this.employees.forEach((e) => {
        const x = e.px * z + ox;
        const y = (e.py - 27) * z + oy;
        if (x < -80 || x > this.canvas.width + 80 || y < -20 || y > this.canvas.height + 20) return;
        s.strokeStyle = 'rgba(10,14,20,.85)';
        s.strokeText(e.name, x, y);
        s.fillStyle = e.busy ? '#ffd166' : '#fff';
        s.fillText(e.name, x, y);
      });
    }
  }

  /**
   * ฟองคำพูดข้อความจริง — วาดบนเลเยอร์จอ (ไม่ใช่ base canvas)
   * เพราะข้อความไทยที่ 16px จะอ่านไม่ออก
   * ตัดบรรทัดทีละตัวอักษร เพราะภาษาไทยไม่มีช่องว่างระหว่างคำ
   */
  private renderSpeech(s: CanvasRenderingContext2D, z: number, ox: number, oy: number) {
    const talking = this.employees.filter((e) => e.sayT > 0 && e.sayChars > 0);
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
      const shown = e.sayFull.slice(0, Math.floor(e.sayChars));
      if (!shown) continue;
      // คนพูดอยู่นอกจอ (เช่นกล้องซูมอยู่ในห้องประชุม แต่คนที่โต๊ะพูด)
      // ถ้าวาดฟองไว้ริมจอจะดูเหมือนฟองไปโผล่ผิดตัว — ข้ามไปเลย
      const sx = e.px * z + ox;
      const sy = e.py * z + oy;
      if (sx < -20 || sx > this.canvas.width + 20 || sy < -20 || sy > this.canvas.height + 40) continue;

      // ตัดบรรทัดแบบทีละตัวอักษร (ไทยไม่มีช่องว่าง) แต่ยอมตัดที่ช่องว่างถ้ามี
      const lines: string[] = [];
      let cur = '';
      for (const ch of shown) {
        if (ch === '\n') { lines.push(cur); cur = ''; continue; }
        const next = cur + ch;
        if (s.measureText(next).width > maxW - pad * 2 && cur) { lines.push(cur); cur = ch; }
        else cur = next;
        if (lines.length >= maxLines) break;
      }
      if (lines.length < maxLines && cur) lines.push(cur);
      if (!lines.length) continue;
      const clipped = lines.length >= maxLines && Math.floor(e.sayChars) < e.sayFull.length;
      if (clipped) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';

      // แถบชื่อในฟอง — ตอนซ้อนกันหลายฟองจะได้รู้ว่าใครพูด
      const nameFs = Math.max(9, Math.round(fs * 0.82));
      const nameH = Math.round(nameFs * 1.35);
      const label = `${e.name} · ${e.title.replace(/^\S+\s/, '')}`;
      s.font = `700 ${nameFs}px "Segoe UI","Noto Sans Thai",sans-serif`;
      const wName = s.measureText(label).width;
      s.font = `500 ${fs}px "Segoe UI","Noto Sans Thai",sans-serif`;

      const wTxt = Math.max(wName, ...lines.map((l) => s.measureText(l).width));
      const w = Math.ceil(wTxt + pad * 2);
      const h = nameH + lines.length * lh + pad * 2;
      const H = this.canvas.height;
      const cx = e.px * z + ox;
      const headY = (e.py - 27) * z + oy; // เหนือหัวเล็กน้อย
      const footY = e.py * z + oy;
      const x0 = clamp(Math.round(cx - w / 2), 4, Math.max(4, this.canvas.width - w - 4));

      // คนที่อยู่ครึ่งบนของจอ (เช่นแถวบนของโต๊ะประชุม) วางฟองไว้ใต้ตัวแทน
      // ไม่งั้นพอซ้อนกันหลายฟองจะถูกดันหลุดขอบบนไปเลย
      const below = footY < H * 0.45;
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

      placed.push({ x0, y0, x1: x0 + w, y1 });
    }
    s.textBaseline = 'alphabetic';
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.running) this.update(dt);

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
      const e = this.employees.find((x) => x.id === this.follow);
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
     กล้อง / อินพุต
     ============================================================ */
  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(280, Math.floor(parent.clientWidth));
    const h = Math.max(200, Math.floor(w * (BH / BW)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.sctx.imageSmoothingEnabled = false;
    this.fitZ = this.canvas.width / BW;
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
    this.cam.x = 0;
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
   * ใช้ตอนดีบัก/เทสต์ (เช่นในเบราว์เซอร์ที่ throttle rAF) — ไม่ได้ถูกเรียกจาก UI
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
      if (ptrs.size === 1) { moved = 0; drag = { sx: ev.clientX, sy: ev.clientY, cx: this.cam.x, cy: this.cam.y }; }
      else if (ptrs.size === 2) {
        drag = null;
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
      }
      cv.classList.add('grabbing');
    };
    const onMove = (ev: PointerEvent) => {
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
      if (ptrs.size === 0) {
        if (drag && moved <= 3) {
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

    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);

    this.cleanups.push(() => {
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    });
  }
}

export { BOSS_DESK };
