import { DEFAULT_CLAUDE_MODEL, askClaude, envClaudeKey, listClaudeModels } from './claude';
import { GEMINI_MODEL, askGemini, hasGeminiKey, listGeminiModels } from './gemini';

export type Provider = 'anthropic' | 'gemini';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
];

export const defaultModelFor = (p: Provider) =>
  p === 'gemini' ? GEMINI_MODEL : DEFAULT_CLAUDE_MODEL;

/**
 * เลือกคีย์ที่จะใช้: คีย์ที่ผู้ใช้ส่งมาจากเบราว์เซอร์มาก่อน ถ้าไม่มีค่อยใช้ของ .env
 * คีย์ของผู้ใช้ถูกใช้เฉพาะในคำขอนั้น ๆ ไม่เก็บลงดิสก์ ไม่ log ไม่ส่งกลับไปที่ client
 */
export function resolveCreds(byok: {
  provider?: string | null;
  apiKey?: string | null;
  model?: string | null;
}): Creds | null {
  const wanted = (byok.provider === 'gemini' || byok.provider === 'anthropic'
    ? byok.provider
    : null) as Provider | null;

  if (wanted && byok.apiKey) {
    return {
      provider: wanted,
      apiKey: byok.apiKey,
      model: byok.model || undefined,
      source: 'byok',
    };
  }

  const envProvider = (process.env.LLM_PROVIDER as Provider | undefined) ?? null;
  const claudeKey = envClaudeKey();

  if (envProvider === 'gemini' && hasGeminiKey()) {
    return { provider: 'gemini', apiKey: geminiEnvKey(), source: 'env' };
  }
  if (envProvider === 'anthropic' && claudeKey) {
    return { provider: 'anthropic', apiKey: claudeKey, source: 'env' };
  }
  // ไม่ได้ระบุ LLM_PROVIDER - ใช้อันที่มีคีย์
  if (claudeKey) return { provider: 'anthropic', apiKey: claudeKey, source: 'env' };
  if (hasGeminiKey()) return { provider: 'gemini', apiKey: geminiEnvKey(), source: 'env' };
  return null;
}

function geminiEnvKey() {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
}

export function ask(opts: AskOptions, creds: Creds): Promise<string> {
  return creds.provider === 'gemini' ? askGemini(opts, creds) : askClaude(opts, creds);
}

export function listModels(creds: Creds): Promise<{ id: string; label: string }[]> {
  return creds.provider === 'gemini' ? listGeminiModels(creds) : listClaudeModels(creds);
}
