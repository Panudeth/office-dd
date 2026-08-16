/** สัญญาระหว่าง /api/ask (SSE) กับหน้าเว็บ */

import type { AgentRole } from './departments';

export interface AskAgent {
  id: string;
  name: string;
  role: AgentRole;
  /** มุมมองเฉพาะแผนกที่ผูกกับบทบาทนี้ */
  lens: string;
}

export interface AskRequest {
  question: string;
  departmentId: string;
  agents: AskAgent[];
}

/** หลักฐานว่า agent ได้รับ skill ไปจริง - ส่งกลับมาให้ผู้ใช้ตรวจได้ */
export interface SkillProof {
  file: string;
  bytes: number;
  missing: boolean;
  /** system prompt ที่ประกอบเสร็จแล้วของ agent ตัวแรก (ของจริงที่ส่งไป API) */
  systemPrompt: string;
  agentName: string;
  model: string;
  provider: string;
}

export type AskEvent =
  | { type: 'skill'; proof: SkillProof }
  | { type: 'phase'; phase: 'round1' | 'round2' | 'synthesis'; label: string }
  | { type: 'opinion'; agentId: string; agentName: string; agentRole: string; round: 1 | 2; text: string }
  | { type: 'final'; text: string; leadAgentId: string; leadAgentName: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface Opinion {
  agentId: string;
  agentName: string;
  agentRole: string;
  round: 1 | 2;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  departmentId?: string;
  authorName?: string;
  /** บันทึกการถกกันก่อนสรุป - กางดูได้ในหน้าแชท */
  transcript?: Opinion[];
  /** หลักฐานว่า skill ถูกส่งไปจริง - กางดูได้ในหน้าแชท */
  proof?: SkillProof;
  pending?: boolean;
}
