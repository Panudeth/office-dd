import { NextRequest } from 'next/server';
import { buildAgenda } from '@/lib/agenda';
import { sanitizeDeptDefs } from '@/lib/departments';
import { resolveCreds } from '@/lib/llm';
import type { AgendaRequest } from '@/lib/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * เลขานุการอ่านคำถามแล้วเสนอว่าควรเรียกใครเข้าประชุม
 * แยกจาก /api/ask เพราะผู้ใช้ต้องได้ตรวจและแก้รายชื่อก่อนประชุมจะเริ่ม
 * ไม่มีคีย์ก็ยังตอบได้ (ถอยไปนับคำ) - เลขาฯ พังต้องไม่ทำให้ถามไม่ได้เลย
 */
export async function POST(req: NextRequest) {
  let body: AgendaRequest;
  try {
    body = (await req.json()) as AgendaRequest;
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) return Response.json({ error: 'ไม่มีคำถาม' }, { status: 400 });

  const creds = resolveCreds({
    provider: req.headers.get('x-llm-provider'),
    apiKey: req.headers.get('x-llm-key'),
    model: req.headers.get('x-llm-model'),
    baseUrl: req.headers.get('x-llm-base-url'),
  });

  try {
    const agenda = await buildAgenda(question, body.hiredDeptIds ?? [], creds, body.profile, sanitizeDeptDefs(body.departments));
    return Response.json(agenda);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
