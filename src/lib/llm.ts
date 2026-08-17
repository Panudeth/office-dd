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

  if (envProvider === 'gemini' && hasGeminiKey()) {
    return { provider: 'gemini', apiKey: geminiEnvKey(), source: 'env' };
  }
  if (envProvider === 'anthropic' && claudeKey) {
    return { provider: 'anthropic', apiKey: claudeKey, source: 'env' };
  }
  if (envProvider === 'openai' && openAiKey) {
    return { provider: 'openai', apiKey: openAiKey, baseUrl: DEFAULT_OPENAI_BASE, source: 'env' };
  }
  // ไม่ได้ระบุ LLM_PROVIDER - ใช้อันที่มีคีย์
  if (claudeKey) return { provider: 'anthropic', apiKey: claudeKey, source: 'env' };
  if (hasGeminiKey()) return { provider: 'gemini', apiKey: geminiEnvKey(), source: 'env' };
  if (openAiKey) {
    return { provider: 'openai', apiKey: openAiKey, baseUrl: DEFAULT_OPENAI_BASE, source: 'env' };
  }
  return null;
}

function geminiEnvKey() {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
}

export function ask(opts: AskOptions, creds: Creds): Promise<string> {
  if (creds.provider === 'gemini') return askGemini(opts, creds);
  if (creds.provider === 'openai') return askOpenAi(opts, creds);
  return askClaude(opts, creds);
}

export function listModels(creds: Creds): Promise<{ id: string; label: string }[]> {
  if (creds.provider === 'gemini') return listGeminiModels(creds);
  if (creds.provider === 'openai') return listOpenAiModels(creds);
  return listClaudeModels(creds);
}
