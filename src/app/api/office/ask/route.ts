import { NextRequest } from 'next/server';
import { runHeadless } from '@/lib/headless';
import { officeFromToken } from '@/lib/supabase-admin';
import type { MeetingMode } from '@/lib/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ถามออฟฟิศจากข้างนอกโดยไม่มีเบราว์เซอร์
 *   POST /api/office/ask
 *   Authorization: Bearer <office token>   (สร้างจากหน้าออฟฟิศ)
 *   { question, deptIds?, mode?: 'direct'|'roundtable'|'relay', publicOnly?, askedBy? }
 * คำตอบเป็น JSON เมื่อประชุมจบ - จอที่เปิดอยู่จะเห็นคนลุกไปประชุมระหว่างนี้
 * คีย์ LLM ใช้ของ .env บนเซิร์ฟเวอร์ (LLM_PROVIDER / OPENAI_BASE_URL ...) เพราะไม่มีเบราว์เซอร์ส่งมา
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const t = await officeFromToken(bearer);
  if (!t) return Response.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  const { officeId, scope } = t;

  let body: { question?: string; deptIds?: string[]; mode?: MeetingMode; publicOnly?: boolean; askedBy?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!body.question?.trim()) return Response.json({ error: 'ไม่มีคำถาม' }, { status: 400 });

  // token สาธารณะ = ลูกค้าถาม: บังคับ audience customer และคืนเฉพาะคำตอบที่กรองแล้ว
  const customer = scope === 'public' || body.publicOnly === true;
  const result = await runHeadless({
    officeId,
    question: body.question,
    deptIds: body.deptIds,
    mode: body.mode,
    audience: customer ? 'customer' : 'internal',
    askedByLabel: body.askedBy,
    source: 'api',
  });
  if (scope === 'public') {
    return Response.json(
      { meetingId: result.meetingId, answer: result.customerReply, escalated: result.escalated, error: result.error },
      { status: result.error && !result.customerReply ? 502 : 200 },
    );
  }
  return Response.json(result, { status: result.error && !result.answer ? 502 : 200 });
}
