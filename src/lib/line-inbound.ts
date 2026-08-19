import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deliverReport, type DeliveryResult } from '@/lib/channels';
import { loadOfficeStaff, runHeadless } from '@/lib/headless';
import { loadOfficeDepartments } from '@/lib/office-depts';
import { decrypt, encrypt } from '@/lib/office-llm';
import { cleanLabel } from '@/lib/ratelimit';
import { sbAdmin } from '@/lib/supabase-admin';

/* ============================================================
   ขาเข้าแบบ LINE Official Account - ลูกค้าทัก LINE -> แผนกรับลูกค้าตอบ (customer flow)
   ตั้งค่าได้จากหน้าเว็บต่อแผนก (ตาราง office_dept_inbound, secret/token เข้ารหัสแบบเดียวกับคีย์ LLM)
   webhook ต่อ OA:  POST /api/line/webhook/<inboundId>
   ของเดิมที่ตั้งใน .env (/api/line/webhook) ยังใช้ได้ - เรียก handler ตัวเดียวกัน
   ============================================================ */

export interface LineInboundCfg {
  officeId: string;
  deptId: string;
  channelSecret: string;
  accessToken: string;
  /** ข้อความตอบรับทันที (LLM ช้า replyToken รอไม่ไหว) */
  ack?: string;
  /** ชื่อ OA - ใช้เป็น "แหล่ง" ตอนส่งบทสนทนาต่อไปช่องส่งออกของแผนก */
  label?: string;
  /** origin ของเซิร์ฟเวอร์ (ลิงก์กลับ/รูปหน้า) */
  origin?: string;
}

export interface InboundRow {
  id: string;
  dept_id: string;
  kind: 'line';
  label: string;
  /** config เข้ารหัส: { secret, token, ack? } */
  config: Record<string, string>;
  enabled: boolean;
  created_at: string;
}

const DEFAULT_ACK = 'รับเรื่องแล้วค่ะ กำลังหาข้อมูลให้ สักครู่นะคะ';

/* ---------- ที่เก็บ ---------- */

export async function listInbound(officeId: string, deptId?: string): Promise<InboundRow[]> {
  const c = sbAdmin();
  if (!c) return [];
  let q = c.from('office_dept_inbound').select('id,dept_id,kind,label,config,enabled,created_at').eq('office_id', officeId).order('created_at');
  if (deptId) q = q.eq('dept_id', deptId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as InboundRow[];
}

/** สำหรับหน้าเว็บ - ไม่ส่ง secret กลับ บอกแค่ว่ามี/ไม่มี */
export function maskInbound(r: InboundRow) {
  return {
    id: r.id, dept_id: r.dept_id, kind: r.kind, label: r.label, enabled: r.enabled, created_at: r.created_at,
    hasSecret: !!r.config.secret, hasToken: !!r.config.token, ack: r.config.ack ?? '',
  };
}

export async function upsertInbound(officeId: string, input: {
  id?: string; deptId: string; label: string; secret?: string; token?: string; ack?: string; enabled?: boolean;
}): Promise<InboundRow> {
  const c = sbAdmin();
  if (!c) throw new Error('เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY');
  // แก้แถวเดิม: ช่องที่ไม่ส่งมา (ว่าง) = คงค่าเดิม (หน้าเว็บไม่เห็น secret จึงส่งกลับมาไม่ได้)
  let prev: Record<string, string> = {};
  if (input.id) {
    const { data } = await c.from('office_dept_inbound').select('config').eq('office_id', officeId).eq('id', input.id).maybeSingle();
    prev = ((data as { config?: Record<string, string> } | null)?.config) ?? {};
  }
  const config: Record<string, string> = {
    secret: input.secret?.trim() ? encrypt(input.secret.trim()) : (prev.secret ?? ''),
    token: input.token?.trim() ? encrypt(input.token.trim()) : (prev.token ?? ''),
    ...(input.ack !== undefined ? (input.ack.trim() ? { ack: input.ack.trim().slice(0, 300) } : {}) : (prev.ack ? { ack: prev.ack } : {})),
  };
  const row = {
    ...(input.id ? { id: input.id } : {}), office_id: officeId, dept_id: input.deptId, kind: 'line', label: input.label.trim().slice(0, 80) || 'LINE OA',
    config, enabled: input.enabled ?? true, updated_at: new Date().toISOString(),
  };
  const { data, error } = await c.from('office_dept_inbound').upsert(row).select('id,dept_id,kind,label,config,enabled,created_at').single();
  if (error) throw new Error(error.message);
  return data as InboundRow;
}

export async function deleteInbound(officeId: string, id: string): Promise<void> {
  const c = sbAdmin();
  if (!c) return;
  await c.from('office_dept_inbound').delete().eq('office_id', officeId).eq('id', id);
}

/** config ที่ถอดรหัสแล้วของ inbound หนึ่งแถว - null ถ้าไม่มี/ปิด/ถอดไม่ได้ */
export async function loadLineInbound(id: string): Promise<LineInboundCfg | null> {
  const c = sbAdmin();
  if (!c || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await c.from('office_dept_inbound').select('office_id,dept_id,kind,label,config,enabled').eq('id', id).maybeSingle();
  const r = data as { office_id: string; dept_id: string; kind: string; label: string; config: Record<string, string>; enabled: boolean } | null;
  if (!r || r.kind !== 'line' || !r.enabled) return null;
  const channelSecret = decrypt(r.config.secret ?? ''), accessToken = decrypt(r.config.token ?? '');
  if (!channelSecret || !accessToken) return null;
  return { officeId: r.office_id, deptId: r.dept_id, channelSecret, accessToken, ack: r.config.ack || undefined, label: r.label || 'LINE' };
}

/** access token ของ LINE OA ที่ผูกกับแผนก (ให้ช่องส่งออกแบบ line ใช้เมื่อไม่ได้กรอก token เอง) */
export async function lineTokenForDept(officeId: string, deptId: string): Promise<string> {
  const rows = await listInbound(officeId, deptId);
  for (const r of rows) {
    if (!r.enabled) continue;
    const t = decrypt(r.config.token ?? '');
    if (t) return t;
  }
  return '';
}

/* ---------- ตัวจัดการ webhook (ใช้ร่วมกันทั้งแบบ DB และ .env) ---------- */

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string; groupId?: string; roomId?: string };
  message?: { type: string; text?: string };
}

export async function lineApi(path: string, body: unknown, token: string): Promise<void> {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('[line]', path, res.status, await res.text().catch(() => ''));
}

interface LineProfile { name: string; pictureUrl?: string }
const profileCache = new Map<string, { p: LineProfile; at: number }>();
/** ชื่อ + รูปโปรไฟล์ของคนทัก (LINE ให้ pictureUrl เป็น https สาธารณะ เอาไปแปะการ์ดได้ตรง ๆ) - จำ 10 นาทีต่อ userId */
async function lineProfile(src: LineEvent['source'], token: string): Promise<LineProfile | null> {
  const uid = src?.userId;
  if (!uid) return null;
  const hit = profileCache.get(uid);
  if (hit && Date.now() - hit.at < 600_000) return hit.p;
  const path = src?.type === 'group' && src.groupId ? `group/${src.groupId}/member/${uid}`
    : src?.type === 'room' && src.roomId ? `room/${src.roomId}/member/${uid}`
    : `profile/${uid}`;
  try {
    const res = await fetch(`https://api.line.me/v2/bot/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { displayName?: string; pictureUrl?: string };
    const name = cleanLabel(j.displayName, 40);
    if (!name) return null;
    const p: LineProfile = { name, ...(j.pictureUrl && /^https:\/\//.test(j.pictureUrl) ? { pictureUrl: j.pictureUrl } : {}) };
    profileCache.set(uid, { p, at: Date.now() });
    return p;
  } catch { return null; }
}

/** LINE ตัดข้อความที่ 5000 ตัวอักษร - แบ่งเป็นหลายฟองถ้ายาว (สูงสุด 5 ฟองต่อครั้ง) */
export const lineChunks = (s: string, n = 4500) => {
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length && out.length < 5) { out.push(rest.slice(0, n)); rest = rest.slice(n); }
  return out.length ? out : ['(ไม่มีคำตอบ)'];
};

export function verifyLineSignature(raw: string, sig: string, secret: string): boolean {
  const expect = createHmac('sha256', secret).update(raw).digest('base64');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** จดแชท LINE ลง office_inbox (intent chat) - คืน id หรือ null ถ้าตารางไม่พร้อม */
async function logChat(cfg: LineInboundCfg, o: { source: string; question: string; userId: string; srcType: string }): Promise<string | null> {
  const c = sbAdmin();
  if (!c) return null;
  const { data } = await c.from('office_inbox').insert({
    office_id: cfg.officeId, dept_id: cfg.deptId, source: o.source, title: 'ลูกค้าถามทาง LINE', intent: 'chat', ask: o.question,
    data: { channel: 'line', userId: o.userId, sourceType: o.srcType }, data_text: o.question, status: 'running',
  }).select('id').single();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * รับ webhook จาก LINE - ตอบรับทันที แล้วให้แผนกตอบ (customer flow) และ push คำตอบตาม
 * คืนงานเบื้องหลังเป็น promise ให้ route เอาไปใส่ after() (บน serverless งานต้องไม่ถูกตัดตอนตอบกลับ)
 */
export function handleLineEvents(raw: string, cfg: LineInboundCfg): { ok: true; work: Promise<void> } | { ok: false; status: number; error: string } {
  let events: LineEvent[] = [];
  try {
    events = ((JSON.parse(raw) as { events?: LineEvent[] }).events ?? []);
  } catch {
    return { ok: false, status: 400, error: 'bad body' };
  }
  const jobs: Promise<void>[] = [];
  for (const ev of events) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.message.text?.trim()) continue;
    const question = ev.message.text.trim().slice(0, 4000);
    const to = ev.source?.userId ?? ev.source?.groupId ?? ev.source?.roomId;
    jobs.push((async () => {
      // ตอบรับก่อน - LLM อาจใช้เวลาเป็นนาที replyToken รอไม่ไหว คำตอบจริงจะ push ตามไป
      if (ev.replyToken) {
        await lineApi('reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text: cfg.ack || DEFAULT_ACK }] }, cfg.accessToken);
      }
      if (!to) return;
      const source = cfg.label || 'LINE';
      // จดเป็นรายการใน "ที่เข้ามาล่าสุด" ของแผนก (office_inbox) - เห็นคำถาม/คำตอบ/ผลส่งออกจากหน้าเว็บ ไม่ต้องดู log
      const inboxId = await logChat(cfg, { source, question, userId: ev.source?.userId ?? '', srcType: ev.source?.type ?? '' });
      const mark = async (patch: Record<string, unknown>) => { const c = sbAdmin(); if (c && inboxId) await c.from('office_inbox').update(patch).eq('id', inboxId); };
      try {
        const prof = await lineProfile(ev.source, cfg.accessToken);
        const name = prof?.name ?? null;
        if (name) await mark({ title: `ลูกค้าถามทาง LINE - ${name}`, data: { channel: 'line', userId: ev.source?.userId ?? '', sourceType: ev.source?.type ?? '', customer: prof } });
        // ลูกค้าได้เฉพาะ customerReply (แผนกรับลูกค้าตอบเอง หรือกรองจากผลปรึกษาทีม) - บทถกภายในไม่ออกทาง LINE
        const r = await runHeadless({
          officeId: cfg.officeId, question, deptIds: [cfg.deptId], audience: 'customer',
          source: 'line', askedByLabel: name ? `${name} (LINE)` : 'ลูกค้า (LINE)', rateKey: `line:${ev.source?.userId ?? to}`,
        });
        const answer = r.customerReply || 'ขออภัยค่ะ ตอนนี้ยังตอบไม่ได้ เดี๋ยวทีมงานติดต่อกลับนะคะ';
        await lineApi('push', { to, messages: lineChunks(answer).map((t) => ({ type: 'text', text: t })) }, cfg.accessToken);
        // ส่งบทสนทนาต่อไปช่องส่งออกของแผนก (แหล่ง = ชื่อ OA) - ทีมข้างในเห็นว่าลูกค้าถามอะไร ตอบไปว่าอะไร
        let delivered: DeliveryResult[] = [];
        let deliverErr: string | null = null;
        try {
          const [depts, staff] = await Promise.all([loadOfficeDepartments(cfg.officeId), loadOfficeStaff(cfg.officeId)]);
          const chair = r.chair ? staff.find((s) => s.id === r.chair!.id) : undefined;
          delivered = await deliverReport({
            officeId: cfg.officeId, deptId: cfg.deptId, deptName: depts.byId.get(cfg.deptId)?.nameTh ?? cfg.deptId,
            title: `ลูกค้าถามทาง LINE${name ? ` - ${name}` : ''}`,
            text: `**คำถาม:** ${question}\n\n**ตอบลูกค้า:** ${answer}${r.escalated ? '\n\n_(เรื่องนี้ต้องปรึกษาทีมก่อนตอบ - บทถกอยู่ในสมุดเลขาฯ)_' : ''}${r.error ? `\n\n_ข้อผิดพลาด: ${r.error}_` : ''}`,
            meetingId: r.meetingId, inboxId, source,
            link: cfg.origin ? `${cfg.origin}/` : undefined,
            ...(chair ? { reporter: { name: chair.name, title: chair.title, palette: chair.palette } } : {}),
            customer: { name: name ?? 'ลูกค้า', ...(prof?.pictureUrl ? { pictureUrl: prof.pictureUrl } : {}), channel: 'LINE' },
            question, answer,
          });
        } catch (e) { deliverErr = e instanceof Error ? e.message : String(e); console.error('[line] deliver failed:', e); }
        await mark({
          status: r.error && !r.customerReply ? 'error' : 'done', meeting_id: r.meetingId, answer, delivered,
          error: [r.error, deliverErr ? `ส่งออกไม่ได้: ${deliverErr}` : null].filter(Boolean).join(' · ') || null,
          finished_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error('[line] answer failed:', e);
        await mark({ status: 'error', error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() });
        await lineApi('push', { to, messages: [{ type: 'text', text: 'ขออภัยค่ะ ระบบขัดข้อง เดี๋ยวทีมงานติดต่อกลับนะคะ' }] }, cfg.accessToken);
      }
    })());
  }
  return { ok: true, work: Promise.all(jobs).then(() => undefined) };
}
