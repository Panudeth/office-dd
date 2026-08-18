import { NextRequest } from 'next/server';
import { describeOfficeLlm, sanitizeStore, saveOfficeLlm } from '@/lib/office-llm';
import { isMember, sbAdmin, userIdFromToken } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ชุดคีย์/โมเดลของออฟฟิศสำหรับ MCP / LINE / API - สำเนาของ "คีย์ของฉัน" ในเบราว์เซอร์
 *   GET    ?officeId=          สรุป (มีตั้งไหม, อัปเดตเมื่อไร, ชุดไหนบ้าง) - ไม่มีคีย์
 *   PUT    { officeId, store } บันทึกทั้งชุด (เข้ารหัสคีย์ก่อนลง) - items ว่าง = ลบ
 * ยืนยันตัวด้วย x-sb-token เหมือน /api/office/token - เฉพาะเจ้าของ/exec เพราะมีผลกับทั้งออฟฟิศ
 */
async function editor(req: NextRequest, officeId: string | null) {
  const c = sbAdmin();
  if (!c) return { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY', status: 503 } as const;
  if (!officeId) return { error: 'ไม่มี officeId', status: 400 } as const;
  const uid = await userIdFromToken(req.headers.get('x-sb-token'));
  if (!uid || !(await isMember(officeId, uid))) return { error: 'ไม่มีสิทธิ์', status: 403 } as const;
  const { data } = await c.from('office_member').select('role').eq('office_id', officeId).eq('user_id', uid).maybeSingle();
  if (!data || !['owner', 'exec'].includes((data as { role: string }).role)) return { error: 'เฉพาะเจ้าของหรือ exec', status: 403 } as const;
  return { c, uid } as const;
}

export async function GET(req: NextRequest) {
  const officeId = req.nextUrl.searchParams.get('officeId');
  const e = await editor(req, officeId);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  try {
    return Response.json(await describeOfficeLlm(officeId!));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { officeId?: string; store?: unknown };
  const e = await editor(req, body.officeId ?? null);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  try {
    await saveOfficeLlm(body.officeId!, sanitizeStore(body.store), e.uid);
    return Response.json(await describeOfficeLlm(body.officeId!));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
