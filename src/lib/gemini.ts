import { GoogleGenAI } from '@google/genai';
import type { AskOptions, Creds } from './llm';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.7-flash';

/**
 * ใช้ ai.models.generateContent() เป็นหลัก ไม่ใช่ ai.interactions.create()
 * เพราะ interactions เป็น API ตัวใหม่ที่รองรับเฉพาะโมเดลรุ่นใหม่ —
 * เลือก gemini-2.5-* จาก dropdown แล้วจะโดน 404 ทั้งที่โมเดลมีอยู่จริง
 * generateContent รองรับข้ามรุ่นได้กว้างกว่า
 *
 * typing ของ SDK แต่ละเวอร์ชันไม่เหมือนกัน เลยประกาศเฉพาะส่วนที่ใช้จริง
 * แล้ว cast ตรงจุดเดียว — จะได้ไม่พังตอน typecheck ถ้าเวอร์ชันขยับ
 */
interface GenAiApi {
  models: {
    generateContent(params: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string }>;
    list(params?: { config?: { queryBase?: boolean; pageSize?: number } }): Promise<
      AsyncIterable<{
        name?: string;
        displayName?: string;
        supportedActions?: string[];
      }>
    >;
  };
}

/** โมเดลที่ไม่ได้ใช้ตอบข้อความ — ไม่ต้องเอามาโชว์ให้เลือก */
const NON_TEXT = /embedding|veo-|imagen|-tts|-live|computer-use|deep-research/i;

/** thinking_level เป็นของรุ่น 3 ขึ้นไป — รุ่น 2.5 ใช้ thinkingBudget คนละแบบ */
const supportsThinkingLevel = (id: string) => /gemini-([3-9]|\d{2,})/.test(id);

/** cache client ตาม key — ผู้ใช้แต่ละคนอาจเอาคีย์ตัวเองมา (BYOK) */
const clients = new Map<string, GoogleGenAI>();

export const hasGeminiKey = () =>
  Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY);

function getClient(apiKey: string): GenAiApi {
  let c = clients.get(apiKey);
  if (!c) {
    c = new GoogleGenAI({ apiKey });
    if (clients.size > 20) clients.clear();
    clients.set(apiKey, c);
  }
  return c as unknown as GenAiApi;
}

export function geminiFriendlyError(err: unknown, model = GEMINI_MODEL): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  // SDK ของ Google บางทีคืน message เป็น JSON เปล่า ๆ เหลือแต่รหัสสถานะนำหน้า
  // เลยต้องดูทั้งรหัสจาก object และเลขที่ขึ้นต้น message
  const statusFrom = (e: unknown): number => {
    const o = e as { status?: unknown; code?: unknown } | null;
    for (const v of [o?.status, o?.code]) if (typeof v === 'number') return v;
    return Number(/^\s*(\d{3})\b/.exec(raw)?.[1] ?? 0);
  };
  const status = statusFrom(err);

  if (low.includes('api key not valid') || low.includes('api_key_invalid') || status === 401)
    return 'คีย์ Gemini ไม่ถูกต้อง — เอาคีย์ใหม่จาก Google AI Studio มาใส่แล้วลองอีกครั้ง';
  if (low.includes('quota') || low.includes('resource_exhausted') || status === 429)
    return 'ใช้โควตา Gemini เกินแล้ว (free tier มีลิมิตต่อนาที/ต่อวัน) — รอสักครู่แล้วถามใหม่';
  if (low.includes('permission') || status === 403)
    return 'คีย์ Gemini นี้ไม่มีสิทธิ์เรียกโมเดลที่ตั้งไว้';
  if (low.includes('not found') || status === 404)
    return `คีย์นี้เรียกโมเดล "${model}" ไม่ได้ — เปิดแผง 🔑 แล้วกด "ตรวจคีย์ + โหลดรายชื่อโมเดล" เพื่อเลือกจากรายชื่อที่ใช้ได้จริง`;
  if (low.includes('safety') || low.includes('blocked'))
    return 'คำถามนี้ถูกตัวกรองความปลอดภัยของ Gemini บล็อก — ลองถามใหม่ในมุมที่แคบลง';
  if (status === 400)
    return `Gemini ตีคำขอกลับ (400) — มักเป็นเพราะคีย์ไม่ถูกต้อง หรือชื่อโมเดล "${model}" ใช้ไม่ได้กับคีย์นี้`;
  if (status >= 500)
    return 'เซิร์ฟเวอร์ Gemini มีปัญหาชั่วคราว — ลองใหม่อีกครั้ง';
  return raw.length > 260 ? `${raw.slice(0, 260)}…` : raw;
}

/** ดึงรายชื่อโมเดลที่คีย์นี้เรียกได้จริง — ใช้เป็นตัวตรวจคีย์ไปในตัว */
export async function listGeminiModels(creds: Creds): Promise<{ id: string; label: string }[]> {
  const ai = getClient(creds.apiKey);
  try {
    const pager = await ai.models.list({ config: { queryBase: true, pageSize: 100 } });
    const out: { id: string; label: string }[] = [];
    for await (const m of pager) {
      const id = (m.name ?? '').replace(/^models\//, '');
      if (!id || NON_TEXT.test(id)) continue;
      // โชว์เฉพาะโมเดลที่เรียกด้วย generateContent ได้จริง
      // ไม่งั้น dropdown จะเสนอโมเดลที่พอเลือกแล้วยิงไม่ได้ (ตรงนี้เคยพลาดมาแล้ว)
      const actions = m.supportedActions;
      if (actions?.length && !actions.includes('generateContent')) continue;
      out.push({ id, label: m.displayName ? `${id} — ${m.displayName}` : id });
      if (out.length >= 120) break;
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    throw new Error(geminiFriendlyError(err));
  }
}

/** effort ของเราแมปตรงกับ thinking_level ของ Gemini พอดี */
function thinkingLevel(effort: AskOptions['effort']): string {
  if (effort === 'high') return 'high';
  if (effort === 'medium') return 'medium';
  return 'low';
}

export async function askGemini(opts: AskOptions, creds: Creds): Promise<string> {
  const model = creds.model || GEMINI_MODEL;
  const ai = getClient(creds.apiKey);

  const maxOut = opts.maxTokens ?? 6000;

  const baseConfig: Record<string, unknown> = {
    systemInstruction: opts.system,
    maxOutputTokens: maxOut,
  };
  const withThinking = supportsThinkingLevel(model)
    ? { ...baseConfig, thinkingConfig: { thinkingLevel: thinkingLevel(opts.effort) } }
    : baseConfig;

  try {
    let res;
    try {
      res = await ai.models.generateContent({
        model,
        contents: opts.user,
        config: withThinking,
      });
    } catch (err) {
      // บางโมเดลไม่รับ thinkingConfig — ถอดออกแล้วยิงใหม่ครั้งเดียว
      const msg = err instanceof Error ? err.message : String(err);
      if (withThinking === baseConfig || !/thinking/i.test(msg)) throw err;
      res = await ai.models.generateContent({
        model,
        contents: opts.user,
        config: baseConfig,
      });
    }

    const text = (res.text ?? '').trim();
    return text || '(ไม่มีคำตอบกลับมา)';
  } catch (err) {
    throw new Error(geminiFriendlyError(err, model));
  }
}
