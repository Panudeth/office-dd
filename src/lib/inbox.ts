import 'server-only';
import { deliverReport, type DeliveryResult } from '@/lib/channels';
import { chunkText, embedModelFor, embedTexts } from '@/lib/embed';
import { loadOfficeStaff, runHeadless } from '@/lib/headless';
import { resolveCreds } from '@/lib/llm';
import { loadOfficeDepartments } from '@/lib/office-depts';
import { loadOfficeLlm } from '@/lib/office-llm';
import type { MeetingMode } from '@/lib/protocol';
import { sbAdmin } from '@/lib/supabase-admin';

/* ============================================================
   Inbox ของแผนก - ระบบข้างนอก (logger, บิล GCP, cron, n8n ...) ยิง webhook เข้ามาหาแผนก
   flow: รับ -> เก็บแถว office_inbox -> (task) หัวหน้าแผนกอ่าน playbook + data แล้วรายงาน -> Outbox ไป channel ของแผนก
   payload เป็น "ข้อมูล" เสมอ ไม่ใช่คำสั่ง (ห่อใน headless.inbox ให้ agent อ่านเป็นเอกสาร)
   ============================================================ */

export const MAX_INBOX_TEXT = 60_000;

export interface InboxInput {
  officeId: string;
  deptId: string;
  title: string;
  source: string;
  intent: 'note' | 'task';
  ask: string;
  mode: MeetingMode;
  data: unknown;
  dataText: string;
  idemKey: string | null;
  /** false = ไม่ส่งออกช่องทางใด / string[] = เฉพาะชนิด/ id / label ที่ระบุ / undefined = ทุก channel ของแผนก */
  deliver: false | string[] | undefined;
  origin: string;
}

export interface InboxRow {
  id: string;
  status: 'received' | 'running' | 'done' | 'error';
  meeting_id: string | null;
  answer: string;
  delivered: DeliveryResult[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** แปลง data อะไรก็ได้เป็นข้อความให้ agent อ่าน - JSON จัดบรรทัด, สตริงใช้ตรง ๆ */
export function dataToText(data: unknown, text?: string): string {
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, MAX_INBOX_TEXT);
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data.trim().slice(0, MAX_INBOX_TEXT);
  try { return JSON.stringify(data, null, 2).slice(0, MAX_INBOX_TEXT); } catch { return String(data).slice(0, MAX_INBOX_TEXT); }
}

/** แถวเดิมที่ idempotency key เดียวกัน - ยิงซ้ำ (retry ของฝั่งส่ง) จะไม่เปิดงานซ้ำ */
export async function findByIdem(officeId: string, deptId: string, idemKey: string): Promise<InboxRow | null> {
  const c = sbAdmin();
  if (!c) return null;
  const { data } = await c.from('office_inbox').select('id,status,meeting_id,answer,delivered,error,created_at,finished_at')
    .eq('office_id', officeId).eq('dept_id', deptId).eq('idem_key', idemKey).maybeSingle();
  return (data as InboxRow | null) ?? null;
}

export async function getInbox(officeId: string, id: string): Promise<InboxRow | null> {
  const c = sbAdmin();
  if (!c) return null;
  const { data } = await c.from('office_inbox').select('id,status,meeting_id,answer,delivered,error,created_at,finished_at')
    .eq('office_id', officeId).eq('id', id).maybeSingle();
  return (data as InboxRow | null) ?? null;
}

/** เปิดแถว inbox (status received) - คืน id */
export async function createInbox(input: InboxInput): Promise<string> {
  const c = sbAdmin();
  if (!c) throw new Error('เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY');
  const { data, error } = await c.from('office_inbox').insert({
    office_id: input.officeId, dept_id: input.deptId, source: input.source, title: input.title,
    intent: input.intent, ask: input.ask, data: input.data ?? null, data_text: input.dataText,
    idem_key: input.idemKey, status: 'received',
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * เก็บของที่เข้ามาเป็นเอกสารของแผนก (office_doc + chunk ที่ฝัง vector) - เดือนหน้าถาม "เทียบเดือนก่อน" ได้
 * ทำแบบ best-effort: ไม่มีคีย์ทำ embedding / ตารางไม่พร้อม = ข้าม ไม่ให้ inbox ล้ม
 */
async function ingestAsDoc(input: InboxInput, inboxId: string): Promise<void> {
  const c = sbAdmin();
  if (!c || !input.dataText.trim()) return;
  const office = await loadOfficeLlm(input.officeId);
  const creds = office.creds ?? resolveCreds({});
  if (!creds) return;
  const name = `[inbox] ${input.title || input.source || 'ข้อมูลเข้า'} · ${new Date().toISOString().slice(0, 10)}`;
  const body = `${input.title}\n${input.source ? `ที่มา: ${input.source}\n` : ''}\n${input.dataText}`;
  const pieces = chunkText(body).slice(0, 120);
  const { data: doc, error } = await c.from('office_doc').insert({
    office_id: input.officeId, name, dept_ids: [input.deptId], bytes: Buffer.byteLength(body, 'utf8'),
    chunk_count: pieces.length, status: 'processing', visibility: 'internal',
  }).select('id').single();
  if (error || !doc) return;
  const docId = (doc as { id: string }).id;
  try {
    const vectors: number[][] = [];
    for (let i = 0; i < pieces.length; i += 64) vectors.push(...(await embedTexts(pieces.slice(i, i + 64), creds)).vectors);
    const model = embedModelFor(creds);
    const rows = pieces.map((content, seq) => ({ doc_id: docId, office_id: input.officeId, seq, content, embedding: vectors[seq], embed_model: model }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error: e2 } = await c.from('office_doc_chunk').insert(rows.slice(i, i + 50));
      if (e2) throw new Error(e2.message);
    }
    await c.from('office_doc').update({ status: 'ready' }).eq('id', docId);
  } catch (e) {
    await c.from('office_doc').update({ status: 'error', error: `inbox ${inboxId}: ${e instanceof Error ? e.message : String(e)}` }).eq('id', docId);
  }
}

/**
 * ทำงานจริง (เรียกหลังตอบ 202 แล้ว หรือรอผลถ้าผู้เรียกขอ wait)
 *   note = เก็บเป็นเอกสาร จบ
 *   task = เก็บเอกสาร + หัวหน้าแผนกอ่าน playbook/data แล้วรายงาน + ส่งออก channel
 */
export async function processInbox(input: InboxInput, inboxId: string): Promise<InboxRow | null> {
  const c = sbAdmin();
  if (!c) return null;
  const mark = (patch: Record<string, unknown>) => c.from('office_inbox').update(patch).eq('id', inboxId);
  await mark({ status: 'running' });
  // เก็บเป็นเอกสารคู่ขนานไปเลย - ไม่ต้องรอ (พังก็ไม่กระทบรายงาน)
  const ingest = ingestAsDoc(input, inboxId).catch(() => undefined);

  if (input.intent === 'note') {
    await ingest;
    await mark({ status: 'done', finished_at: new Date().toISOString() });
    return getInbox(input.officeId, inboxId);
  }

  const depts = await loadOfficeDepartments(input.officeId);
  const dept = depts.byId.get(input.deptId);
  const deptName = dept?.nameTh ?? input.deptId;
  // แผนกต้องมีคนถึงจะรายงานได้ - ไม่งั้น runHeadless จะถอยไปให้เลขาฯ เลือกแผนกอื่น ซึ่งไม่ใช่ที่ผู้ส่งตั้งใจ
  const staff = await loadOfficeStaff(input.officeId);
  if (!staff.some((s) => s.dept_id === input.deptId)) {
    await ingest;
    await mark({ status: 'error', error: `${deptName} ยังไม่มีพนักงาน - จ้างอย่างน้อย 1 คนก่อน (ข้อมูลถูกเก็บเป็นเอกสารของแผนกแล้ว)`, finished_at: new Date().toISOString() });
    return getInbox(input.officeId, inboxId);
  }
  const question = input.ask.trim()
    || `มีข้อมูลใหม่ส่งเข้ามาถึง${deptName}${input.title ? ` เรื่อง "${input.title}"` : ''}${input.source ? ` (จาก ${input.source})` : ''} ` +
       'อ่านข้อมูลนี้ตาม playbook ของแผนก แล้วสรุปให้ผู้บริหาร: เกิดอะไรขึ้น สำคัญแค่ไหน ต้องทำอะไรต่อ ใครควรถูกแจ้ง';

  const result = await runHeadless({
    officeId: input.officeId, question, deptIds: [input.deptId], mode: input.mode, source: 'api',
    askedByLabel: input.source ? `${input.source} (inbox)` : 'inbox',
    inbox: { title: input.title, source: input.source, dataText: input.dataText },
  });

  let delivered: DeliveryResult[] = [];
  const answer = result.answer || result.customerReply || '';
  if (answer && input.deliver !== false) {
    delivered = await deliverReport({
      officeId: input.officeId, deptId: input.deptId, deptName, title: input.title || 'รายงานจากแผนก',
      text: answer, meetingId: result.meetingId, inboxId, source: input.source,
      link: input.origin ? `${input.origin}/` : undefined,
    }, Array.isArray(input.deliver) ? input.deliver : undefined);
  }
  await ingest;
  await mark({
    status: result.error && !answer ? 'error' : 'done', meeting_id: result.meetingId, answer, delivered,
    error: result.error, finished_at: new Date().toISOString(),
  });
  return getInbox(input.officeId, inboxId);
}
