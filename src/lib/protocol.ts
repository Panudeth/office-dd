/** สัญญาระหว่าง /api/agenda, /api/ask (SSE) กับหน้าเว็บ */

import type { AgentRole } from './departments';
import type { CompanyContext } from './company';
import type { Palette } from '@/game/types';

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
  /** หัวหน้าแผนก (คนแรกที่จ้าง) - ใช้โมเดล "หัวหน้าแผนก" และเป็นประธานได้ */
  isHead?: boolean;
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
  company?: { profileChars: number; productCount?: number; noteChars: number; chunkCount: number };
  /** ประชุมนี้ใช้กี่โมเดล ใครใช้อะไร - โชว์ให้เห็นว่า mixed-model ทำงานจริง */
  agentModels?: { agentId: string; agentName: string; model: string; provider: string }[];
}

/* ---------- คีย์ LLM ต่อคน/ต่อบทบาท ---------- */

/** การเชื่อมต่อหนึ่งชุดในรูปที่เซิร์ฟเวอร์เข้าใจ - คีย์ถูกใช้เฉพาะคำขอนี้ ไม่เก็บ */
export interface LlmCredsWire {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * ใครใช้โมเดลไหนในการประชุมนี้ - อ้างด้วย id ของชุดคีย์ ตัวคีย์จริงอยู่ใน conns ครั้งเดียว
 * ลำดับที่เซิร์ฟเวอร์ใช้:
 *   หัวหน้าแผนก (isHead) = byAgent -> chair -> member -> ค่าเริ่มต้น (header)   [ทุกรอบ ไม่ใช่แค่ตอนสรุป]
 *   ลูกทีม               = byAgent -> member -> ค่าเริ่มต้น (header)
 * รายคนชนะเสมอเพราะเป็นการเลือกที่เจาะจงที่สุด chair คือค่าเริ่มต้นของหัวหน้าทุกคน
 */
export interface LlmAssignment {
  conns: Record<string, LlmCredsWire>;
  chair?: string;
  member?: string;
  /** เลขาฯ ที่จดรายงานการประชุมหลังจบ - ไม่ตั้งใช้ค่าลูกทีม, 'off' = ไม่จด */
  secretary?: string | 'off';
  byAgent?: Record<string, string>;
}

/* ---------- การประชุม ---------- */

export interface AskRequest {
  question: string;
  mode: MeetingMode;
  ownerDeptId: string;
  agents: AskAgent[];
  /** ข้อมูลบริษัท - client โหลดจาก Supabase (RLS) แล้วส่งมา เซิร์ฟเวอร์ไม่มี Supabase creds */
  company?: CompanyContext;
  /** โมเดลต่อคน/ต่อบทบาท - ไม่ส่งมาก็ใช้ชุดเดียวจาก header เหมือนเดิม */
  llm?: LlmAssignment;
  /** ประธานที่ประชุม/คนสรุป - ผู้ใช้เลือกจากหัวหน้าแผนกในหน้าวาระ ไม่ส่งมาใช้หัวหน้าของแผนกเจ้าของเรื่อง */
  chairId?: string;
  /** ออฟฟิศที่ประชุมนี้สังกัด - มีแล้วเซิร์ฟเวอร์จะบันทึก event ลง DB ให้ (ต้องส่ง x-sb-token มาด้วย) */
  officeId?: string;
  /** สำเนาผู้เข้าประชุมสำหรับบันทึก - คนอาจถูกเลิกจ้างไปแล้วแต่บันทึกต้องอ่านออก */
  attendees?: MeetingAttendeeLite[];
}

export interface MeetingAttendeeLite {
  id: string;
  name: string;
  title: string;
  deptId: string;
  palette: Palette;
}

/** แหล่งที่เรียกประชุม - โชว์ในสมุดว่าใครสั่ง */
export type MeetingSource = 'web' | 'api' | 'mcp' | 'line';
/** ใครถาม - internal เห็นทุกอย่าง, customer ได้เฉพาะคำตอบที่ PR กรองแล้ว */
export type MeetingAudience = 'internal' | 'customer';

export type WorkTask = 'round1' | 'round2' | 'ask' | 'answer' | 'synthesis' | 'direct' | 'minutes';

export type AskEvent =
  /**
   * แถวแรกเมื่อเซิร์ฟเวอร์บันทึกการประชุมลง DB - บอก id และบริบทพอที่จออื่นจะเล่น animation ตามได้
   * เบราว์เซอร์ที่ได้ event นี้ทาง SSE รู้ว่าไม่ต้องบันทึกซ้ำ
   */
  | {
      type: 'meeting';
      id: string;
      source: MeetingSource;
      question: string;
      mode: MeetingMode;
      ownerDeptId: string;
      chairId?: string;
      agents: AskAgent[];
      attendees: MeetingAttendeeLite[];
      audience?: MeetingAudience;
      /** ป้ายชื่อผู้ถามจากช่องทางภายนอก เช่น "สมชาย (LINE)" - จอใช้ตั้งชื่อตัวละครแขก */
      askedBy?: string;
    }
  /**
   * PR ตอบลูกค้าเองไม่ได้ ต้องปรึกษาทีมภายใน - บอกลูกค้าให้รอ แล้วเปิดประชุม (agents/chair คือทีมที่จะเข้าห้อง)
   * จอ: PR พูด text ให้ลูกค้าฟัง ลูกค้าไปนั่งรอ ทีมเดินเข้าห้องประชุม
   */
  | {
      type: 'escalate'; agentId: string; agentName: string; text: string; internalQuestion: string;
      agents: AskAgent[]; attendees: MeetingAttendeeLite[]; chairId: string;
    }
  /** คำตอบที่ PR กรองแล้วสำหรับลูกค้า - มาหลัง final (สรุปภายใน) จอ: PR เดินกลับมาบอกลูกค้า */
  | { type: 'customer_reply'; agentId: string; agentName: string; text: string; model?: string }
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
      /** โมเดลที่คนนี้ใช้ตอบจริง */
      model?: string;
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
  | { type: 'final'; text: string; leadAgentId: string; leadAgentName: string; model?: string }
  /** รายงานการประชุมของเลขาฯ - มาหลัง final เสมอ เขียนโดยคนละคน/คนละโมเดลกับประธาน */
  | { type: 'minutes'; text: string; model?: string; error?: string }
  /**
   * ใครเริ่มคิดอะไร - ยิงก่อนเรียก LLM ทุกครั้ง หน้าเว็บเอาไปโชว์ว่าใครยังคิดอยู่นานแค่ไหน
   * จบเมื่อมี opinion/consult/final/minutes ของคนนั้นตามมา
   */
  | { type: 'working'; agentId: string; agentName: string; task: WorkTask; label: string; model?: string }
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
  /** โมเดลที่ใช้ตอบ - เก็บลงบันทึกด้วย จะได้เทียบย้อนหลังได้ว่าตัวไหนคุ้ม */
  model?: string;
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
  /** โมเดลของคนที่สรุปคำตอบสุดท้าย */
  model?: string;
  /** รายงานการประชุมของเลขาฯ - มาทีหลังคำตอบ */
  minutes?: string;
  /** คำตอบที่ PR กรองให้ลูกค้า (คำถามจากคนนอก) - ต่างจาก text ที่เป็นสรุปภายใน */
  customerReply?: string;
  pending?: boolean;
}
