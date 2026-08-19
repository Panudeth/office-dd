import { NextRequest } from 'next/server';
import { sendToChannel, type ChannelRow } from '@/lib/channels';
import { loadOfficeDepartments } from '@/lib/office-depts';
import { isMember, sbAdmin, userIdFromToken } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ทดสอบช่องส่งออกของแผนก - ส่งข้อความตัวอย่างไปที่ channel นั้น
 *   POST { officeId, channelId }  + x-sb-token (เจ้าของ/exec)
 * ยิงจากเซิร์ฟเวอร์ (ไม่ใช่เบราว์เซอร์) เพราะ webhook ของ Teams/Slack ไม่เปิด CORS
 */
export async function POST(req: NextRequest) {
  const c = sbAdmin();
  if (!c) return Response.json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { officeId?: string; channelId?: string };
  if (!body.officeId || !body.channelId) return Response.json({ error: 'ไม่มี officeId/channelId' }, { status: 400 });
  const uid = await userIdFromToken(req.headers.get('x-sb-token'));
  if (!uid || !(await isMember(body.officeId, uid))) return Response.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  const { data: mem } = await c.from('office_member').select('role').eq('office_id', body.officeId).eq('user_id', uid).maybeSingle();
  if (!mem || !['owner', 'exec'].includes((mem as { role: string }).role)) return Response.json({ error: 'เฉพาะเจ้าของหรือ exec' }, { status: 403 });

  const { data: ch } = await c.from('office_dept_channel').select('id,dept_id,kind,label,config,events,enabled')
    .eq('office_id', body.officeId).eq('id', body.channelId).maybeSingle();
  if (!ch) return Response.json({ error: 'ไม่พบ channel' }, { status: 404 });
  const row = ch as ChannelRow;
  const depts = await loadOfficeDepartments(body.officeId);
  try {
    await sendToChannel(row, {
      officeId: body.officeId, deptId: row.dept_id, deptName: depts.byId.get(row.dept_id)?.nameTh ?? row.dept_id,
      title: 'ทดสอบการเชื่อมต่อ', text: `สวัสดี - นี่คือข้อความทดสอบจาก${depts.byId.get(row.dept_id)?.nameTh ?? row.dept_id} ถ้าเห็นข้อความนี้แปลว่าช่อง "${row.label || row.kind}" ใช้ได้แล้ว`,
      meetingId: null, inboxId: null, source: 'ทดสอบจากหน้าออฟฟิศ', link: `${req.nextUrl.origin}/`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
