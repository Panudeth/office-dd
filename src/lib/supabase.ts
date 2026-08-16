'use client';

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Palette } from '@/game/types';

/* ============================================================
   เฟส 1 ใช้ client ฝั่งเบราว์เซอร์อย่างเดียว — ไม่มี SSR auth ไม่มี middleware
   ความปลอดภัยอยู่ที่ RLS ใน Postgres ไม่ใช่ที่โค้ดฝั่งนี้
   ถ้าไม่ได้ตั้งค่า env แอปจะรันโหมด local เหมือนเดิมทุกอย่าง
   ============================================================ */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
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

/** แปลง error ของ Supabase เป็นข้อความที่บอกได้ว่าต้องทำอะไรต่อ */
export function sbError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  if (low.includes('invalid login credentials'))
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (low.includes('user already registered'))
    return 'อีเมลนี้สมัครไว้แล้ว — กดเข้าสู่ระบบแทน';
  if (low.includes('email not confirmed'))
    return 'ยังไม่ได้ยืนยันอีเมล — เช็คกล่องจดหมาย หรือปิด "Confirm email" ใน Supabase → Authentication → Providers';
  if (low.includes('password should be at least'))
    return 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)';
  if (low.includes('relation') && low.includes('does not exist'))
    return 'ยังไม่ได้สร้างตาราง — เอา supabase/schema.sql ไปรันใน SQL Editor ก่อน';
  if (low.includes('row-level security') || low.includes('violates row-level'))
    return 'RLS ปฏิเสธคำสั่งนี้ — ตรวจว่ารัน schema.sql ครบแล้วและล็อกอินอยู่';
  if (low.includes('failed to fetch'))
    return 'ต่อ Supabase ไม่ได้ — ตรวจ NEXT_PUBLIC_SUPABASE_URL';
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
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

export async function deleteEmployee(id: string): Promise<void> {
  const c = sb();
  if (!c) return;
  const { error } = await c.from('employee').delete().eq('id', id);
  if (error) throw new Error(sbError(error));
}
