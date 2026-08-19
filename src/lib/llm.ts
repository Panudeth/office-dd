import { DEFAULT_CLAUDE_MODEL, askClaude, envClaudeKey, listClaudeModels } from './claude';
import { GEMINI_MODEL, askGemini, hasGeminiKey, listGeminiModels } from './gemini';
import {
  DEFAULT_OPENAI_BASE, DEFAULT_OPENAI_MODEL, askOpenAi, defaultModelForBase, envOpenAiKey,
  isLocalBase, listOpenAiModels, resolveLocalModel,
} from './openai';

export type Provider = 'anthropic' | 'gemini' | 'openai';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const PROVIDER_IDS: Provider[] = ['anthropic', 'gemini', 'openai'];

const isProvider = (v: unknown): v is Provider =>
  typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v);

export interface AskOptions {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: Effort;
}

export interface Creds {
  provider: Provider;
  apiKey: string;
  model?: string;
  /** ใช้เฉพาะ provider แบบ OpenAI-compatible - เจ้าไหนก็ได้ ต่างกันแค่ตรงนี้ */
  baseUrl?: string;
  /** คีย์มาจากไหน - เอาไว้โชว์ใน UI ว่าใช้คีย์ของใครอยู่ */
  source: 'byok' | 'env';
}

export const PROVIDERS: { id: Provider; label: string; defaultModel: string; keyHint: string }[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    defaultModel: DEFAULT_CLAUDE_MODEL,
    keyHint: 'ขึ้นต้นด้วย sk-ant- / เอาจาก Anthropic Console -> API keys (ต้องมีเครดิตในบัญชี)',
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    defaultModel: GEMINI_MODEL,
    keyHint: 'ขึ้นต้นด้วย AIza- / เอาจาก Google AI Studio -> Get API key (มี free tier)',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible (Groq, OpenRouter, ...)',
    defaultModel: DEFAULT_OPENAI_MODEL,
    keyHint: 'ใส่ base URL ของเจ้าที่ใช้ด้วย - Groq และ Cerebras สมัครฟรีไม่ต้องผูกบัตร',
  },
];

export const defaultModelFor = (p: Provider, baseUrl?: string) =>
  p === 'gemini' ? GEMINI_MODEL : p === 'openai' ? defaultModelForBase(baseUrl) : DEFAULT_CLAUDE_MODEL;

/**
 * ชื่อโมเดลที่จะถูกใช้จริงในคำขอนี้ - เอาไว้โชว์ใน proof ให้ผู้ใช้ตรวจได้
 * ปลายทางในเครื่องที่ไม่ระบุโมเดล ต้องไปถามเครื่องก่อนถึงจะรู้ชื่อจริง
 */
export async function effectiveModel(creds: Creds): Promise<string> {
  if (creds.model) return creds.model;
  if (creds.provider === 'openai') {
    const base = creds.baseUrl || DEFAULT_OPENAI_BASE;
    if (isLocalBase(base)) return (await resolveLocalModel(base, creds.apiKey)) ?? defaultModelForBase(base);
  }
  return defaultModelFor(creds.provider, creds.baseUrl);
}

export interface ByokInput {
  provider?: string | null;
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
}

/**
 * ชุดคีย์ที่ผู้ใช้ส่งมาเอง - เฉพาะที่ครบพอจะยิงได้ ไม่ถอยไปใช้ .env
 * ใช้กับชุดที่ถูกผูกกับคน/บทบาท เพราะถ้าชุดนั้นพัง ควรถอยไปชุดถัดไปในลำดับ ไม่ใช่กระโดดไป env
 */
/** ชุดคีย์นี้ชี้ไปโมเดลในเครื่อง/LAN ไหม (Ollama, LM Studio ผ่าน OpenAI-compatible) - ใช้กับนโยบาย "เฉพาะโมเดลในเครื่อง" */
export function isLocalCreds(c: Creds | null | undefined): boolean {
  if (!c) return false;
  return c.provider === 'openai' && isLocalBase(c.baseUrl || DEFAULT_OPENAI_BASE);
}

export function byokCreds(byok: ByokInput): Creds | null {
  const wanted = isProvider(byok.provider) ? byok.provider : null;
  // ปกติต้องมีคีย์ถึงจะนับว่าผู้ใช้เอาของตัวเองมา ยกเว้น OpenAI-compatible ที่ชี้ปลายทางเอง
  // เพราะเซิร์ฟเวอร์ที่รันในเครื่อง (Ollama, LM Studio) ไม่มีคีย์ให้กรอกตั้งแต่แรก
  const ready = wanted && (byok.apiKey || (wanted === 'openai' && byok.baseUrl));
  if (!wanted || !ready) return null;
  return {
    provider: wanted,
    apiKey: byok.apiKey ?? '',
    model: byok.model || undefined,
    baseUrl: byok.baseUrl || undefined,
    source: 'byok',
  };
}

/**
 * เลือกคีย์ที่จะใช้: คีย์ที่ผู้ใช้ส่งมาจากเบราว์เซอร์มาก่อน ถ้าไม่มีค่อยใช้ของ .env
 * คีย์ของผู้ใช้ถูกใช้เฉพาะในคำขอนั้น ๆ ไม่เก็บลงดิสก์ ไม่ log ไม่ส่งกลับไปที่ client
 */
export function resolveCreds(byok: ByokInput): Creds | null {
  const own = byokCreds(byok);
  if (own) return own;

  const envProvider = isProvider(process.env.LLM_PROVIDER) ? process.env.LLM_PROVIDER : null;
  const claudeKey = envClaudeKey();
  const openAiKey = envOpenAiKey();
  // Ollama/LM Studio ในเครื่องเดียวกับเซิร์ฟเวอร์ไม่มีคีย์ - ชี้ OPENAI_BASE_URL ไป localhost ก็พอ
  // จำเป็นสำหรับงานที่ไม่มีเบราว์เซอร์ส่งคีย์มา (MCP / LINE / API)
  const openAiReady = Boolean(openAiKey) || isLocalBase(DEFAULT_OPENAI_BASE);
  const openAiEnv = (): Creds => ({
    provider: 'openai', apiKey: openAiKey, baseUrl: DEFAULT_OPENAI_BASE,
    model: process.env.OPENAI_MODEL || undefined, source: 'env',
  });

  if (envProvider === 'gemini' && hasGeminiKey()) {
    return { provider: 'gemini', apiKey: geminiEnvKey(), source: 'env' };
  }
  if (envProvider === 'anthropic' && claudeKey) {
    return { provider: 'anthropic', apiKey: claudeKey, source: 'env' };
  }
  if (envProvider === 'openai' && openAiReady) return openAiEnv();
  // ไม่ได้ระบุ LLM_PROVIDER - ใช้อันที่มีคีย์
  if (claudeKey) return { provider: 'anthropic', apiKey: claudeKey, source: 'env' };
  if (hasGeminiKey()) return { provider: 'gemini', apiKey: geminiEnvKey(), source: 'env' };
  if (openAiReady) return openAiEnv();
  return null;
}

function geminiEnvKey() {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
}

/**
 * โมเดลสาย reasoning (qwen3, deepseek-r1, ...) ที่รันผ่าน Ollama/OpenAI-compatible บางทีพ่นความคิดปนมาในคำตอบ
 * ทั้งแบบ <think>...</think> และแบบข้อความดิบ "Thinking Process: ..." ก่อนถึงคำตอบจริง
 * ตัดทิ้งที่จุดเดียว - ทุก provider ทุกบทบาทได้คำตอบสะอาดเหมือนกัน (บันทึกในสมุดจะได้ไม่มีความคิดในใจติดไป)
 */
export function stripThinking(text: string): string {
  let s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^<\/?think>\s*/i, '');
  // ความคิดดิบขึ้นต้นข้อความ (ทั้งแบบข้อความเปล่าและแบบหัวข้อตัวหนา "**Analyze the Request:**") - เอาเฉพาะคำตอบจริง
  // คำตอบจริงมักตามหลังบรรทัดอย่าง "Draft:" / "Final answer:" / "คำตอบ:" หรือเริ่มที่หัวข้อไทยตัวหนา (**สรุป**)
  const thinky = /^\s*(\*\*)?\s*(thinking process|thought process|thoughts?|reasoning|analysis|analyze the request|let me|okay,? (let|so)|ก่อนอื่น(ขอ)?คิด)/i;
  if (thinky.test(s)) {
    // บรรทัด "Draft:" / "**Final answer:**" (อาจมี bullet นำหน้า) - คำตอบจริงเริ่มบรรทัดถัดไป
    const cut = s.search(/(^|\n)[ \t*-]*\*?\*?(draft|final answer|final response|answer|response|คำตอบ|ร่างคำตอบ)\s*[:：]?[ \t]*\*?\*?[ \t]*\n/i);
    const th = s.search(/\*\*[฀-๿][^*]{0,40}\*\*/);
    const i = cut >= 0 ? s.indexOf('\n', cut + 1) + 1 : th;
    if (i > 0) s = s.slice(i);
  }
  return s.trim() || text.trim();
}

export async function ask(opts: AskOptions, creds: Creds): Promise<string> {
  const raw = creds.provider === 'gemini'
    ? await askGemini(opts, creds)
    : creds.provider === 'openai'
      ? await askOpenAi(opts, creds)
      : await askClaude(opts, creds);
  return stripThinking(raw);
}

export function listModels(creds: Creds): Promise<{ id: string; label: string }[]> {
  if (creds.provider === 'gemini') return listGeminiModels(creds);
  if (creds.provider === 'openai') return listOpenAiModels(creds);
  return listClaudeModels(creds);
}
