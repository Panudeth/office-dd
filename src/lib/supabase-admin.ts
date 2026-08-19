import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* ============================================================
   Supabase ฝั่งเซิร์ฟเวอร์ - ใช้ secret key ข้าม RLS ได้ทั้งหมด
   จึงต้องอยู่ในไฟล์ server-only และทุกจุดที่เรียกต้องตรวจสิทธิ์เองก่อน
   (ผู้ใช้เป็นสมาชิกออฟฟิศไหม / token ของออฟฟิศถูกไหม)

   ไม่ตั้งค่าก็รันได้ - แอปจะทำงานแบบเดิม (เบราว์เซอร์บันทึกเอง ไม่มี headless)
   ============================================================ */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
// รับทั้งชื่อใหม่ (sb_secret_...) และชื่อเก่า (service_role JWT)
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const adminConfigured = Boolean(url && secret);

let client: SupabaseClient | null = null;
/** client สิทธิ์เต็ม - null ถ้าไม่ได้ตั้งค่า */
export function sbAdmin(): SupabaseClient | null {
  if (!adminConfigured) return null;
  if (!client) {
    client = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** แปลง access token ของผู้ใช้ (จากเบราว์เซอร์) เป็น user id - null ถ้าไม่ผ่าน */
export async function userIdFromToken(token: string | null | undefined): Promise<string | null> {
  const c = sbAdmin();
  if (!c || !token) return null;
  const { data, error } = await c.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/** ผู้ใช้คนนี้เป็นสมาชิกออฟฟิศไหม - ตรวจตรง ๆ เพราะ admin client ไม่ผ่าน RLS */
export async function isMember(officeId: string, userId: string): Promise<boolean> {
  const c = sbAdmin();
  if (!c) return false;
  const { data } = await c
    .from('office_member')
    .select('user_id')
    .eq('office_id', officeId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

/** hash ของ token ออฟฟิศ - เก็บเฉพาะ hash, เทียบด้วย hash */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type TokenScope = 'internal' | 'public' | 'inbox';

/**
 * ตรวจ token ออฟฟิศ (Bearer จาก MCP/API/LINE) - คืน office id + scope ถ้าถูก
 *   internal = agent ของเราเอง: ถามทุกแผนก ประชุม อ่านสมุดได้
 *   public   = ช่องทางลูกค้า: ถามแผนกรับลูกค้าได้อย่างเดียว ไม่เห็นสมุด/บทถก
 */
export async function officeFromToken(
  token: string | null | undefined,
): Promise<{ officeId: string; scope: TokenScope; deptIds: string[] } | null> {
  const c = sbAdmin();
  if (!c || !token) return null;
  const hash = await sha256(token.trim());
  // ฐานที่ยังไม่ได้รัน schema รอบล่าสุดอาจไม่มีคอลัมน์ dept_ids (หรือ scope) - ถอยทีละขั้น
  // ห้ามข้าม scope ถ้าคอลัมน์มีอยู่ ไม่งั้น token ลูกค้าจะกลายเป็น internal
  let { data, error } = await c
    .from('office_token')
    .select('id, office_id, scope, dept_ids')
    .eq('token_hash', hash)
    .maybeSingle();
  if (!data && error && /dept_ids/i.test(error.message)) {
    const r = await c.from('office_token').select('id, office_id, scope').eq('token_hash', hash).maybeSingle();
    data = r.data as typeof data; error = r.error;
  }
  if (!data && error && /scope/i.test(error.message)) {
    const legacy = await c.from('office_token').select('id, office_id').eq('token_hash', hash).maybeSingle();
    data = legacy.data as typeof data;
    error = legacy.error ?? error;
  }
  // ตารางไม่มี / secret key ผิด / โปรเจกต์ผิด - จะได้ไม่เงียบเป็น 401 เฉย ๆ จนหาไม่เจอว่าเพราะอะไร
  if (!data && error) console.warn('[office_token] Supabase error:', error.message, '- รัน supabase/schema.sql แล้วหรือยัง / SUPABASE_SECRET_KEY ตรงโปรเจกต์ไหม');
  if (!data) return null;
  // จดว่าใช้ล่าสุดเมื่อไร - ไม่รอผล พังก็ไม่เป็นไร
  void c.from('office_token').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  const sc = (data as { scope?: string }).scope;
  const scope: TokenScope = sc === 'public' ? 'public' : sc === 'inbox' ? 'inbox' : 'internal';
  const rawDepts = (data as { dept_ids?: unknown }).dept_ids;
  const deptIds = Array.isArray(rawDepts) ? rawDepts.filter((d): d is string => typeof d === 'string') : [];
  return { officeId: data.office_id as string, scope, deptIds };
}

/** เฉพาะ office id - ใช้ที่ที่ไม่สนใจ scope */
export async function officeIdFromToken(token: string | null | undefined): Promise<string | null> {
  return (await officeFromToken(token))?.officeId ?? null;
}
