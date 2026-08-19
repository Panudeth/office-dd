/**
 * ภาษาที่ agent ใช้ตอบ (คนละเรื่องกับภาษา UI ใน src/lib/i18n.ts แต่เบราว์เซอร์ส่งค่าเดียวกันมา)
 * prompt หลักยังเป็นไทย (โมเดลอ่านไทยได้ดีพอ) - แค่เติมคำสั่ง "เขียนเป็นอังกฤษ" ต่อท้าย system prompt เมื่อเลือก en
 * ไม่ส่งมา = ไทย ตามพฤติกรรมเดิม
 */
export type ReplyLang = 'th' | 'en';

export function normLang(v: unknown): ReplyLang {
  return v === 'en' ? 'en' : 'th';
}

/** บล็อกต่อท้าย system prompt - ว่างเมื่อเป็นไทย */
export function langNote(lang?: ReplyLang | null): string {
  if (lang !== 'en') return '';
  return `\n\n## Language\n\nWrite everything you say in English — your reasoning, your answer, and any summary. Keep people's names, product names, and quoted source text as they are. If the question is in another language, still answer in English.`;
}

/** ใส่ภาษาลง company context (สร้าง context เปล่าให้ถ้ายังไม่มี) - ใช้ตอนรับจาก body ของ API */
export function withLang<T extends { lang?: ReplyLang }>(company: T | undefined | null, lang: unknown): T | undefined {
  const l = normLang(lang);
  if (company) return l === 'en' ? { ...company, lang: l } : company;
  if (l === 'en') return { profile: {}, notes: {}, lang: l } as unknown as T;
  return undefined;
}
