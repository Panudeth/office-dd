import 'server-only';
import { isMember, sbAdmin, userIdFromToken } from '@/lib/supabase-admin';
import type {
  AskAgent, AskEvent, Consult, MeetingAttendeeLite, MeetingAudience, MeetingMode, MeetingSource, Opinion,
} from '@/lib/protocol';

/* ============================================================
   บันทึกการประชุมลง DB แบบสด - แถว meeting เปิดตั้งแต่เริ่ม (status running)
   ทุก event ที่ engine ยิงถูก append ลง meeting_event เรียง seq
   จออื่นที่ subscribe Realtime จะเห็นเหมือนนั่งอยู่ในห้อง และปิดจอไปบันทึกก็ยังครบ
   ============================================================ */

export interface PersistInput {
  officeId: string | null;
  /** access token ของผู้ใช้จากเบราว์เซอร์ - ใช้ยืนยันว่าเป็นสมาชิกออฟฟิศ (ทางเว็บ) */
  accessToken?: string | null;
  /** เรียกจากระบบภายนอกที่ผ่าน office token มาแล้ว - ข้ามการตรวจสมาชิก */
  trusted?: boolean;
  source: MeetingSource;
  /** ใครถาม - ค่าเริ่มต้น internal */
  audience?: MeetingAudience;
  question: string;
  mode: MeetingMode;
  ownerDeptId: string;
  chairId?: string;
  agents: AskAgent[];
  attendees: MeetingAttendeeLite[];
}

export interface MeetingStore {
  meetingId: string;
  /** event แถวแรกที่บอกจออื่นว่าประชุมนี้คืออะไร */
  openEvent(): AskEvent;
  /** ส่ง event เข้าคิวเขียน - ไม่ block engine */
  push(ev: AskEvent): void;
  /** รอให้เขียนครบ - เรียกตอน engine จบ */
  flush(): Promise<void>;
}

/**
 * เปิดการบันทึก - คืน null ถ้าทำไม่ได้ (ไม่มี service key / ไม่รู้ออฟฟิศ / ผู้ใช้ไม่ใช่สมาชิก)
 * null แปลว่า "ทำงานแบบเดิม" เบราว์เซอร์บันทึกเองตอนจบ ไม่ใช่ error
 */
export async function persistMeeting(input: PersistInput): Promise<MeetingStore | null> {
  const c = sbAdmin();
  if (!c || !input.officeId) return null;

  let askedBy: string | null = null;
  if (!input.trusted) {
    askedBy = await userIdFromToken(input.accessToken);
    if (!askedBy || !(await isMember(input.officeId, askedBy))) return null;
  }

  const deptIds = [...new Set(input.agents.map((a) => a.deptId))];
  const row = {
    office_id: input.officeId,
    asked_by: askedBy,
    question: input.question,
    mode: input.mode,
    owner_dept: deptIds.includes(input.ownerDeptId) ? input.ownerDeptId : deptIds[0] ?? '',
    dept_ids: deptIds,
    attendees: input.attendees,
    chair_id: input.chairId ?? null,
    source: input.source,
    audience: input.audience ?? 'internal',
    status: 'running',
  };
  let { data, error } = await c.from('meeting').insert(row).select('id').single();
  // ฐานที่ยังไม่ได้รัน schema รอบล่าสุด (ไม่มี audience) - ลองแบบเก่าก่อนจะยอมแพ้ ผู้ใช้จะได้ยังเห็นการประชุมสด
  if (error && /audience/i.test(error.message)) {
    const { audience: _a, ...legacy } = row;
    void _a;
    ({ data, error } = await c.from('meeting').insert(legacy).select('id').single());
  }
  if (error || !data) {
    console.error('[meeting-store] open failed:', error?.message);
    return null;
  }
  const meetingId = data.id as string;

  // สะสมไว้อัปเดตแถวหลักเป็นระยะ - transcript/consults/summary/minutes อยู่บนแถว meeting เหมือนเดิม
  const transcript: Opinion[] = [];
  const consults: Consult[] = [];
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const patchRow = (patch: Record<string, unknown>) =>
    c.from('meeting').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', meetingId);

  const push = (ev: AskEvent) => {
    const n = ++seq;
    chain = chain.then(async () => {
      const { error: e1 } = await c.from('meeting_event').insert({
        meeting_id: meetingId, office_id: input.officeId, seq: n, type: ev.type, payload: ev,
      });
      if (e1) console.error('[meeting-store] event failed:', e1.message);

      if (ev.type === 'opinion') {
        transcript.push({
          agentId: ev.agentId, agentName: ev.agentName, agentRole: ev.agentRole, deptId: ev.deptId,
          round: ev.round, step: ev.step, askedBy: ev.askedBy, text: ev.text, model: ev.model,
        });
        await patchRow({ transcript });
      } else if (ev.type === 'consult') {
        consults.push({ step: ev.step, fromName: ev.fromName, toName: ev.toName, toDeptId: ev.toDeptId, text: ev.text });
        await patchRow({ consults });
      } else if (ev.type === 'final') {
        await patchRow({ summary: ev.text, transcript, consults });
      } else if (ev.type === 'minutes' && ev.text) {
        await patchRow({ minutes: ev.text });
      } else if (ev.type === 'customer_reply') {
        await patchRow({ customer_reply: ev.text });
      } else if (ev.type === 'escalate') {
        // PR พาทีมเข้าประชุม - แถวหลักต้องสะท้อนทีมจริง (สมุดกรองตามแผนกได้)
        const ids = [...new Set(ev.agents.map((a) => a.deptId))];
        await patchRow({ mode: 'relay', dept_ids: ids, chair_id: ev.chairId, attendees: ev.attendees });
      } else if (ev.type === 'done') {
        await patchRow({ status: 'done' });
      } else if (ev.type === 'error') {
        await patchRow({ status: 'error', error: ev.message });
      }
    }).catch((e) => console.error('[meeting-store]', e));
  };

  return {
    meetingId,
    openEvent: () => ({
      type: 'meeting',
      id: meetingId,
      source: input.source,
      question: input.question,
      mode: input.mode,
      ownerDeptId: input.ownerDeptId,
      chairId: input.chairId,
      agents: input.agents,
      attendees: input.attendees,
      audience: input.audience ?? 'internal',
    }),
    push,
    flush: async () => {
      await chain;
      // engine จบโดยไม่ได้ส่ง done/error (ถูกตัดกลางทาง) - อย่าปล่อยให้ค้าง running ตลอดกาล
      const { data: row } = await c.from('meeting').select('status').eq('id', meetingId).maybeSingle();
      if (row?.status === 'running') await patchRow({ status: 'error', error: 'การประชุมถูกตัดก่อนจบ' });
    },
  };
}
