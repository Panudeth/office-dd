import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { byokCreds, type Creds } from '@/lib/llm';
import type { LlmAssignment } from '@/lib/protocol';
import { sbAdmin } from '@/lib/supabase-admin';

/* ============================================================
   ชุดคีย์/โมเดลของออฟฟิศฝั่งเซิร์ฟเวอร์ (ตาราง office_llm)
   สำเนาของ "คีย์ของฉัน" ในเบราว์เซอร์ - เจ้าของ/exec กดบันทึกในหน้าเว็บ แล้ว sync ขึ้นมา
   เอาไว้ให้ MCP / LINE / API ใช้โมเดลรายคนเหมือนหน้าเว็บ (เดิมเส้นพวกนั้นเห็นแต่ .env)

   คีย์เข้ารหัส AES-256-GCM ก่อนลง DB - กุญแจมาจาก LLM_KEY_SECRET (ถ้าตั้ง) ไม่งั้นถอดจาก
   SUPABASE_SECRET_KEY ซึ่งไม่ได้อยู่ใน DB อยู่แล้ว: dump ฐานหลุดก็ยังอ่านคีย์ไม่ออก
   ============================================================ */

/** รูปเดียวกับ LlmStore ในเบราว์เซอร์ (KeyPanel) - ประกาศซ้ำเพราะไฟล์นั้นเป็น client component */
export interface StoredConn {
  id: string;
  label: string;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}
export interface StoredLlm {
  active: string | null;
  items: StoredConn[];
  roles?: { chair?: string; member?: string; secretary?: string };
  byEmployee?: Record<string, string>;
}

const ENC_PREFIX = 'enc:v1:';

function masterKey(): Buffer | null {
  const secret = process.env.LLM_KEY_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret) return null;
  return createHash('sha256').update(`visual-company.office_llm|${secret}`).digest();
}

function encrypt(plain: string): string {
  const key = masterKey();
  if (!key || !plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = masterKey();
  if (!key) return '';
  const [iv, tag, ct] = stored.slice(ENC_PREFIX.length).split(':');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    // secret เปลี่ยน (ย้ายโปรเจกต์ Supabase / ตั้ง LLM_KEY_SECRET ใหม่) - คีย์เก่าถอดไม่ได้ ต้องบันทึกใหม่จากหน้าเว็บ
    return '';
  }
}

/** ทำความสะอาดของที่ client ส่งมา - เอาเฉพาะฟิลด์ที่รู้จัก กันยัด jsonb มั่ว */
export function sanitizeStore(input: unknown): StoredLlm {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const items: StoredConn[] = (Array.isArray(p.items) ? p.items : [])
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : null))
    .filter((c): c is Record<string, unknown> => !!c && typeof c.id === 'string' && typeof c.provider === 'string')
    .map((c) => ({
      id: c.id as string,
      label: typeof c.label === 'string' ? c.label : '',
      provider: c.provider as string,
      apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
      model: typeof c.model === 'string' ? c.model : '',
      ...(typeof c.baseUrl === 'string' && c.baseUrl ? { baseUrl: c.baseUrl } : {}),
    }));
  const ids = new Set(items.map((c) => c.id));
  const ref = (v: unknown, allowOff = false): string | undefined =>
    typeof v === 'string' && (ids.has(v) || (allowOff && v === 'off')) ? v : undefined;
  const r = (p.roles && typeof p.roles === 'object' ? p.roles : {}) as Record<string, unknown>;
  const roles = { chair: ref(r.chair), member: ref(r.member), secretary: ref(r.secretary, true) };
  const byEmployee = Object.fromEntries(
    Object.entries((p.byEmployee && typeof p.byEmployee === 'object' ? p.byEmployee : {}) as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && ids.has(v)),
  ) as Record<string, string>;
  return { active: ref(p.active) ?? null, items, roles, byEmployee };
}

/** บันทึก (upsert) - เข้ารหัสคีย์ก่อน; items ว่าง = ลบทิ้ง (กลับไปใช้ .env) */
export async function saveOfficeLlm(officeId: string, store: StoredLlm, userId: string | null): Promise<void> {
  const c = sbAdmin();
  if (!c) throw new Error('เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY');
  if (!store.items.length) {
    const { error } = await c.from('office_llm').delete().eq('office_id', officeId);
    if (error) throw new Error(error.message);
    return;
  }
  const data: StoredLlm = { ...store, items: store.items.map((i) => ({ ...i, apiKey: encrypt(i.apiKey) })) };
  const { error } = await c
    .from('office_llm')
    .upsert({ office_id: officeId, data, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** สรุปสำหรับโชว์ในหน้าเว็บ - ไม่มีคีย์ */
export async function describeOfficeLlm(officeId: string): Promise<{
  configured: boolean; updatedAt: string | null; connections: { id: string; label: string; provider: string; model: string; hasKey: boolean }[];
}> {
  const c = sbAdmin();
  if (!c) return { configured: false, updatedAt: null, connections: [] };
  const { data } = await c.from('office_llm').select('data,updated_at').eq('office_id', officeId).maybeSingle();
  if (!data) return { configured: false, updatedAt: null, connections: [] };
  const s = sanitizeStore((data as { data: unknown }).data);
  return {
    configured: s.items.length > 0,
    updatedAt: (data as { updated_at: string }).updated_at,
    connections: s.items.map((i) => ({ id: i.id, label: i.label, provider: i.provider, model: i.model, hasKey: !!i.apiKey })),
  };
}

/**
 * ประกอบ creds/assignment สำหรับ headless (MCP/LINE/API) - ตรรกะเดียวกับ llmAssignment() ในเบราว์เซอร์
 *   creds  = ชุดที่ active (ค่าเริ่มต้นเวลาไม่มีใครถูกตั้งเจาะจง) - null ถ้าไม่มี/ใช้ไม่ได้ -> ผู้เรียกถอยไป .env
 *   assign = ใครใช้ชุดไหน (chair/member/secretary/byAgent) - undefined ถ้าไม่ได้ตั้งอะไรเลย
 */
export async function loadOfficeLlm(officeId: string): Promise<{ creds: Creds | null; assign: LlmAssignment | undefined }> {
  const none = { creds: null, assign: undefined };
  const c = sbAdmin();
  if (!c) return none;
  const { data, error } = await c.from('office_llm').select('data').eq('office_id', officeId).maybeSingle();
  if (error) {
    // ตารางยังไม่มี (schema เก่า) - ไม่ใช่เรื่องผิด แค่ยังใช้ .env ต่อไป
    console.warn('[office_llm]', error.message, '- รัน supabase/schema.sql รอบล่าสุดถ้าอยากให้ MCP ใช้โมเดลรายคน');
    return none;
  }
  if (!data) return none;
  const s = sanitizeStore((data as { data: unknown }).data);
  const conns = new Map<string, Creds>();
  for (const i of s.items) {
    const cr = byokCreds({ provider: i.provider, apiKey: decrypt(i.apiKey), model: i.model || null, baseUrl: i.baseUrl ?? null });
    if (cr) conns.set(i.id, cr);
  }
  const wire = (id?: string) => {
    const cr = id ? conns.get(id) : undefined;
    if (!cr) return undefined;
    return { id, w: { provider: cr.provider, apiKey: cr.apiKey || undefined, model: cr.model, baseUrl: cr.baseUrl } };
  };
  const assign: LlmAssignment = { conns: {} };
  const use = (id?: string) => {
    const r = wire(id);
    if (!r) return undefined;
    assign.conns[r.id!] = r.w;
    return r.id;
  };
  assign.chair = use(s.roles?.chair);
  assign.member = use(s.roles?.member);
  assign.secretary = s.roles?.secretary === 'off' ? 'off' : use(s.roles?.secretary);
  assign.byAgent = {};
  for (const [emp, connId] of Object.entries(s.byEmployee ?? {})) {
    const r = use(connId);
    if (r) assign.byAgent[emp] = r;
  }
  const hasAny = assign.chair || assign.member || assign.secretary || Object.keys(assign.byAgent).length;
  return { creds: (s.active ? conns.get(s.active) : undefined) ?? null, assign: hasAny ? assign : undefined };
}
