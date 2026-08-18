'use client';

import type { LlmStore } from '@/components/KeyPanel';
import { accessToken } from '@/lib/supabase';

/* ============================================================
   sync "คีย์ของฉัน" (localStorage) ขึ้นเซิร์ฟเวอร์ต่อออฟฟิศ - ให้ MCP / LINE / API ใช้โมเดลรายคนเหมือนหน้าเว็บ
   เซิร์ฟเวอร์เข้ารหัสคีย์ก่อนลง DB และรับเฉพาะเจ้าของ/exec (คนอื่นได้ 403 - เงียบไว้ ไม่ใช่ error ของเขา)
   ============================================================ */

export interface OfficeLlmStatus {
  configured: boolean;
  updatedAt: string | null;
  connections: { id: string; label: string; provider: string; model: string; hasKey: boolean }[];
}

const hdr = async () => {
  const t = await accessToken();
  return { 'Content-Type': 'application/json', ...(t ? { 'x-sb-token': t } : {}) };
};

/** สรุปสถานะที่บันทึกไว้บนเซิร์ฟเวอร์ (ไม่มีคีย์) - null ถ้าไม่มีสิทธิ์ดู/เซิร์ฟเวอร์ไม่ได้ตั้ง Supabase */
export async function fetchOfficeLlmStatus(officeId: string): Promise<OfficeLlmStatus | null> {
  const res = await fetch(`/api/office/llm?officeId=${officeId}`, { headers: await hdr() });
  if (!res.ok) return null;
  return (await res.json()) as OfficeLlmStatus;
}

/**
 * ส่งทั้ง store ขึ้นไป - คืน status ใหม่ หรือ null ถ้าไม่มีสิทธิ์ (ไม่ใช่เจ้าของ/exec) หรือเซิร์ฟเวอร์ยังไม่พร้อม
 * store ที่ไม่มีชุดคีย์เลยจะไม่ถูกส่ง (กันเบราว์เซอร์เครื่องใหม่ที่ localStorage ว่างไปลบของที่เครื่องอื่นตั้งไว้)
 * อยากลบจริงใช้ clearOfficeLlm
 */
export async function syncOfficeLlm(officeId: string, store: LlmStore): Promise<OfficeLlmStatus | null> {
  if (!store.items.length) return null;
  const res = await fetch('/api/office/llm', { method: 'PUT', headers: await hdr(), body: JSON.stringify({ officeId, store }) });
  if (!res.ok) return null;
  return (await res.json()) as OfficeLlmStatus;
}

export async function clearOfficeLlm(officeId: string): Promise<void> {
  const res = await fetch('/api/office/llm', {
    method: 'PUT', headers: await hdr(), body: JSON.stringify({ officeId, store: { active: null, items: [] } }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
}
