import { NextRequest, after } from 'next/server';
import { DEPT_ID_RE } from '@/lib/departments';
import { createInbox, dataToText, processInbox, type InboxInput } from '@/lib/inbox';
import { loadOfficeDepartments } from '@/lib/office-depts';
import { isMember, sbAdmin, userIdFromToken } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ยิงทดสอบ webhook เข้าของแผนกจากหน้าออฟฟิศ - ไม่ต้องมี token/curl
 *   POST { officeId, deptId }  + x-sb-token (เจ้าของ/exec)
 * เดินเส้นเดียวกับ webhook จริงทุกขั้น (เก็บ inbox -> เอกสาร -> หัวหน้าแผนกรายงาน -> ส่งออก)
 * ตอบ 202 ทันที หน้าเว็บตามดูผลใน "ที่เข้ามาล่าสุด" (Realtime/poll)
 */
export async function POST(req: NextRequest) {
  const c = sbAdmin();
  if (!c) return Response.json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { officeId?: string; deptId?: string; source?: string };
  const officeId = body.officeId ?? '';
  const deptId = (body.deptId ?? '').toLowerCase();
  if (!officeId || !DEPT_ID_RE.test(deptId)) return Response.json({ error: 'ไม่มี officeId/deptId' }, { status: 400 });
  const uid = await userIdFromToken(req.headers.get('x-sb-token'));
  if (!uid || !(await isMember(officeId, uid))) return Response.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  const { data: mem } = await c.from('office_member').select('role').eq('office_id', officeId).eq('user_id', uid).maybeSingle();
  if (!mem || !['owner', 'exec'].includes((mem as { role: string }).role)) return Response.json({ error: 'เฉพาะเจ้าของหรือ exec' }, { status: 403 });

  const depts = await loadOfficeDepartments(officeId);
  const dept = depts.byId.get(deptId);
  if (!dept) return Response.json({ error: `ไม่มีแผนก ${deptId}` }, { status: 404 });

  // ข้อมูลตัวอย่างกลาง ๆ ที่แผนกไหนก็อ่านได้ - แผนกจะตีความตาม playbook/หน้าที่ของตัวเอง
  const now = new Date();
  const data = {
    event: 'test',
    service: 'office-webhook-test',
    at: now.toISOString(),
    severity: 'medium',
    summary: `ข้อความทดสอบถึง${dept.nameTh} - ระบบภายนอกส่งข้อมูลนี้เข้ามาเพื่อลองเส้นทาง webhook`,
    items: [
      { id: 'T-1', title: 'ตัวอย่างรายการที่ 1', value: 1250, note: 'เพิ่มขึ้น 18% จากรอบก่อน' },
      { id: 'T-2', title: 'ตัวอย่างรายการที่ 2', value: 480, note: 'ปกติ' },
      { id: 'T-3', title: 'ตัวอย่างรายการที่ 3', value: 0, note: 'ไม่มีข้อมูล ต้องตรวจสอบ' },
    ],
  };
  const input: InboxInput = {
    officeId, deptId, title: `ทดสอบ webhook เข้า ${now.toLocaleString('th-TH')}`, source: (typeof body.source === 'string' && body.source.trim().slice(0, 120)) || 'ทดสอบจากหน้าออฟฟิศ',
    intent: 'task', ask: '', mode: 'direct', data, dataText: dataToText(data), idemKey: null, deliver: undefined,
    origin: req.nextUrl.origin,
  };
  let inboxId: string;
  try {
    inboxId = await createInbox(input);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const job = processInbox(input, inboxId).catch((e) => { console.error('[inbox test]', e); return null; });
  after(async () => { await job; });
  return Response.json({ inboxId, status: 'running' }, { status: 202 });
}
