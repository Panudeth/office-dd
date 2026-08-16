import Anthropic from '@anthropic-ai/sdk';
import type { AskOptions, Creds } from './llm';

export const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

/** cache client ตาม key - ผู้ใช้แต่ละคนอาจเอาคีย์ตัวเองมา (BYOK) */
const clients = new Map<string, Anthropic>();
function getClient(apiKey: string): Anthropic {
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    if (clients.size > 20) clients.clear(); // กันบวมถ้ามีคีย์หลายตัว
    clients.set(apiKey, c);
  }
  return c;
}

export const envClaudeKey = () => process.env.ANTHROPIC_API_KEY ?? '';

export function claudeFriendlyError(err: unknown, model: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  if (low.includes('credit balance'))
    return 'เครดิตในบัญชี Anthropic ไม่พอ - ไปเติมเงินที่ Console -> Billing แล้วถามใหม่ (คีย์ใช้ได้แล้ว ไม่ต้องแก้โค้ด)';
  if (low.includes('authentication') || low.includes('invalid x-api-key') || low.includes('401'))
    return 'ANTHROPIC_API_KEY ไม่ถูกต้องหรือถูกเพิกถอน - ตรวจคีย์แล้วลองใหม่';
  if (low.includes('permission') || low.includes('403'))
    return 'API key นี้ไม่มีสิทธิ์เข้าถึงโมเดลที่เรียก';
  if (low.includes('not_found') || low.includes('404'))
    return `ไม่พบโมเดล "${model}" - ตรวจชื่อโมเดลอีกครั้ง`;
  if (low.includes('rate_limit') || low.includes('429'))
    return 'ถูกจำกัดอัตราการเรียก (rate limit) - รอสักครู่แล้วถามใหม่';
  if (low.includes('overloaded') || low.includes('529'))
    return 'เซิร์ฟเวอร์ Anthropic แน่นอยู่ตอนนี้ - ลองใหม่อีกครั้ง';
  return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
}

/** ดึงรายชื่อโมเดลที่คีย์นี้เรียกได้จริง - ใช้เป็นตัวตรวจคีย์ไปในตัว */
export async function listClaudeModels(creds: Creds): Promise<{ id: string; label: string }[]> {
  const anthropic = getClient(creds.apiKey);
  try {
    const out: { id: string; label: string }[] = [];
    // list() ของ SDK นี้ auto-paginate เมื่อ iterate ตรง ๆ
    for await (const m of anthropic.models.list({ limit: 100 })) {
      out.push({ id: m.id, label: m.display_name ? `${m.id} - ${m.display_name}` : m.id });
      if (out.length >= 120) break;
    }
    return out;
  } catch (err) {
    throw new Error(claudeFriendlyError(err, DEFAULT_CLAUDE_MODEL));
  }
}

/**
 * Claude Opus 5 - thinking เปิดโดยดีฟอลต์ และ max_tokens คุมทั้ง thinking + ข้อความตอบ
 * จึงต้องเผื่อ max_tokens ไว้มากกว่าความยาวคำตอบที่ต้องการจริง
 * เช็ค stop_reason === 'refusal' ก่อนอ่าน content เสมอ
 */
export async function askClaude(opts: AskOptions, creds: Creds): Promise<string> {
  const model = creds.model || DEFAULT_CLAUDE_MODEL;
  const anthropic = getClient(creds.apiKey);

  const base = {
    model,
    max_tokens: opts.maxTokens ?? 6000,
    system: opts.system,
    messages: [{ role: 'user' as const, content: opts.user }],
    output_config: { effort: opts.effort ?? 'low' },
  };

  const call = (params: object) =>
    anthropic.beta.messages.create(
      // `fallbacks` / `output_config` อาจใหม่กว่า typing ของ SDK ที่ติดตั้งอยู่ - cast จุดเดียว
      params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    ) as Promise<Anthropic.Beta.Messages.BetaMessage>;

  let res: Anthropic.Beta.Messages.BetaMessage;
  try {
    try {
      // เปิด server-side fallback: ถ้า classifier ปฏิเสธ จะถูกเสิร์ฟด้วยโมเดลสำรองในคอลเดียวกัน
      res = await call({
        ...base,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // SDK/บัญชีที่ยังไม่รองรับ beta นี้ - ถอย fallback ออกแล้วยิงใหม่ครั้งเดียว
      if (!/fallback|beta/i.test(msg)) throw err;
      res = await call(base);
    }
  } catch (err) {
    throw new Error(claudeFriendlyError(err, model));
  }

  const stopDetails = (res as { stop_details?: { category?: string } | null }).stop_details;
  if (res.stop_reason === 'refusal') {
    const cat = stopDetails?.category ?? 'unspecified';
    return `คำถามนี้ถูกตัวกรองความปลอดภัยปฏิเสธ (หมวด: ${cat}) ลองถามใหม่ในมุมที่แคบลงหรือระบุบริบทงานให้ชัดขึ้น`;
  }

  const text = res.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return text || '(ไม่มีคำตอบกลับมา)';
}
