import { NextRequest, after } from 'next/server';
import { DEPT_ID_RE } from '@/lib/departments';
import { createInbox, dataToText, findByIdem, getInbox, processInbox, type InboxInput } from '@/lib/inbox';
import { loadOfficeDepartments } from '@/lib/office-depts';
import { officeFromToken } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* ============================================================
   Webhook เข้าแผนก
     POST /api/office/inbox/<deptId>
     Authorization: Bearer <office token>  (scope inbox ที่ผูกแผนกนี้ หรือ internal)
     body (ทุกช่องไม่บังคับ):
       { title, source, intent: 'note'|'task', ask, mode: 'direct'|'roundtable'|'relay', lang: 'th'|'en',
         data: <อะไรก็ได้>, text, deliver: false | ['teams', ...], idempotencyKey, wait: <วินาที> }
     ถ้า body ไม่มีคีย์พวกนี้เลย ถือว่า body ทั้งก้อนคือ data (ระบบข้างนอกยิงตรง ๆ ได้ ไม่ต้องห่อ)
     ตอบ 202 { inboxId, status:'running' } ทันที (งานเดินต่อฝั่งเซิร์ฟเวอร์) - ใส่ wait=N จะรอไม่เกิน N วิ แล้วคืนผลถ้าเสร็จ
     GET  /api/office/inbox/<deptId>?id=<inboxId>   ดูสถานะ/คำตอบ
   ============================================================ */

const WRAPPER_KEYS = ['title', 'source', 'intent', 'ask', 'mode', 'lang', 'data', 'text', 'deliver', 'idempotencyKey', 'wait'];

async function auth(req: NextRequest, deptId: string) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const t = await officeFromToken(bearer);
  if (!t) return { error: 'token ไม่ถูกต้อง', status: 401 } as const;
  if (t.scope === 'public') return { error: 'token ลูกค้าใช้กับ inbox ไม่ได้', status: 403 } as const;
  if (t.scope === 'inbox' && !t.deptIds.includes(deptId)) return { error: `token นี้ไม่ได้ผูกกับแผนก ${deptId}`, status: 403 } as const;
  return { officeId: t.officeId, tokenName: t.name } as const;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ deptId: string }> }) {
  const { deptId } = await ctx.params;
  const a = await auth(req, deptId);
  if ('error' in a) return Response.json({ error: a.error }, { status: a.status });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return Response.json({ ok: true, deptId, hint: 'POST ข้อมูลเข้ามาที่ URL นี้ หรือใส่ ?id=<inboxId> เพื่อดูสถานะ' });
  const row = await getInbox(a.officeId, id);
  if (!row) return Response.json({ error: 'ไม่พบ' }, { status: 404 });
  return Response.json(row);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ deptId: string }> }) {
  const { deptId: rawDept } = await ctx.params;
  const deptId = rawDept.toLowerCase();
  if (!DEPT_ID_RE.test(deptId)) return Response.json({ error: 'deptId ไม่ถูกต้อง' }, { status: 400 });
  const a = await auth(req, deptId);
  if ('error' in a) return Response.json({ error: a.error }, { status: a.status });

  const depts = await loadOfficeDepartments(a.officeId);
  if (!depts.byId.has(deptId)) return Response.json({ error: `ไม่มีแผนก ${deptId} ในออฟฟิศนี้` }, { status: 404 });

  let raw: unknown;
  const ctype = req.headers.get('content-type') ?? '';
  try {
    if (ctype.includes('application/json')) raw = await req.json();
    else {
      const t = await req.text();
      try { raw = JSON.parse(t); } catch { raw = { text: t }; }
    }
  } catch {
    return Response.json({ error: 'อ่าน body ไม่ได้' }, { status: 400 });
  }

  // ห่อหรือไม่ห่อ: มีคีย์ของเราอย่างน้อยหนึ่ง = ห่อ, ไม่มีเลย = body ทั้งก้อนคือ data
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const wrapped = !!obj && WRAPPER_KEYS.some((k) => k in obj);
  const b = wrapped ? obj! : {};
  const data = wrapped ? b.data : raw;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  // แหล่งข้อมูล: body.source > header X-Source > ชื่อ token (ตั้งตอนสร้าง เช่น "gcp-billing") > user-agent
  const source = str(b.source, 120) || str(req.headers.get('x-source'), 120) || str(a.tokenName, 120) || str(req.headers.get('user-agent'), 60);
  const intent = b.intent === 'note' ? 'note' : 'task';
  const mode = b.mode === 'roundtable' ? 'roundtable' : b.mode === 'relay' ? 'relay' : 'direct';
  const dataText = dataToText(data, typeof b.text === 'string' ? b.text : undefined);
  const idemKey = str(b.idempotencyKey, 200) || str(req.headers.get('idempotency-key'), 200) || null;
  const deliver: InboxInput['deliver'] = b.deliver === false ? false
    : Array.isArray(b.deliver) ? b.deliver.filter((x): x is string => typeof x === 'string').slice(0, 20) : undefined;
  const wait = Math.min(280, Math.max(0, Number(b.wait ?? req.nextUrl.searchParams.get('wait') ?? 0) || 0));

  if (!dataText && !str(b.ask, 1)) return Response.json({ error: 'ไม่มีข้อมูล (data/text) และไม่มีคำถาม (ask)' }, { status: 400 });

  if (idemKey) {
    const dup = await findByIdem(a.officeId, deptId, idemKey);
    if (dup) return Response.json({ ...dup, inboxId: dup.id, duplicate: true }, { status: 200 });
  }

  const input: InboxInput = {
    officeId: a.officeId, deptId, title: str(b.title, 200), source, intent, ask: str(b.ask, 4000), mode, lang: b.lang === 'en' ? 'en' : 'th',
    data: data ?? null, dataText, idemKey, deliver, origin: req.nextUrl.origin,
  };
  let inboxId: string;
  try {
    inboxId = await createInbox(input);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const job = processInbox(input, inboxId).catch((e) => { console.error('[inbox]', e); return null; });
  if (wait > 0) {
    const done = await Promise.race([job, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), wait * 1000))]);
    if (done !== 'timeout' && done) return Response.json({ inboxId, ...done });
  }
  // ตอบก่อน งานเดินต่อ - after() กัน runtime ปิดก่อนงานเสร็จบน serverless
  after(async () => { await job; });
  return Response.json({ inboxId, status: 'running', poll: `${req.nextUrl.pathname}?id=${inboxId}` }, { status: 202 });
}
