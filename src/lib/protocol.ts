/** สัญญาระหว่าง /api/agenda, /api/ask (SSE) กับหน้าเว็บ */

import type { AgentRole } from './departments';
import type { CompanyContext } from './company';

/**
 * รูปแบบการประชุม
 * - roundtable: ทุกแผนกนั่งโต๊ะเดียวกัน รอบ 1 ต่างคนต่างเสนอ รอบ 2 ค้านข้ามแผนก แล้วประธานสรุป
 * - relay: แผนกเจ้าของเรื่องถือคำถามไว้ เดินไปถามทีละแผนก เอาคำตอบมาต่อยอด แล้วสรุปเอง
 */
export type MeetingMode = 'roundtable' | 'relay' | 'direct';

export const MEETING_MODES: { id: MeetingMode; th: string; hint: string }[] = [
  {
    id: 'roundtable',
    th: 'โต๊ะกลม',
    hint: 'ทุกแผนกถกพร้อมกัน ค้านข้ามแผนกได้ เร็วกว่าเพราะยิงพร้อมกัน',
  },
  {
    id: 'relay',
    th: 'สายพาน',
    hint: 'เจ้าของเรื่องเดินไปถามทีละแผนก เอาคำตอบไปต่อยอด ช้ากว่าแต่เห็นที่มาชัด',
  },
  {
    id: 'direct',
    th: 'ตอบตรง',
    hint: 'คำถามข้อเท็จจริงเรื่องบริษัท - คนเดียวตอบจากข้อมูลบริษัทเลย ไม่ต้องประชุม เร็วที่สุด',
  },
];

/** เพดานที่นั่งในห้องประชุม - ผูกกับ MEET_SEATS ใน game/map.ts (โต๊ะยาว 12 ที่) */
export const MAX_ATTENDEES = 12;

export interface AskAgent {
  id: string;
  name: string;
  role: AgentRole;
  deptId: string;
  deptName: string;
  /** มุมมองเฉพาะแผนกที่ผูกกับบทบาทนี้ */
  lens: string;
}

/* ---------- ระเบียบวาระ: ใครควรเข้าประชุม ---------- */

export interface AgendaItem {
  deptId: string;
  /** เลขาฯ บอกว่าทำไมเรื่องนี้ต้องมีแผนกนี้ - ผู้ใช้เอาไว้ตัดสินว่าจะตัดออกไหม */
  reason: string;
}

export interface Agenda {
  mode: MeetingMode;
  /** แผนกเจ้าของเรื่อง - relay ใช้เป็นคนถือคำถาม roundtable ใช้เป็นประธาน */
  ownerDeptId: string;
  items: AgendaItem[];
  /** เลขาฯ สรุปว่าอ่านคำถามแล้วเข้าใจว่าเรื่องนี้คือเรื่องอะไร */
  note: string;
  /** true = ไม่มีคีย์ LLM เลยใช้การนับคำแทน ความแม่นต่ำกว่ามาก */
  fallback: boolean;
}

export interface AgendaRequest {
  question: string;
  /** แผนกที่จ้างคนไว้แล้วเท่านั้น - เสนอแผนกที่ไม่มีพนักงานไปก็เข้าประชุมไม่ได้ */
  hiredDeptIds: string[];
  /** โปรไฟล์บริษัท - เลขาฯ จะเลือกแผนกได้แม่นขึ้นเมื่อรู้ว่าเราเป็นบริษัทแบบไหน */
  profile?: Record<string, string>;
}

/* ---------- หลักฐานว่า skill ถูกส่งไปจริง ---------- */

export interface SkillFile {
  deptId: string;
  deptName: string;
  file: string;
  bytes: number;
  missing: boolean;
}

export interface SkillProof {
  /** ประชุมข้ามแผนก = อ่านหลายไฟล์ ต้องโชว์ให้ครบว่าอ่านอะไรไปบ้าง */
  files: SkillFile[];
  /** system prompt ที่ประกอบเสร็จแล้วของ agent ตัวแรก (ของจริงที่ส่งไป API) */
  systemPrompt: string;
  agentName: string;
  model: string;
  provider: string;
  /** agent ตัวแรกได้ข้อมูลบริษัทไปเท่าไร - พิสูจน์ได้ว่าอ่านโปรไฟล์/โน้ต/เอกสารจริง */
  company?: { profileChars: number; noteChars: number; chunkCount: number };
}

/* ---------- การประชุม ---------- */

export interface AskRequest {
  question: string;
  mode: MeetingMode;
  ownerDeptId: string;
  agents: AskAgent[];
  /** ข้อมูลบริษัท - client โหลดจาก Supabase (RLS) แล้วส่งมา เซิร์ฟเวอร์ไม่มี Supabase creds */
  company?: CompanyContext;
}

export type AskEvent =
  | { type: 'skill'; proof: SkillProof }
  | { type: 'phase'; phase: 'round1' | 'round2' | 'consult' | 'synthesis' | 'direct'; label: string }
  | {
      type: 'opinion';
      agentId: string;
      agentName: string;
      agentRole: string;
      deptId: string;
      round: 1 | 2;
      /** relay: ลำดับที่ถูกถาม (1 = แผนกแรกที่เจ้าของเรื่องไปหา) */
      step?: number;
      /** relay: ชื่อคนที่เดินมาถาม */
      askedBy?: string;
      text: string;
    }
  /** relay: คำถามที่เจ้าของเรื่องส่งต่อให้อีกแผนก - แยก event เพราะเกมต้องเล่นท่าเดินไปถาม */
  | {
      type: 'consult';
      step: number;
      fromAgentId: string;
      fromName: string;
      toAgentId: string;
      toName: string;
      toDeptId: string;
      text: string;
    }
  | { type: 'final'; text: string; leadAgentId: string; leadAgentName: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface Opinion {
  agentId: string;
  agentName: string;
  agentRole: string;
  deptId?: string;
  round: 1 | 2;
  step?: number;
  askedBy?: string;
  text: string;
}

/** คำถามที่ถูกส่งต่อในโหมดสายพาน - เก็บไว้แสดงคู่กับคำตอบในบันทึกการประชุม */
export interface Consult {
  step: number;
  fromName: string;
  toName: string;
  toDeptId: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  departmentId?: string;
  authorName?: string;
  mode?: MeetingMode;
  /** แผนกที่เข้าประชุมจริงในคำถามนี้ */
  deptIds?: string[];
  /** บันทึกการถกกันก่อนสรุป - กางดูได้ในหน้าแชท */
  transcript?: Opinion[];
  /** สายพาน: คำถามที่ถูกส่งต่อระหว่างแผนก */
  consults?: Consult[];
  /** หลักฐานว่า skill ถูกส่งไปจริง - กางดูได้ในหน้าแชท */
  proof?: SkillProof;
  pending?: boolean;
}
