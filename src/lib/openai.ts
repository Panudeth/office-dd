import type { AskOptions, Creds } from './llm';

/* ============================================================
   Adapter สำหรับ API ที่หน้าตาเหมือน OpenAI (/chat/completions + /models)
   ตัวเดียวใช้ได้กับ Groq, OpenRouter, GitHub Models, Cerebras, Together, Ollama
   ต่างกันแค่ base URL จึงไม่ต้องเขียน adapter ใหม่ทุกเจ้า

   ไม่ใช้ SDK ของใครเลย ยิง fetch ตรง ๆ เพราะสัญญาที่ใช้จริงมีแค่สองเส้นทาง
   เพิ่ม dependency มาก็มีแต่จะพามาตรฐานของเจ้าใดเจ้าหนึ่งติดมาด้วย
   ============================================================ */

/** ค่าเริ่มต้นชี้ไป Groq เพราะสมัครฟรีได้ ไม่ต้องผูกบัตร */
export const DEFAULT_OPENAI_BASE =
  process.env.OPENAI_BASE_URL ?? 'https://api.groq.com/openai/v1';

/** ชื่อโมเดลของแต่ละเจ้าไม่เหมือนกันเลย - ถ้าไม่ตรงให้กดโหลดรายชื่อใน UI เอา */
export const DEFAULT_OPENAI_MODEL =
  process.env.OPENAI_MODEL ?? 'llama-3.3-70b-versatile';

/**
 * ค่าเริ่มต้นโมเดล "ตามปลายทาง" - ตัวเดียวใช้ทุกเจ้าไม่ได้ เพราะแต่ละเจ้าตั้งชื่อคนละแบบ
 * ผู้ใช้เลือก Ollama แล้วไม่ระบุโมเดล เดิมระบบยิงชื่อของ Groq ไปที่ Ollama แล้วเจอ 404
 * เดาจาก host: localhost = Ollama (ตั้ง llama3.2 ที่มีในเครื่องส่วนใหญ่) นอกนั้นตามเจ้าที่รู้จัก
 */
export function defaultModelForBase(baseUrl: string | undefined): string {
  const b = (baseUrl ?? DEFAULT_OPENAI_BASE).toLowerCase();
  // ปลายทางในเครื่อง - askOpenAi ไปถาม /models เอาตัวแรกที่มีจริงแทน (ดู resolveLocalModel)
  if (/localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/.test(b)) return '(ตัวแรกที่มีในเครื่อง)';
  if (b.includes('groq.com')) return 'llama-3.3-70b-versatile';
  if (b.includes('cerebras.ai')) return 'llama3.1-8b';
  if (b.includes('openrouter.ai')) return 'meta-llama/llama-3.3-70b-instruct:free';
  if (b.includes('models.github.ai')) return 'openai/gpt-4o-mini';
  if (b.includes('api.openai.com')) return 'gpt-4o-mini';
  return DEFAULT_OPENAI_MODEL;
}

export const envOpenAiKey = () => process.env.OPENAI_API_KEY ?? '';

const trimBase = (u: string) => u.trim().replace(/\/+$/, '');

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** error ของแต่ละเจ้าอยู่คนละที่ - งมให้ครบทีเดียว จะได้ไม่ต้องเดาว่าเจ้าไหนตอบทรงไหน */
function extractMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  const err = o.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
  }
  if (typeof o.message === 'string') return o.message;
  if (typeof o.detail === 'string') return o.detail;
  return '';
}

async function callJson(
  base: string,
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${trimBase(base)}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // ปลายทางที่รันในเครื่องอย่าง Ollama ไม่มีคีย์ให้ใส่ - ส่ง Bearer เปล่าไปบางตัวจะ 401
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    // ต่อไม่ติดเลย = base URL พิมพ์ผิด หรือเน็ตมีปัญหา แยกจากกรณีเซิร์ฟเวอร์ตอบ error
    throw new HttpError(0, err instanceof Error ? err.message : String(err));
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ยิงผิด path บางเจ้าคืนหน้า HTML มา - เก็บดิบไว้ให้เห็นว่ามันไม่ใช่ JSON
  }

  if (!res.ok) throw new HttpError(res.status, extractMessage(data) || text.slice(0, 300));
  return data;
}

export function openAiFriendlyError(
  err: unknown,
  model: string,
  base: string,
  /** 404 ของสองเส้นทางคนละความหมาย - ตอนโหลดรายชื่อแปลว่าปลายทางไม่ใช่ OpenAI API */
  route: 'chat' | 'models' = 'chat',
): string {
  const status = err instanceof HttpError ? err.status : -1;
  const raw = err instanceof Error ? err.message : String(err);

  if (status === 0)
    return `ต่อ ${base} ไม่ได้ - ตรวจว่า base URL ถูกต้องและลงท้ายด้วย /v1 (${raw})`;
  if (status === 401)
    return 'API key ไม่ถูกต้องหรือถูกเพิกถอน - ตรวจว่าคีย์ตรงกับผู้ให้บริการที่เลือกไว้';
  if (status === 402)
    return 'บัญชีนี้ต้องเติมเงินก่อนถึงจะเรียกโมเดลนี้ได้ - ลองเลือกโมเดลที่อยู่ใน free tier แทน';
  if (status === 403)
    return 'คีย์นี้ไม่มีสิทธิ์เรียกโมเดลที่ขอ';
  if (status === 404)
    return route === 'models'
      ? `${base} ไม่มีเส้นทาง /models - ตรวจ base URL อีกที (บางเจ้าไม่เปิดให้ดูรายชื่อ ถ้าแน่ใจว่า URL ถูกก็พิมพ์ชื่อโมเดลเองแล้วถามได้เลย)`
      : `ไม่พบ "${model}" ที่ ${base} - กดปุ่มโหลดรายชื่อโมเดลแล้วเลือกจากรายชื่อ ชื่อโมเดลของแต่ละเจ้าไม่เหมือนกัน`;
  if (status === 429)
    return 'ถูกจำกัดอัตราการเรียก (rate limit) - free tier มักจำกัดต่อนาที ลองลดจำนวนพนักงานต่อแผนกหรือรอสักครู่';
  if (status >= 500)
    return `เซิร์ฟเวอร์ของผู้ให้บริการมีปัญหา (${status}) - ลองใหม่อีกครั้ง`;
  return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
}

/** ดึงรายชื่อโมเดลที่คีย์นี้เรียกได้ - ใช้เป็นตัวตรวจคีย์ไปในตัวเหมือน provider อื่น */
export async function listOpenAiModels(creds: Creds): Promise<{ id: string; label: string }[]> {
  const base = creds.baseUrl || DEFAULT_OPENAI_BASE;
  try {
    const data = await callJson(base, '/models', creds.apiKey);
    const rows = (data as { data?: unknown })?.data;
    if (!Array.isArray(rows)) throw new HttpError(-1, 'รูปแบบคำตอบไม่ใช่ /models ของ OpenAI');
    return rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.id === 'string')
      .map((r) => {
        const id = r.id as string;
        const name = typeof r.name === 'string' ? r.name : '';
        return { id, label: name && name !== id ? `${id} - ${name}` : id };
      })
      .slice(0, 200);
  } catch (err) {
    throw new Error(
      openAiFriendlyError(err, creds.model || defaultModelForBase(base), base, 'models'),
    );
  }
}

/**
 * ปลายทางในเครื่อง (Ollama, LM Studio) มีเฉพาะโมเดลที่ผู้ใช้ pull ไว้ - เดาชื่อไปก็ผิดเกือบทุกครั้ง
 * ถ้าไม่ได้ระบุโมเดลมา ให้ถาม /models แล้วใช้ตัวแรกที่มีอยู่จริงแทน
 * cache ต่อ base URL ไว้ 60 วิ - การประชุมหนึ่งรอบยิงหลายสิบคอล ไม่ควรถามซ้ำทุกคอล
 */
const localModelCache = new Map<string, { id: string; at: number }>();
export const isLocalBase = (b: string) => /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/.test(b.toLowerCase());

export async function resolveLocalModel(base: string, apiKey: string): Promise<string | null> {
  const hit = localModelCache.get(base);
  if (hit && Date.now() - hit.at < 60_000) return hit.id;
  try {
    const data = await callJson(base, '/models', apiKey);
    const rows = (data as { data?: unknown })?.data;
    const first = Array.isArray(rows)
      ? (rows.map((r) => (r as Record<string, unknown>).id).find((id) => typeof id === 'string') as string | undefined)
      : undefined;
    if (!first) return null;
    localModelCache.set(base, { id: first, at: Date.now() });
    return first;
  } catch {
    return null;
  }
}

export async function askOpenAi(opts: AskOptions, creds: Creds): Promise<string> {
  const base = creds.baseUrl || DEFAULT_OPENAI_BASE;
  let model = creds.model || '';
  if (!model && isLocalBase(base)) {
    const found = await resolveLocalModel(base, creds.apiKey);
    if (!found) {
      throw new Error(
        `${base} ไม่มีโมเดลให้ใช้เลย - ต้อง pull ก่อน เช่น "ollama pull llama3.2" แล้วกดโหลดรายชื่อในหน้าคีย์`,
      );
    }
    model = found;
  }
  if (!model) model = defaultModelForBase(base);

  let data: unknown;
  try {
    data = await callJson(base, '/chat/completions', creds.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        // ใช้ max_tokens ไม่ใช่ max_completion_tokens เพราะเจ้าที่มี free tier
        // (Groq, OpenRouter, Cerebras) ยังรับตัวเก่ากันหมด ส่วน effort ไม่มีในสัญญานี้
        max_tokens: opts.maxTokens ?? 6000,
      }),
    });
  } catch (err) {
    throw new Error(openAiFriendlyError(err, model, base));
  }

  const choice = (data as { choices?: unknown })?.choices;
  const first = Array.isArray(choice) ? (choice[0] as Record<string, unknown>) : null;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === 'string' ? message.content.trim() : '';

  if (!content) {
    // โมเดลสาย reasoning บางตัวใส่คำตอบไว้ที่ reasoning แล้วปล่อย content ว่าง
    const reasoning = typeof message?.reasoning === 'string' ? message.reasoning.trim() : '';
    if (reasoning) return reasoning;
    const finish = typeof first?.finish_reason === 'string' ? first.finish_reason : 'unknown';
    return `(ไม่มีคำตอบกลับมา - finish_reason: ${finish})`;
  }
  return content;
}
