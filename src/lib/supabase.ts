'use client';

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Palette } from '@/game/types';
import type { Product } from '@/lib/company';

/* ============================================================
   เฟส 1 ใช้ client ฝั่งเบราว์เซอร์อย่างเดียว - ไม่มี SSR auth ไม่มี middleware
   ความปลอดภัยอยู่ที่ RLS ใน Postgres ไม่ใช่ที่โค้ดฝั่งนี้
   ถ้าไม่ได้ตั้งค่า env แอปจะรันโหมด local เหมือนเดิมทุกอย่าง
   ============================================================ */

/**
 * Supabase เปลี่ยนชื่อคีย์ฝั่ง client จาก anon key (JWT) เป็น publishable key
 * (sb_publishable_...) รับทั้งสองชื่อ ใครมีอันไหนก็ใช้ได้
 * ทั้งคู่ปลอดภัยที่จะให้เบราว์เซอร์เห็น เพราะ RLS ยังบังคับอยู่
 *
 * NEXT_PUBLIC_* ถูก inline ตอน build - อ้างชื่อเต็มตรง ๆ เท่านั้น
 * เขียนเป็น process.env[ตัวแปร] จะได้ undefined
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const supabaseConfigured = Boolean(url && anonKey);

/** กันเผลอเอา secret key มาใส่ช่องที่เบราว์เซอร์เห็นได้ */
export const usingSecretKeyByMistake = anonKey.startsWith('sb_secret_');

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // ขากลับจาก Google จะพ่วง code มากับ URL ตัวนี้คือคนเก็บไปแลกเป็น session
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

export type { User };

export interface Office {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface EmployeeRow {
  id: string;
  office_id: string;
  name: string;
  title: string;
  dept_id: string;
  role: string;
  palette: Palette;
  seat: { x: number; y: number };
}

/**
 * ดึงข้อความจริงออกมาจาก error ได้ทุกทรง
 *
 * PostgrestError ที่ supabase-js คืนมาเป็น object ธรรมดา { message, details, hint, code }
 * ไม่ใช่ instance ของ Error - เผลอ String() ใส่จะได้ "[object Object]" แล้วสาเหตุจริง
 * หายไปทั้งก้อน ต่อท้ายด้วย code ไว้ด้วยเพราะเวลาไล่ปัญหา 42501 กับ 42P01 บอกอะไรได้เยอะ
 */
function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const text = [o.message, o.details, o.hint]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .join(' - ');
    const code = typeof o.code === 'string' && o.code ? ` [${o.code}]` : '';
    if (text) return text + code;
  }
  return String(err);
}

/** แปลง error ของ Supabase เป็นข้อความที่บอกได้ว่าต้องทำอะไรต่อ */
export function sbError(err: unknown): string {
  const raw = rawMessage(err);
  const low = raw.toLowerCase();
  if (low.includes('invalid login credentials'))
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (low.includes('user already registered'))
    return 'อีเมลนี้สมัครไว้แล้ว - กดเข้าสู่ระบบแทน';
  if (low.includes('email not confirmed'))
    return 'ยังไม่ได้ยืนยันอีเมล - เช็คกล่องจดหมาย หรือปิด "Confirm email" ใน Supabase -> Authentication -> Providers';
  if (low.includes('password should be at least'))
    return 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)';
  if (low.includes('email address') && low.includes('invalid'))
    return 'Supabase ไม่รับอีเมลนี้ - โดเมนทดสอบอย่าง example.com ถูกบล็อก ใช้อีเมลจริงที่รับเมลได้';
  // PostgREST ตอบได้สองทรง: 42P01 จาก Postgres ตรง ๆ กับ PGRST205 ที่ตอบจาก schema cache
  if ((low.includes('relation') && low.includes('does not exist')) || low.includes('schema cache'))
    return 'ยังไม่ได้สร้างตาราง - เอา supabase/schema.sql ไปรันใน SQL Editor ก่อน';
  if (low.includes('row-level security') || low.includes('violates row-level'))
    return 'RLS ปฏิเสธคำสั่งนี้ - ตรวจว่ารัน schema.sql ครบแล้วและล็อกอินอยู่';
  if (low.includes('unsupported provider') || low.includes('provider is not enabled'))
    return 'ยังไม่ได้เปิด Google ใน Supabase - ไปที่ Authentication แล้วเปิด Google ใน Sign In / Providers พร้อมใส่ Client ID และ Secret';
  if (low.includes('redirect') && (low.includes('not allowed') || low.includes('invalid')))
    return 'URL ขากลับไม่อยู่ในรายการที่อนุญาต - เอา URL ของหน้านี้ไปใส่ใน Supabase ที่ Authentication แล้วดู URL Configuration ช่อง Redirect URLs';
  if (low.includes('failed to fetch'))
    return 'ต่อ Supabase ไม่ได้ - ตรวจ NEXT_PUBLIC_SUPABASE_URL';
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
}

/**
 * เข้าสู่ระบบด้วย Google
 * เป็นการ redirect ออกจากหน้านี้ทั้งหน้า ฟังก์ชันนี้จึงไม่คืนค่าอะไรถ้าสำเร็จ
 * ขากลับ supabase-js จะเห็น code ใน URL แล้วแลกเป็น session ให้เอง
 * (เปิด detectSessionInUrl ไว้แล้วด้านบน) จากนั้น onAuthStateChange ใน page.tsx รับช่วงต่อ
 */
export async function signInWithGoogle(): Promise<void> {
  const c = sb();
  if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // กลับมาที่หน้าเดิมเสมอ ใช้ origin จริงของเบราว์เซอร์
      // เพราะพอร์ต dev เปลี่ยนบ่อย ถ้า hardcode ไว้จะเด้งผิดที่
      redirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(sbError(error));
}

/**
 * อ่านผลขากลับจาก Google ออกจาก URL
 *
 * ต้องเรียก "ก่อน" sb() ครั้งแรกเสมอ เพราะ detectSessionInUrl จะลบ code ออกจาก URL
 * ทันทีที่แลก session สำเร็จ
 *
 * มีไว้เพราะ OAuth ที่ล้มเหลวจะเงียบสนิท: supabase-js เขียน error ลง console แล้วยิง
 * INITIAL_SESSION เป็น null เหมือนกรณี "ไม่เคยล็อกอิน" เป๊ะ ๆ ผู้ใช้จึงเห็นแค่ปุ่ม
 * เข้าสู่ระบบค้างอยู่ โดยไม่มีอะไรบอกว่าเพิ่งพยายามล็อกอินไปแล้วและพังตรงไหน
 */
export interface OAuthReturn {
  /** เพิ่งกลับมาจากหน้า Google จริงไหม (มี code หรือ error ติดมากับ URL) */
  returning: boolean;
  /** ข้อความที่ Supabase หรือ Google ส่งกลับมา ถ้าปฏิเสธคำขอ */
  error: string | null;
  /** origin ที่ถูกเด้งกลับมาจริง - ตัวนี้แหละที่ต้องอยู่ใน Redirect URLs */
  origin: string;
}

export function readOAuthReturn(): OAuthReturn {
  if (typeof window === 'undefined') return { returning: false, error: null, origin: '' };
  const q = new URLSearchParams(window.location.search);
  // flow แบบ implicit ส่งกลับมาทาง hash ส่วน pkce ส่งทาง query - อ่านทั้งคู่กันพลาด
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const pick = (k: string) => q.get(k) ?? h.get(k);
  const error = pick('error_description') ?? pick('error');
  return {
    returning: Boolean(error || pick('code') || pick('access_token')),
    error,
    origin: window.location.origin,
  };
}

/**
 * ออกจากระบบ - ลืมออฟฟิศที่จำไว้ด้วย ไม่งั้นคนถัดไปที่เข้าจากเครื่องนี้
 * จะเห็นออฟฟิศของคนก่อนค้างอยู่ในปุ่ม (เปิดจริงไม่ได้อยู่แล้วเพราะ RLS แต่สับสน)
 */
export async function signOut(): Promise<void> {
  rememberOffice(null);
  const c = sb();
  if (!c) return;
  const { error } = await c.auth.signOut();
  if (error) throw new Error(sbError(error));
}

/* ---------- จำออฟฟิศที่เลือกไว้ ---------- */

/**
 * การเข้าด้วย Google คือการออกจากหน้านี้ไปทั้งหน้าแล้วโหลดกลับมาใหม่
 * state ใน React หายเกลี้ยง ถ้าไม่จำ id ไว้ ผู้ใช้จะกลับมาเจอออฟฟิศว่าง
 * แล้วจ้างพนักงานทิ้งไปโดยไม่ถูกบันทึก - เก็บแค่ id ตัวข้อมูลจริงยังกัน RLS อยู่
 */
const OFFICE_KEY = 'visual-company.office';

export function rememberOffice(id: string | null): void {
  try {
    if (id) localStorage.setItem(OFFICE_KEY, id);
    else localStorage.removeItem(OFFICE_KEY);
  } catch {
    // โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ - แค่จำไม่ได้ ไม่ถึงกับใช้งานไม่ได้
  }
}

export function rememberedOfficeId(): string | null {
  try {
    return localStorage.getItem(OFFICE_KEY);
  } catch {
    return null;
  }
}

/* ---------- ข้อมูลบัญชีที่เอาไว้โชว์ ---------- */

/** เข้าด้วย Google จะมีชื่อกับรูปติดมาใน user_metadata ใช้อีเมลเป็นตัวสำรอง */
export function accountName(u: User): string {
  const m = u.user_metadata ?? {};
  const full = typeof m.full_name === 'string' ? m.full_name : '';
  const name = typeof m.name === 'string' ? m.name : '';
  return full || name || u.email || 'บัญชีของฉัน';
}

export function accountAvatar(u: User): string | null {
  const m = u.user_metadata ?? {};
  const url = typeof m.avatar_url === 'string' ? m.avatar_url : m.picture;
  return typeof url === 'string' && url ? url : null;
}

/**
 * ตรวจว่าต่อ Supabase ได้และรัน schema.sql แล้วหรือยัง
 * ยิง select ที่ไม่ต้องล็อกอิน - RLS จะคืน 0 แถวถ้าตารางมีจริง
 * แยกให้ออกว่า "config ผิด" / "ยังไม่ได้สร้างตาราง" / "พร้อมใช้"
 */
export async function healthCheck(): Promise<{ ok: boolean; text: string }> {
  const c = sb();
  if (!c) return { ok: false, text: 'ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY' };
  if (usingSecretKeyByMistake) return { ok: false, text: 'คีย์ที่ใส่เป็น secret key - ต้องใช้ publishable key' };

  const { error } = await c.from('office').select('id', { head: true, count: 'exact' });
  if (!error) return { ok: true, text: 'ต่อ Supabase ได้ และตารางครบแล้ว' };

  const msg = String(error.message ?? '').toLowerCase();
  if (msg.includes('does not exist') || msg.includes('schema cache') || error.code === '42P01') {
    return { ok: false, text: 'ต่อได้ แต่ยังไม่มีตาราง - เอา supabase/schema.sql ไปรันใน SQL Editor ก่อน' };
  }
  return { ok: false, text: sbError(error) };
}

/* ---------- ออฟฟิศ ---------- */

export async function listOffices(): Promise<Office[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c
    .from('office')
    .select('id,name,owner_id,created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(sbError(error));
  return (data ?? []) as Office[];
}

export async function createOffice(name: string, userId: string): Promise<Office> {
  const c = sb();
  if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
  const { data, error } = await c
    .from('office')
    .insert({ name, owner_id: userId })
    .select('id,name,owner_id,created_at')
    .single();
  if (error) throw new Error(sbError(error));
  return data as Office;
}

/* ---------- พนักงาน ---------- */

export async function loadEmployees(officeId: string): Promise<EmployeeRow[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c
    .from('employee')
    .select('id,office_id,name,title,dept_id,role,palette,seat')
    .eq('office_id', officeId)
    .order('hired_at', { ascending: true });
  if (error) throw new Error(sbError(error));
  return (data ?? []) as EmployeeRow[];
}

export async function saveEmployee(row: EmployeeRow): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.from('employee').insert(row);
  if (error) throw new Error(sbError(error));
}

/* ---------- บันทึกการประชุม (เลขานุการ) ---------- */

/** สำเนาผู้เข้าประชุม - เก็บไว้ในบันทึกเพราะคนอาจถูกเลิกจ้างไปแล้ว */
export interface MeetingAttendee {
  id: string;
  name: string;
  title: string;
  deptId: string;
  palette: Palette;
}

export interface MeetingRow {
  id: string;
  office_id: string;
  asked_by: string | null;
  /** ชื่อผู้ถามจากช่องทางภายนอก เช่น "สมชาย (LINE)" */
  asked_by_label?: string | null;
  question: string;
  mode: 'roundtable' | 'relay' | 'direct';
  owner_dept: string;
  dept_ids: string[];
  attendees: MeetingAttendee[];
  summary: string;
  /** รายงานการประชุมโดยเลขาฯ - ว่างได้ถ้าปิดการจด หรือบันทึกเก่าก่อนมีฟีเจอร์นี้ */
  minutes?: string;
  /** internal | customer - ใครถาม */
  audience?: string;
  /** คำตอบที่ PR กรองให้ลูกค้า (audience = customer) */
  customer_reply?: string;
  source?: string;
  status?: string;
  transcript: unknown[];
  consults: unknown[];
  created_at: string;
}

/**
 * อ่านทุกคอลัมน์ (*) แทนการระบุชื่อ - ฐานที่ยังไม่ได้รัน schema รอบใหม่จะไม่มี minutes
 * ระบุชื่อไปจะพังทั้งสมุด ทั้งที่บันทึกเก่าอ่านได้ปกติ
 */
const MEETING_COLS = '*';

export async function saveMeeting(
  row: Omit<MeetingRow, 'id' | 'created_at'>,
): Promise<MeetingRow | null> {
  const c = sb();
  if (!c) return null;
  // ไม่มีรายงานเลขาฯ ก็ไม่ส่งคอลัมน์ minutes ไป - ฐานเก่าที่ยังไม่มีคอลัมน์จะได้ยังบันทึกได้
  const { minutes, ...rest } = row;
  const payload = minutes ? row : rest;
  const { data, error } = await c.from('meeting').insert(payload).select(MEETING_COLS).single();
  if (error) throw new Error(sbError(error));
  return data as MeetingRow;
}

/** access token ของ session ปัจจุบัน - แนบไปให้เซิร์ฟเวอร์ยืนยันว่าเราเป็นสมาชิกออฟฟิศ (ตอนบันทึกการประชุมฝั่ง server) */
export async function accessToken(): Promise<string | null> {
  const c = sb();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.access_token ?? null;
}

/** เลขาฯ เขียนรายงานเสร็จทีหลังคำตอบ - เติมลงแถวที่บันทึกไปแล้ว */
export async function updateMeetingMinutes(id: string, minutes: string): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.from('meeting').update({ minutes }).eq('id', id);
  if (error) throw new Error(sbError(error));
}

export async function listMeetings(officeId: string, limit = 100): Promise<MeetingRow[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c
    .from('meeting')
    .select(MEETING_COLS)
    .eq('office_id', officeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(sbError(error));
  return (data ?? []) as MeetingRow[];
}

export async function deleteMeeting(id: string): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.from('meeting').delete().eq('id', id);
  if (error) throw new Error(sbError(error));
}

/* ---------- ข้อมูลบริษัท: โปรไฟล์ + โน้ตแผนก ---------- */

export interface ProfileRow {
  office_id: string;
  fields: Record<string, string>;
  updated_at: string;
}

export async function loadProfile(officeId: string): Promise<Record<string, string>> {
  const c = sb();
  if (!c) return {};
  const { data, error } = await c
    .from('office_profile')
    .select('fields')
    .eq('office_id', officeId)
    .maybeSingle();
  if (error) throw new Error(sbError(error));
  return ((data as { fields?: Record<string, string> } | null)?.fields ?? {}) as Record<string, string>;
}

export async function saveProfile(
  officeId: string, fields: Record<string, string>, userId: string | null,
): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c
    .from('office_profile')
    .upsert({ office_id: officeId, fields, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(sbError(error));
}

export async function loadDeptNotes(officeId: string): Promise<Record<string, string>> {
  const c = sb();
  if (!c) return {};
  const { data, error } = await c
    .from('office_dept_note')
    .select('dept_id,body')
    .eq('office_id', officeId);
  if (error) throw new Error(sbError(error));
  return Object.fromEntries(((data ?? []) as { dept_id: string; body: string }[]).map((r) => [r.dept_id, r.body]));
}

export async function saveDeptNote(
  officeId: string, deptId: string, body: string, userId: string | null,
): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c
    .from('office_dept_note')
    .upsert({ office_id: officeId, dept_id: deptId, body, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(sbError(error));
}

/* ---------- รายการสินค้า/บริการ ---------- */

export async function listProducts(officeId: string): Promise<Product[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c
    .from('office_product')
    .select('id,name,description,price,note')
    .eq('office_id', officeId)
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: true });
  if (error) throw new Error(sbError(error));
  return (data ?? []) as Product[];
}

/**
 * บันทึกทั้งรายการในครั้งเดียว - upsert แถวที่มี แล้วลบแถวที่หายไปจากหน้าจอ
 * ลำดับบนหน้าจอคือ sort_order เลย ไม่ต้องให้ผู้ใช้กรอกเอง
 */
export async function saveProducts(
  officeId: string, products: Product[], userId: string | null,
): Promise<void> {
  const c = sb();
  if (!c) return;
  const now = new Date().toISOString();
  const rows = products.map((p, i) => ({
    id: p.id, office_id: officeId,
    name: p.name.trim(), description: p.description.trim(), price: p.price.trim(), note: p.note.trim(),
    sort_order: i, updated_by: userId, updated_at: now,
  }));
  if (rows.length) {
    const { error } = await c.from('office_product').upsert(rows);
    if (error) throw new Error(sbError(error));
  }
  const keep = rows.map((r) => r.id);
  let del = c.from('office_product').delete().eq('office_id', officeId);
  // PostgREST ไม่รับ not-in ว่าง - ไม่มีอะไรจะเก็บก็ลบทั้งออฟฟิศ
  if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
  const { error } = await del;
  if (error) throw new Error(sbError(error));
}

/** สิทธิ์แก้ข้อมูลบริษัท - เจ้าของหรือ exec เท่านั้น (viewer อ่านอย่างเดียว) */
export async function canEditOffice(officeId: string): Promise<boolean> {
  const c = sb();
  if (!c) return false;
  const { data, error } = await c.rpc('can_edit_office', { oid: officeId });
  if (error) return false;
  return data === true;
}

/* ---------- เอกสารบริษัท (เฟส 3) ---------- */

export interface DocRow {
  id: string;
  office_id: string;
  name: string;
  dept_ids: string[];
  bytes: number;
  chunk_count: number;
  status: 'processing' | 'ready' | 'error';
  error: string | null;
  /** internal (ค่าเริ่มต้น) / public = ลูกค้าถามผ่านช่องทางสาธารณะเห็นได้ - ฐานเก่าอาจไม่มี */
  visibility?: 'internal' | 'public';
  created_at: string;
}

// อ่านทุกคอลัมน์ - ฐานที่ยังไม่ได้รัน schema รอบล่าสุดจะไม่มี visibility ระบุชื่อไปจะพังทั้งรายการ
const DOC_COLS = '*';

export async function listDocs(officeId: string): Promise<DocRow[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c
    .from('office_doc')
    .select(DOC_COLS)
    .eq('office_id', officeId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(sbError(error));
  return (data ?? []) as DocRow[];
}

export async function createDoc(
  row: {
    office_id: string; name: string; dept_ids: string[]; bytes: number; uploaded_by: string | null;
    visibility?: 'internal' | 'public';
  },
): Promise<DocRow> {
  const c = sb();
  if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
  let res = await c.from('office_doc').insert({ ...row, status: 'processing' }).select(DOC_COLS).single();
  // ฐานเก่าไม่มีคอลัมน์ visibility - บันทึกแบบเดิม (ถือเป็นภายใน)
  if (res.error && /visibility/i.test(res.error.message)) {
    const { visibility: _v, ...legacy } = row;
    void _v;
    res = await c.from('office_doc').insert({ ...legacy, status: 'processing' }).select(DOC_COLS).single();
  }
  if (res.error) throw new Error(sbError(res.error));
  return res.data as DocRow;
}

export async function updateDoc(
  id: string, patch: Partial<Pick<DocRow, 'status' | 'error' | 'chunk_count' | 'dept_ids'>>,
): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.from('office_doc').update(patch).eq('id', id);
  if (error) throw new Error(sbError(error));
}

export async function deleteDoc(doc: DocRow): Promise<void> {
  const c = sb();
  if (!c) return;
  // ลบไฟล์ใน Storage ก่อน แถวใน DB ค่อยตาม (chunk ลบเองด้วย cascade)
  await c.storage.from('docs').remove([`${doc.office_id}/${doc.id}/${doc.name}`]);
  const { error } = await c.from('office_doc').delete().eq('id', doc.id);
  if (error) throw new Error(sbError(error));
}

export async function uploadDocFile(officeId: string, docId: string, file: File): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.storage
    .from('docs')
    .upload(`${officeId}/${docId}/${file.name}`, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(sbError(error));
}

export interface ChunkInsert {
  doc_id: string;
  office_id: string;
  seq: number;
  content: string;
  embedding: number[];
  embed_model: string;
}

export async function insertChunks(rows: ChunkInsert[]): Promise<void> {
  const c = sb();
  if (!c || !rows.length) return;
  // แบ่งก้อนละ 50 กัน payload ใหญ่เกิน
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await c.from('office_doc_chunk').insert(rows.slice(i, i + 50));
    if (error) throw new Error(sbError(error));
  }
}

export interface MatchedChunk {
  chunk_id: number;
  doc_id: string;
  doc_name: string;
  seq: number;
  content: string;
  similarity: number;
}

/** ค้นชิ้นเอกสารที่ใกล้คำถาม - RPC ที่ RLS ยังบังคับอยู่ */
export async function matchChunks(
  officeId: string, embedding: number[], model: string, deptIds: string[] | null, count = 8,
): Promise<MatchedChunk[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c.rpc('match_doc_chunks', {
    oid: officeId, query_embedding: embedding, model, dept_filter: deptIds, match_count: count,
  });
  if (error) throw new Error(sbError(error));
  return (data ?? []) as MatchedChunk[];
}

export async function deleteEmployee(id: string): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.from('employee').delete().eq('id', id);
  if (error) throw new Error(sbError(error));
}
