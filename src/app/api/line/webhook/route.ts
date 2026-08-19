import { NextRequest, after } from 'next/server';
import { handleLineEvents, listInbound, verifyLineSignature } from '@/lib/line-inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* ============================================================
   LINE Official Account -> แผนกรับลูกค้า (แบบตั้งใน .env - ออฟฟิศเดียวต่อหนึ่ง deployment)
   แนะนำให้ย้ายไปตั้งจากหน้าเว็บแทน: แผนก -> Webhook เข้า -> LINE Official Account (ได้ URL /api/line/webhook/<id>)
   เส้นนี้คงไว้ให้ของเดิมไม่พัง

   .env:
     LINE_CHANNEL_SECRET=        จาก LINE Developers -> Basic settings
     LINE_CHANNEL_ACCESS_TOKEN=  จาก Messaging API -> Channel access token (long-lived)
     LINE_OFFICE_ID=             uuid ของออฟฟิศ
     LINE_DEPT=pr                แผนกที่ตอบ (ค่าเริ่มต้น pr)
   ============================================================ */

const cfg = () => ({
  secret: process.env.LINE_CHANNEL_SECRET ?? '',
  token: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
  officeId: process.env.LINE_OFFICE_ID ?? '',
  dept: process.env.LINE_DEPT ?? 'pr',
});

/** GET ไว้ให้ LINE console กด Verify และให้เราเช็คว่าตั้ง env ครบไหม */
export async function GET() {
  const c = cfg();
  return Response.json({
    ok: true,
    configured: Boolean(c.secret && c.token && c.officeId),
    missing: [!c.secret && 'LINE_CHANNEL_SECRET', !c.token && 'LINE_CHANNEL_ACCESS_TOKEN', !c.officeId && 'LINE_OFFICE_ID'].filter(Boolean),
    dept: c.dept,
    hint: 'ตั้งค่าจากหน้าเว็บได้แล้ว: แผนก -> Webhook เข้า -> LINE Official Account (URL /api/line/webhook/<id>)',
  });
}

export async function POST(req: NextRequest) {
  const c = cfg();
  if (!c.secret || !c.token || !c.officeId) {
    return Response.json({ error: 'LINE ยังไม่ได้ตั้งค่า (.env) - หรือตั้งจากหน้าเว็บแล้วใช้ URL /api/line/webhook/<id> แทน' }, { status: 503 });
  }
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get('x-line-signature') ?? '', c.secret)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  // ถ้าออฟฟิศ+แผนกนี้ตั้ง LINE OA จากหน้าเว็บไว้แล้ว ใช้ชื่อ OA นั้นเป็นแหล่ง - ช่องส่งออกที่กรองตามชื่อ OA จะได้ตรงกันไม่ว่ายิงเข้าเส้นไหน
  const oa = (await listInbound(c.officeId, c.dept)).find((r) => r.enabled);
  const r = handleLineEvents(raw, { officeId: c.officeId, deptId: c.dept, channelSecret: c.secret, accessToken: c.token, label: oa?.label || 'LINE', origin: req.nextUrl.origin });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  after(async () => { await r.work; });
  return Response.json({ ok: true });
}
