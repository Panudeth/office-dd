import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { DEPARTMENTS } from '@/lib/departments';
import { listOfficeDepartments, runHeadless } from '@/lib/headless';
import { officeFromToken, sbAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* ============================================================
   MCP server ของออฟฟิศ - ให้ agent ข้างนอก (Claude Code, pugbase, ฯลฯ) เดินเข้ามาถามแผนกได้
     endpoint:  POST /api/mcp   (Streamable HTTP)
     auth:      Authorization: Bearer <office token>  (สร้างจากหน้าออฟฟิศ)
   ทุก tool ทำงานบนออฟฟิศของ token นั้นเท่านั้น - คำถามที่ถามผ่านทางนี้จะเห็นเป็นการประชุมจริงในจอ
   ============================================================ */

const DEPT_IDS = DEPARTMENTS.map((d) => d.id) as [string, ...string[]];

const officeOf = (ctx: { http?: { authInfo?: { extra?: Record<string, unknown> } } }): string => {
  const id = ctx.http?.authInfo?.extra?.officeId;
  if (typeof id !== 'string') throw new Error('unauthorized');
  return id;
};

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/**
 * โมเดลในเครื่องอาจใช้เวลาหลายนาที แต่ MCP client ส่วนใหญ่รอ tool ได้ ~1 นาที
 * จึงรอแค่ wait_seconds - ไม่ทันก็คืน meetingId ให้ไปถาม get_meeting ทีหลัง งานฝั่งเซิร์ฟเวอร์เดินต่อเอง
 */
const withWait = async <T,>(p: Promise<T>, seconds: number): Promise<T | 'timeout'> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((r) => { t = setTimeout(() => r('timeout'), Math.max(1, seconds) * 1000); });
  const out = await Promise.race([p, timeout]);
  if (t) clearTimeout(t);
  return out;
};

/** meetingId ล่าสุดของออฟฟิศที่เพิ่งเปิด (running) - เอาไว้บอก client ตอนรอไม่ทัน */
const latestRunningMeeting = async (officeId: string, question: string): Promise<string | null> => {
  const c = sbAdmin();
  if (!c) return null;
  const { data } = await c
    .from('meeting')
    .select('id')
    .eq('office_id', officeId)
    .eq('question', question)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
};

const stillRunning = (meetingId: string | null, waited: number) => ({
  ...text(
    `ยังตอบไม่เสร็จใน ${waited} วินาที (โมเดลในเครื่องอาจใช้เวลาหลายนาที) - งานยังเดินต่ออยู่ฝั่งออฟฟิศ ` +
    `เรียก get_meeting กับ meetingId "${meetingId ?? '?'}" อีกครั้งในอีก 1-2 นาที เพื่อรับคำตอบ`,
  ),
  structuredContent: { status: 'running', meetingId },
});

/* ---------- token สาธารณะ (ช่องทางลูกค้า): tool เดียว ถามแผนกรับลูกค้า ได้เฉพาะคำตอบที่กรองแล้ว ---------- */
const publicHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'ask_customer_service',
      {
        title: 'ถามฝ่ายบริการลูกค้า',
        description:
          'ส่งคำถามของลูกค้าให้ฝ่ายประชาสัมพันธ์/บริการลูกค้าของบริษัทตอบ - ตอบจากข้อมูลสาธารณะ (สินค้า ราคา บริการ ช่องทางติดต่อ) ' +
          'ถ้าเรื่องต้องปรึกษาทีมภายใน จะได้ข้อความบอกให้รอ แล้วคำตอบจริงตามมาทีหลัง (status running -> เรียกซ้ำด้วย meetingId)',
        inputSchema: z.object({
          question: z.string().min(1).describe('คำถามของลูกค้า'),
          customer: z.string().optional().describe('ชื่อ/รหัสลูกค้า (ถ้ามี) - ใช้ในบันทึกเท่านั้น'),
          meeting_id: z.string().optional().describe('meetingId ที่ได้จากรอบก่อน (status running) - ส่งมาเพื่อรับคำตอบ ไม่ต้องส่ง question ใหม่'),
          wait_seconds: z.number().int().min(5).max(280).optional(),
        }),
      },
      async ({ question, customer, meeting_id, wait_seconds }, ctx) => {
        const officeId = officeOf(ctx);
        const c = sbAdmin();
        if (meeting_id && c) {
          const { data } = await c.from('meeting').select('id,status,customer_reply,audience')
            .eq('office_id', officeId).eq('id', meeting_id).maybeSingle();
          const m = data as { status: string; customer_reply: string; audience: string } | null;
          if (!m || m.audience !== 'customer') return { ...text('ไม่พบรายการนี้'), isError: true };
          if (m.status === 'running' || !m.customer_reply) {
            return { ...text('ยังรอคำตอบจากทีมอยู่ค่ะ ลองใหม่อีกครั้งในอีก 1-2 นาที'), structuredContent: { status: 'running', meetingId: meeting_id } };
          }
          return { ...text(m.customer_reply), structuredContent: { status: 'done', answer: m.customer_reply, meetingId: meeting_id } };
        }
        const run = runHeadless({
          officeId, question, audience: 'customer', source: 'mcp',
          askedByLabel: customer ? `ลูกค้า ${customer} (ผ่าน MCP)` : 'ลูกค้า (ผ่าน MCP)',
        });
        const waited = wait_seconds ?? 50;
        const r = await withWait(run, waited);
        if (r === 'timeout') {
          const id = await latestRunningMeeting(officeId, question.trim());
          return {
            ...text(`รับเรื่องแล้วค่ะ กำลังหาคำตอบให้ (อาจต้องปรึกษาทีมสักครู่) - เรียกซ้ำด้วย meeting_id "${id ?? '?'}" ในอีก 1-2 นาที`),
            structuredContent: { status: 'running', meetingId: id },
          };
        }
        if (r.error && !r.customerReply) return { ...text('ขออภัยค่ะ ตอนนี้ยังตอบไม่ได้ ทีมงานจะติดต่อกลับ'), isError: true };
        return { ...text(r.customerReply), structuredContent: { status: 'done', answer: r.customerReply, meetingId: r.meetingId, escalated: r.escalated } };
      },
    );
  },
  {
    serverInfo: { name: 'visual-company-public', version: '0.1.0' },
    instructions: 'ช่องทางลูกค้าของบริษัท - ใช้ ask_customer_service ส่งคำถามของลูกค้า จะได้คำตอบจากฝ่ายบริการลูกค้าเท่านั้น (ไม่มีข้อมูลภายใน)',
  },
);

/* ---------- token ภายใน (agent ของเรา): ถามทุกแผนก ประชุม อ่านสมุด ---------- */
const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'list_departments',
      {
        title: 'รายชื่อแผนกและพนักงาน',
        description:
          'แผนกที่มีพนักงานอยู่ในออฟฟิศนี้ พร้อมหัวหน้าแผนก (คนแรกที่จ้าง เป็นประธานที่ประชุม) และสมาชิก ' +
          'ใช้ดูก่อนว่าจะถามแผนกไหนได้บ้าง',
        inputSchema: z.object({}),
      },
      async (_args, ctx) => {
        const depts = await listOfficeDepartments(officeOf(ctx));
        return { ...text(JSON.stringify(depts, null, 2)), structuredContent: { departments: depts } };
      },
    );

    server.registerTool(
      'ask_department',
      {
        title: 'ถามแผนกโดยตรง',
        description:
          'ส่งคำถามให้หัวหน้าแผนกที่ระบุตอบจากข้อมูลบริษัท (โปรไฟล์ สินค้า โน้ตแผนก เอกสาร) ' +
          'เร็ว - คำขอ LLM ครั้งเดียว เหมาะกับคำถามข้อเท็จจริง/ข้อกฎหมาย/ตัวเลข ที่อยากได้มุมของแผนกนั้น ' +
          'ในจอออฟฟิศจะเห็นหัวหน้าแผนกลุกไปตอบ และคำตอบถูกบันทึกในสมุดเลขาฯ',
        inputSchema: z.object({
          department: z.enum(DEPT_IDS).describe('id แผนก: ' + DEPARTMENTS.map((d) => `${d.id}=${d.nameTh}`).join(', ')),
          question: z.string().min(1).describe('คำถาม (ภาษาไทยหรืออังกฤษ)'),
          asked_by: z.string().optional().describe('ใครถาม เช่น ชื่อ agent หรือระบบ - โชว์ในบันทึก'),
          wait_seconds: z.number().int().min(5).max(280).optional()
            .describe('รอคำตอบนานสุดกี่วินาที (ค่าเริ่มต้น 50) - ไม่ทันจะได้ meetingId ไปเรียก get_meeting ทีหลัง'),
        }),
      },
      async ({ department, question, asked_by, wait_seconds }, ctx) => {
        const officeId = officeOf(ctx);
        const run = runHeadless({
          officeId, question, deptIds: [department], mode: 'direct',
          source: 'mcp', askedByLabel: asked_by ? `${asked_by} (ผ่าน MCP)` : 'ผ่าน MCP',
        });
        const waited = wait_seconds ?? 50;
        const r = await withWait(run, waited);
        if (r === 'timeout') return stillRunning(await latestRunningMeeting(officeId, question.trim()), waited);
        if (r.error && !r.answer) return { ...text(`ตอบไม่ได้: ${r.error}`), isError: true };
        return {
          ...text(r.answer),
          structuredContent: { answer: r.answer, chair: r.chair, model: r.model, meetingId: r.meetingId },
        };
      },
    );

    server.registerTool(
      'hold_meeting',
      {
        title: 'เรียกประชุมข้ามแผนก',
        description:
          'เปิดประชุมหลายแผนก (ถกกัน 2 รอบ แล้วประธานสรุป เลขาฯ จดรายงาน) - ช้ากว่า ask_department มาก (หลายนาที) ' +
          'ใช้กับเรื่องที่ต้องชั่งน้ำหนักหลายมุม ไม่ระบุแผนกให้เลขาฯ เลือกจากคำถาม',
        inputSchema: z.object({
          question: z.string().min(1),
          departments: z.array(z.enum(DEPT_IDS)).optional().describe('แผนกที่ให้เข้าประชุม - ว่าง = เลขาฯ เลือกให้'),
          mode: z.enum(['roundtable', 'relay']).optional().describe('roundtable (ค่าเริ่มต้น) หรือ relay'),
          asked_by: z.string().optional(),
          wait_seconds: z.number().int().min(5).max(280).optional()
            .describe('รอนานสุดกี่วินาที (ค่าเริ่มต้น 50) - ประชุมเต็มมักไม่ทัน ให้เรียก get_meeting ตามทีหลัง'),
        }),
      },
      async ({ question, departments, mode, asked_by, wait_seconds }, ctx) => {
        const officeId = officeOf(ctx);
        const run = runHeadless({
          officeId, question, deptIds: departments, mode: mode ?? 'roundtable',
          source: 'mcp', askedByLabel: asked_by ? `${asked_by} (ผ่าน MCP)` : 'ผ่าน MCP',
        });
        const waited = wait_seconds ?? 50;
        const r = await withWait(run, waited);
        if (r === 'timeout') return stillRunning(await latestRunningMeeting(officeId, question.trim()), waited);
        if (r.error && !r.answer) return { ...text(`ประชุมไม่สำเร็จ: ${r.error}`), isError: true };
        const body = [r.answer, r.minutes ? `\n\n---\nรายงานการประชุม (เลขาฯ):\n${r.minutes}` : ''].join('');
        return {
          ...text(body),
          structuredContent: {
            answer: r.answer, minutes: r.minutes, chair: r.chair, departments: r.deptIds,
            transcript: r.transcript.map((o) => ({ name: o.agentName, role: o.agentRole, dept: o.deptId, round: o.round, text: o.text })),
            meetingId: r.meetingId,
          },
        };
      },
    );

    server.registerTool(
      'get_meeting',
      {
        title: 'ดูผลการประชุม/คำตอบตาม id',
        description:
          'ดึงคำตอบของ ask_department หรือ hold_meeting ที่ยังไม่เสร็จตอนเรียกครั้งแรก (status running) ' +
          'หรือดูบันทึกเก่าแบบเต็ม (สรุป, รายงานเลขาฯ, บทสนทนา) - เรียกซ้ำจน status เป็น done',
        inputSchema: z.object({ meetingId: z.string().min(1) }),
      },
      async ({ meetingId }, ctx) => {
        const c = sbAdmin();
        if (!c) return { ...text('เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY'), isError: true };
        const { data } = await c
          .from('meeting')
          .select('id,question,mode,dept_ids,summary,minutes,transcript,status,error,source,created_at,updated_at')
          .eq('office_id', officeOf(ctx))
          .eq('id', meetingId)
          .maybeSingle();
        if (!data) return { ...text('ไม่พบการประชุมนี้'), isError: true };
        const m = data as { status: string; summary: string; minutes: string; error: string | null; transcript: unknown[] };
        const body = m.status === 'running'
          ? `ยังไม่เสร็จ (running) - ตอบแล้ว ${(m.transcript ?? []).length} ความเห็น ลองใหม่ในอีก 1-2 นาที`
          : m.status === 'error'
            ? `ประชุมล้มเหลว: ${m.error ?? 'ไม่ทราบสาเหตุ'}`
            : [m.summary || '(ไม่มีคำตอบ)', m.minutes ? `\n\n---\nรายงานการประชุม (เลขาฯ):\n${m.minutes}` : ''].join('');
        return { ...text(body), structuredContent: data as Record<string, unknown> };
      },
    );

    server.registerTool(
      'list_meetings',
      {
        title: 'บันทึกการประชุมย้อนหลัง',
        description: 'รายการประชุมล่าสุดของออฟฟิศ (คำถาม, แผนก, สรุป) - ใช้ดูว่าเคยตัดสินเรื่องนี้ไว้ว่าอย่างไร',
        inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      },
      async ({ limit }, ctx) => {
        const c = sbAdmin();
        if (!c) return { ...text('เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY'), isError: true };
        const { data } = await c
          .from('meeting')
          .select('id,question,mode,dept_ids,summary,minutes,status,source,created_at')
          .eq('office_id', officeOf(ctx))
          .order('created_at', { ascending: false })
          .limit(limit ?? 10);
        return { ...text(JSON.stringify(data ?? [], null, 2)), structuredContent: { meetings: data ?? [] } };
      },
    );
  },
  {
    serverInfo: { name: 'visual-company', version: '0.1.0' },
    instructions:
      'นี่คือออฟฟิศจำลองที่พนักงานเป็น AI agent แบ่งเป็นแผนก (กฎหมาย การเงิน วิศวกรรม บุคคล การตลาด ประชาสัมพันธ์) ' +
      'ใช้ ask_department สำหรับคำถามที่อยากได้มุมของแผนกใดแผนกหนึ่ง (เร็ว) และ hold_meeting เมื่อต้องการให้หลายแผนกถกกัน (ช้า) ' +
      'ถ้าได้ status running กลับมา แปลว่าโมเดลยังตอบไม่เสร็จ - เรียก get_meeting ด้วย meetingId ในอีก 1-2 นาที',
  },
);

/** token ออฟฟิศ -> ออฟฟิศไหน + scope - ไม่ผ่านคือ 401 */
const verify = async (_req: Request, bearer?: string) => {
  const t = await officeFromToken(bearer);
  if (!t) return undefined;
  return { token: bearer ?? '', clientId: `office:${t.officeId}`, scopes: [t.scope], extra: { officeId: t.officeId, scope: t.scope } };
};
const authedInternal = withMcpAuth(handler, verify, { required: true });
const authedPublic = withMcpAuth(publicHandler, verify, { required: true });

/** เลือกชุด tool ตาม scope ของ token - token สาธารณะไม่มีทางเห็น tool ภายในเลย */
async function route(req: Request): Promise<Response> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const t = await officeFromToken(bearer);
  return t?.scope === 'public' ? authedPublic(req) : authedInternal(req);
}

export { route as GET, route as POST, route as DELETE };
