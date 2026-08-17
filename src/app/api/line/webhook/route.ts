import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { runHeadless } from '@/lib/headless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* ============================================================
   LINE Official Account -> แผนกประชาสัมพันธ์
   ลูกค้าทัก LINE -> webhook นี้ -> ตอบรับทันที ("รับเรื่องแล้ว") -> หัวหน้า PR ตอบจากข้อมูลบริษัท
   (เฉพาะข้อมูลที่เปิดเผยได้: โปรไฟล์ สินค้า โน้ต/เอกสารของ PR) -> push คำตอบกลับ
   ในจอออฟฟิศจะเห็นหัวหน้า PR ลุกไปตอบ และคำถาม/คำตอบเข้าสมุดเลขาฯ (source = line)

   ตั้งค่าใน .env (ออฟฟิศเดียวต่อหนึ่ง deployment):
     LINE_CHANNEL_SECRET=        จาก LINE Developers -> Basic settings
     LINE_CHANNEL_ACCESS_TOKEN=  จาก Messaging API -> Channel access token (long-lived)
     LINE_OFFICE_ID=             uuid ของออฟฟิศ (ดูจากปุ่มออฟฟิศบนแถบบน)
     LINE_DEPT=pr                แผนกที่ตอบ (ค่าเริ่มต้น pr)
   Webhook URL ใน LINE console = https://<โดเมนของคุณ>/api/line/webhook
   ============================================================ */

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string; groupId?: string; roomId?: string };
  message?: { type: string; text?: string };
}

const cfg = () => ({
  secret: process.env.LINE_CHANNEL_SECRET ?? '',
  token: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
  officeId: process.env.LINE_OFFICE_ID ?? '',
  dept: process.env.LINE_DEPT ?? 'pr',
});

async function lineApi(path: string, body: unknown, token: string) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('[line]', path, res.status, await res.text().catch(() => ''));
}

/** LINE ตัดข้อความที่ 5000 ตัวอักษร - แบ่งเป็นหลายฟองถ้ายาว (สูงสุด 5 ฟองต่อครั้ง) */
const chunks = (s: string, n = 4500) => {
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length && out.length < 5) { out.push(rest.slice(0, n)); rest = rest.slice(n); }
  return out.length ? out : ['(ไม่มีคำตอบ)'];
};

/** GET ไว้ให้ LINE console กด Verify และให้เราเช็คว่าตั้ง env ครบไหม */
export async function GET() {
  const c = cfg();
  return Response.json({
    ok: true,
    configured: Boolean(c.secret && c.token && c.officeId),
    missing: [!c.secret && 'LINE_CHANNEL_SECRET', !c.token && 'LINE_CHANNEL_ACCESS_TOKEN', !c.officeId && 'LINE_OFFICE_ID'].filter(Boolean),
    dept: c.dept,
  });
}

export async function POST(req: NextRequest) {
  const c = cfg();
  if (!c.secret || !c.token || !c.officeId) {
    return Response.json({ error: 'LINE ยังไม่ได้ตั้งค่า (LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN / LINE_OFFICE_ID)' }, { status: 503 });
  }

  // ตรวจลายเซ็นจาก raw body - แปลงเป็น JSON ก่อนจะตรวจไม่ผ่าน
  const raw = await req.text();
  const sig = req.headers.get('x-line-signature') ?? '';
  const expect = createHmac('sha256', c.secret).update(raw).digest('base64');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = ((JSON.parse(raw) as { events?: LineEvent[] }).events ?? []);
  } catch {
    return Response.json({ error: 'bad body' }, { status: 400 });
  }

  for (const ev of events) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.message.text?.trim()) continue;
    const question = ev.message.text.trim();
    const to = ev.source?.userId ?? ev.source?.groupId ?? ev.source?.roomId;

    // ตอบรับก่อน - LLM อาจใช้เวลาเป็นนาที replyToken รอไม่ไหว คำตอบจริงจะ push ตามไป
    if (ev.replyToken) {
      await lineApi('reply', {
        replyToken: ev.replyToken,
        messages: [{ type: 'text', text: 'รับเรื่องแล้วค่ะ กำลังหาข้อมูลให้ สักครู่นะคะ' }],
      }, c.token);
    }
    if (!to) continue;

    // ไม่ await - ตอบ LINE ให้เร็ว แล้วค่อยทำงานต่อ (บนเซิร์ฟเวอร์ Node ธรรมดา promise นี้รันต่อจนจบ)
    void (async () => {
      try {
        // ลูกค้าได้เฉพาะ customerReply (PR ตอบเอง หรือกรองจากผลปรึกษาทีม) - บทถกภายในไม่ออกทาง LINE
        const r = await runHeadless({
          officeId: c.officeId, question, deptIds: [c.dept], audience: 'customer',
          source: 'line', askedByLabel: `ลูกค้าทาง LINE (${ev.source?.type ?? 'user'})`,
        });
        const answer = r.customerReply || 'ขออภัยค่ะ ตอนนี้ยังตอบไม่ได้ เดี๋ยวทีมงานติดต่อกลับนะคะ';
        await lineApi('push', { to, messages: chunks(answer).map((t) => ({ type: 'text', text: t })) }, c.token);
      } catch (e) {
        console.error('[line] answer failed:', e);
        await lineApi('push', { to, messages: [{ type: 'text', text: 'ขออภัยค่ะ ระบบขัดข้อง เดี๋ยวทีมงานติดต่อกลับนะคะ' }] }, c.token);
      }
    })();
  }

  return Response.json({ ok: true });
}
