import type { AgentRole } from '@/lib/departments';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Pose = 'stand' | 'walk' | 'sit';

/** สถานะของพนักงาน (agent) - ใช้คุมทั้ง animation และ UI */
export type AgentState =
  | 'work'      // นั่งทำงานที่โต๊ะ
  | 'walk'      // กำลังเดิน
  | 'meet'      // นั่งประชุม
  | 'think'     // กำลังคิด/ถกกันในห้องประชุม (รอ LLM)
  | 'report'    // มารายงานผลที่โต๊ะผู้บริหาร
  | 'coffee'    // ชงกาแฟ/กดน้ำ
  | 'eat'       // กินข้าว
  | 'lounge'    // นั่งโซฟา
  | 'bench'     // นั่งม้านั่งในสวน
  | 'pond'      // ยืนชมบ่อน้ำ
  | 'chat'      // คุยกับเพื่อนร่วมงาน
  | 'idle';     // ยืนเล่น

export type BubbleIcon =
  | 'talk' | 'type' | 'coffee' | 'idea' | 'board' | 'music' | 'food' | 'question';

export interface Palette {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
}

export interface Tile { x: number; y: number }

export interface Employee {
  id: string;
  name: string;
  /** ชื่อบทบาทภาษาไทย เช่น "ผู้ค้าน" */
  title: string;
  deptId: string;
  role: AgentRole;
  /** มุมมองเฉพาะแผนกที่ผูกกับบทบาทนี้ */
  lens: string;
  pal: Palette;
  atlas: HTMLCanvasElement;

  seat: Tile;          // โต๊ะประจำตัว
  tx: number; ty: number;
  px: number; py: number;

  dir: Dir;
  pose: Pose;
  frame: number;
  animT: number;

  state: AgentState;
  timer: number;
  speed: number;

  path: Tile[] | null;
  after: (() => void) | null;

  bubble: BubbleIcon | null;
  bubbleT: number;

  /** ฟองคำพูดข้อความจริง - สิ่งที่ agent พูดออกมาในการประชุม */
  sayFull: string;
  /** จำนวนตัวอักษรที่โผล่แล้ว (เอฟเฟกต์พิมพ์ทีละตัว) */
  sayChars: number;
  /** เวลาที่เหลือก่อนฟองหาย (วินาที) */
  sayT: number;

  /** true = ถูกจองไว้ทำงานที่ผู้ใช้สั่ง - AI สุ่มพฤติกรรมจะไม่ยุ่ง */
  busy: boolean;
  /** ตัวผู้บริหาร (ตัวผู้ใช้) - นั่งหัวโต๊ะประชุม ไม่ใช่ agent ที่จ้างมา */
  isBoss?: boolean;

  /**
   * ใครเป็นเจ้าของการเคลื่อนที่ของตัวนี้
   *   sim    = เครื่องนี้คำนวณเอง (ค่าเริ่มต้น ทั้ง agent และบอสของเรา)
   *   remote = คนอื่นเป็นเจ้าของ เครื่องนี้แค่ interpolate เข้าหาค่าที่ได้รับ
   * เฟสนี้ยังไม่มีใครเป็น remote - วางไว้เพื่อให้เฟส sync ตำแหน่งเป็นการ "เพิ่ม" ไม่ใช่ "รื้อ"
   */
  owner: 'sim' | 'remote';
  /** เป้าหมายที่ได้รับจาก network (ใช้เฉพาะ owner === 'remote') */
  remote?: { px: number; py: number; dir: Dir; pose: Pose };
}

/** ข้อมูลพนักงานที่บันทึกลง DB แล้วเอากลับมาสร้างใหม่ได้ */
export interface PersistedEmployee {
  id: string;
  name: string;
  title: string;
  deptId: string;
  role: AgentRole;
  palette: Palette;
  seat: Tile;
}

/** สรุปสถานะพนักงานสำหรับฝั่ง React (ไม่ส่ง canvas/closure ออกไป) */
export interface EmployeeSnapshot {
  id: string;
  name: string;
  title: string;
  deptId: string;
  role: AgentRole;
  state: AgentState;
  color: string;
}
