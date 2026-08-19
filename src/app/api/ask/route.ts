import { NextRequest } from 'next/server';
import { sanitizeDeptDefs } from '@/lib/departments';
import { normalizeMode, runMeetingEngine } from '@/lib/engine';
import { resolveCreds } from '@/lib/llm';
import { persistMeeting } from '@/lib/meeting-store';
import { checkOfficePolicy } from '@/lib/office-policy';
import type { AskEvent, AskRequest } from '@/lib/protocol';
import { withLang } from '@/lib/lang';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ประชุมที่เริ่มจากเบราว์เซอร์ - เบราว์เซอร์ส่งผู้เข้าประชุม/ข้อมูลบริษัท/คีย์มาเอง
 * ตอบกลับเป็น SSE ให้จอที่ถามเห็นทันที และถ้าเซิร์ฟเวอร์มี service key + รู้ว่าออฟฟิศไหน
 * จะบันทึก event ลง DB ด้วย เพื่อให้จออื่นเห็นการประชุมเดียวกันแบบสด และมีบันทึกโดยไม่ต้องพึ่งเบราว์เซอร์
 */
export async function POST(req: NextRequest) {
  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const question = body.question?.trim();
  if (!body.agents?.length || !question) {
    return new Response('missing question / agents', { status: 400 });
  }

  // คีย์ของผู้ใช้มาทาง header ไม่ใช่ body - จะได้ไม่ติดไปกับ log ของ request body
  const creds = resolveCreds({
    provider: req.headers.get('x-llm-provider'),
    apiKey: req.headers.get('x-llm-key'),
    model: req.headers.get('x-llm-model'),
    baseUrl: req.headers.get('x-llm-base-url'),
  });

  // นโยบาย "เฉพาะโมเดลในเครื่อง" ของออฟฟิศ - ปฏิเสธก่อนส่งอะไรออกไป
  const deny = await checkOfficePolicy(body.officeId, creds, body.llm);
  if (deny) return Response.json({ error: deny }, { status: 403 });

  const mode = normalizeMode(body.mode);
  // บันทึกลง DB ได้ต่อเมื่อรู้ออฟฟิศ + ผู้ใช้เป็นสมาชิกจริง (ตรวจจาก access token ของ Supabase)
  const store = await persistMeeting({
    officeId: body.officeId ?? null,
    accessToken: req.headers.get('x-sb-token'),
    source: 'web',
    question, mode, ownerDeptId: body.ownerDeptId, chairId: body.chairId,
    agents: body.agents, attendees: body.attendees ?? [],
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: AskEvent) => {
        store?.push(ev);
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      // แถวแรกบอกเบราว์เซอร์ว่าเซิร์ฟเวอร์บันทึกให้แล้ว (จะได้ไม่บันทึกซ้ำ) - เป็น event เดียวกับที่ลง DB
      if (store) send(store.openEvent());
      try {
        await runMeetingEngine({
          question, mode, ownerDeptId: body.ownerDeptId, chairId: body.chairId,
          agents: body.agents, company: withLang(body.company, body.lang), creds, assign: body.llm,
          departments: sanitizeDeptDefs(body.departments),
        }, send);
      } finally {
        closed = true;
        controller.close();
        await store?.flush();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
