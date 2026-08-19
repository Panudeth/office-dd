import { NextRequest } from 'next/server';
import { DEPT_ID_RE } from '@/lib/departments';
import { deleteInbound, listInbound, maskInbound, upsertInbound } from '@/lib/line-inbound';
import { isMember, sbAdmin, userIdFromToken } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ขาเข้าแบบ LINE OA ต่อแผนก - จัดการจากหน้าเว็บ (owner/exec) secret/token เข้ารหัสก่อนลง DB ไม่ส่งกลับ
 *   GET    ?officeId=&deptId=            รายการ (mask)
 *   POST   { officeId, deptId, id?, label, secret?, token?, ack?, enabled? }   สร้าง/แก้ (ช่องว่าง = คงค่าเดิม)
 *   DELETE { officeId, id }
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
  const deptId = req.nextUrl.searchParams.get('deptId') ?? undefined;
  const e = await editor(req, officeId);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  const rows = await listInbound(officeId!, deptId);
  return Response.json({ inbound: rows.map(maskInbound) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    officeId?: string; deptId?: string; id?: string; label?: string; secret?: string; token?: string; ack?: string; enabled?: boolean;
  };
  const e = await editor(req, body.officeId ?? null);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  const deptId = (body.deptId ?? '').toLowerCase();
  if (!DEPT_ID_RE.test(deptId)) return Response.json({ error: 'deptId ไม่ถูกต้อง' }, { status: 400 });
  if (!body.id && (!body.secret?.trim() || !body.token?.trim())) return Response.json({ error: 'ต้องใส่ channel secret และ access token' }, { status: 400 });
  try {
    const row = await upsertInbound(body.officeId!, {
      id: body.id, deptId, label: body.label ?? '', secret: body.secret, token: body.token, ack: body.ack,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    });
    return Response.json({ row: maskInbound(row) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { officeId?: string; id?: string };
  const e = await editor(req, body.officeId ?? null);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  await deleteInbound(body.officeId!, body.id ?? '');
  return Response.json({ ok: true });
}
