import { NextRequest } from 'next/server';
import { isMember, sbAdmin, sha256, userIdFromToken } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * token ของออฟฟิศสำหรับ MCP / LINE / API - จัดการโดยผู้ใช้ที่ล็อกอิน (owner/exec)
 *   GET    ?officeId=      รายการ (ชื่อ, สร้างเมื่อ, ใช้ล่าสุด) - ไม่มี token จริง
 *   POST   { officeId, name }   สร้าง -> คืน token จริง "ครั้งเดียว"
 *   DELETE { officeId, id }     เพิกถอน
 * ยืนยันตัวด้วย x-sb-token (access token ของ Supabase) เพราะตาราง office_token เขียนด้วย service key
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
  const { data, error } = await e.c
    .from('office_token')
    .select('id,name,scope,dept_ids,created_at,last_used_at')
    .eq('office_id', officeId!)
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ tokens: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { officeId?: string; name?: string; scope?: string; deptIds?: string[] };
  const e = await editor(req, body.officeId ?? null);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  const name = (body.name ?? '').trim() || 'token';
  // public = ช่องทางลูกค้า (ถาม PR ได้อย่างเดียว ไม่เห็นสมุด) · inbox = ยิงเข้ากล่องรับของแผนกที่ระบุได้อย่างเดียว · อื่น = internal
  const scope = body.scope === 'public' ? 'public' : body.scope === 'inbox' ? 'inbox' : 'internal';
  const deptIds = scope === 'inbox' ? (Array.isArray(body.deptIds) ? body.deptIds.filter((d): d is string => typeof d === 'string' && /^[a-z0-9_-]{2,32}$/.test(d)).slice(0, 20) : []) : [];
  if (scope === 'inbox' && !deptIds.length) return Response.json({ error: 'token แบบ inbox ต้องระบุแผนกอย่างน้อย 1' }, { status: 400 });
  // token = vc_ + 32 ไบต์สุ่ม - เก็บ hash เท่านั้น
  const raw = 'vc_' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data, error } = await e.c
    .from('office_token')
    .insert({ office_id: body.officeId, name, scope, dept_ids: deptIds, token_hash: await sha256(raw), created_by: e.uid })
    .select('id,name,scope,dept_ids,created_at')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ token: raw, row: data });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { officeId?: string; id?: string };
  const e = await editor(req, body.officeId ?? null);
  if ('error' in e) return Response.json({ error: e.error }, { status: e.status });
  const { error } = await e.c.from('office_token').delete().eq('id', body.id ?? '').eq('office_id', body.officeId!);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
