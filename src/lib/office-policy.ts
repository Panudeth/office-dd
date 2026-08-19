import 'server-only';
import { isLocalCreds, type Creds } from '@/lib/llm';
import type { LlmAssignment } from '@/lib/protocol';
import { sbAdmin } from '@/lib/supabase-admin';

/* ============================================================
   นโยบายโมเดลของออฟฟิศ - 'any' = ใช้ผู้ให้บริการไหนก็ได้ / 'local' = เฉพาะโมเดลในเครื่อง/LAN (Ollama, LM Studio)
   บังคับฝั่งเซิร์ฟเวอร์ทุกจุดที่จะส่งข้อมูลบริษัทไปหาโมเดล (/api/ask, agenda, embed, draft, headless, inbox)
   ไม่ใช่แค่ซ่อนปุ่มในหน้าเว็บ - ต่อให้เบราว์เซอร์ส่งคีย์ Claude มา เซิร์ฟเวอร์ก็ปฏิเสธ
   ============================================================ */

export type LlmPolicy = 'any' | 'local';

const cache = new Map<string, { policy: LlmPolicy; at: number }>();

export async function loadOfficePolicy(officeId: string | null | undefined): Promise<LlmPolicy> {
  const c = sbAdmin();
  if (!c || !officeId) return 'any';
  const hit = cache.get(officeId);
  if (hit && Date.now() - hit.at < 20_000) return hit.policy;
  const { data, error } = await c.from('office').select('llm_policy').eq('id', officeId).maybeSingle();
  // ฐานเก่าไม่มีคอลัมน์ = ยังไม่มีนโยบาย
  const policy: LlmPolicy = !error && (data as { llm_policy?: string } | null)?.llm_policy === 'local' ? 'local' : 'any';
  cache.set(officeId, { policy, at: Date.now() });
  return policy;
}

export const LOCAL_ONLY_MSG = 'ออฟฟิศนี้ตั้งนโยบาย "ใช้เฉพาะโมเดลในเครื่อง" - เลือกชุดคีย์ที่ชี้ไป Ollama/LM Studio (localhost หรือ LAN) ในปุ่ม "คีย์ของฉัน" ก่อน';

/**
 * ตรวจชุดคีย์ทั้งหมดที่คำขอนี้จะใช้กับนโยบายของออฟฟิศ - คืนข้อความผิดพลาด หรือ null ถ้าผ่าน
 * ไม่มีคีย์เลย (โหมดสาธิต) ถือว่าผ่าน - ไม่มีอะไรถูกส่งออก
 */
export async function checkOfficePolicy(
  officeId: string | null | undefined, creds: Creds | null, assign?: LlmAssignment,
): Promise<string | null> {
  if (!officeId) return null;
  const policy = await loadOfficePolicy(officeId);
  if (policy !== 'local') return null;
  if (creds && !isLocalCreds(creds)) return LOCAL_ONLY_MSG;
  for (const c of Object.values(assign?.conns ?? {})) {
    if (!isLocalCreds({ provider: c.provider as Creds['provider'], apiKey: c.apiKey ?? '', baseUrl: c.baseUrl, model: c.model, source: 'byok' })) {
      return `${LOCAL_ONLY_MSG} (มีชุดคีย์รายคน/รายบทบาทที่ชี้ไปข้างนอก)`;
    }
  }
  return null;
}
