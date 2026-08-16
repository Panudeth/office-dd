'use client';

import {
  Check, Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { defaultModelForBase } from '@/lib/openai';

export type ProviderId = 'anthropic' | 'gemini' | 'openai';

/**
 * การเชื่อมต่อหนึ่งชุด - เก็บได้หลายชุดพร้อมกัน แล้วเลือกว่าจะใช้อันไหน
 * เดิมเก็บได้ชุดเดียว การจะลอง Ollama จึงต้องถอด Gemini ทิ้งก่อน
 */
export interface LlmConnection {
  id: string;
  /** ชื่อที่ผู้ใช้ตั้งเอง - คนละเรื่องกับชื่อผู้ให้บริการ เพราะมีหลายชุดของเจ้าเดียวกันได้ */
  label: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** ใช้เฉพาะ provider แบบ OpenAI-compatible */
  baseUrl?: string;
}

export interface LlmStore {
  /** id ของชุดที่กำลังใช้ - null คือใช้คีย์ของเซิร์ฟเวอร์ */
  active: string | null;
  items: LlmConnection[];
}

const STORE_KEY = 'visual-company.llm';

const META = {
  anthropic: {
    label: 'Claude (Anthropic)',
    defaultModel: 'claude-opus-5',
    prefix: 'sk-ant-',
    where: 'Anthropic Console หน้า API keys',
    note: 'ต้องมีเครดิตในบัญชี subscription Max/Pro ใช้กับ API ไม่ได้',
  },
  gemini: {
    label: 'Gemini (Google)',
    defaultModel: 'gemini-3.7-flash',
    prefix: 'AIza',
    where: 'Google AI Studio หน้า Get API key',
    note: 'มี free tier แต่จำกัดจำนวนเรียกต่อนาทีและต่อวัน',
  },
  openai: {
    label: 'OpenAI-compatible',
    defaultModel: 'llama-3.3-70b-versatile',
    // เจ้าที่รองรับสัญญานี้ตั้งชื่อคีย์กันคนละแบบ เดาไม่ได้ว่าขึ้นต้นด้วยอะไร
    prefix: '',
    where: 'หน้า API keys ของเจ้าที่เลือกไว้ด้านบน',
    note: 'ชื่อโมเดลของแต่ละเจ้าไม่เหมือนกัน กดโหลดรายชื่อแล้วเลือกจะชัวร์กว่าพิมพ์เอง',
  },
} as const;

/**
 * เจ้าที่พูดภาษา /chat/completions ได้เหมือนกันหมด ต่างกันแค่ base URL
 * เรียงเอาที่ใช้ได้ฟรีจริงไว้บน เพราะนั่นคือเหตุผลเดียวที่มีรายการนี้
 */
export const OPENAI_PRESETS = [
  { id: 'groq', label: 'Groq - ฟรี ไม่ต้องผูกบัตร', url: 'https://api.groq.com/openai/v1', keys: 'console.groq.com' },
  { id: 'cerebras', label: 'Cerebras - ฟรี ไม่ต้องผูกบัตร', url: 'https://api.cerebras.ai/v1', keys: 'cloud.cerebras.ai' },
  { id: 'openrouter', label: 'OpenRouter - มีโมเดลลงท้าย :free', url: 'https://openrouter.ai/api/v1', keys: 'openrouter.ai/keys' },
  { id: 'github', label: 'GitHub Models - ใช้ GitHub token', url: 'https://models.github.ai/inference', keys: 'github.com/settings/tokens' },
  { id: 'openai', label: 'OpenAI - ต้องเติมเงิน', url: 'https://api.openai.com/v1', keys: 'platform.openai.com' },
  { id: 'ollama', label: 'Ollama ในเครื่อง - ไม่ต้องใช้คีย์จริง', url: 'http://localhost:11434/v1', keys: 'ใส่อะไรก็ได้ในช่องคีย์' },
] as const;

const isProvider = (v: unknown): v is ProviderId =>
  v === 'anthropic' || v === 'gemini' || v === 'openai';

/**
 * ปลายทางที่รันอยู่บนเครื่องเดียวกัน - ตรวจจาก host ไม่ใช่จาก provider
 * เพราะ Groq/OpenRouter ใช้สัญญาเดียวกันเป๊ะแต่ยังต้องมีคีย์อยู่ดี
 */
export const isLocalBase = (u: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/i.test(u.trim());

/** เจ้าที่รันในเครื่องไม่มีคีย์ให้กรอก บังคับไปก็ได้แค่ค่าขยะ */
export const keyIsOptional = (provider: ProviderId, baseUrl: string) =>
  provider === 'openai' && isLocalBase(baseUrl);

/**
 * ตรวจก่อนบันทึก คืน null ถ้าผ่าน
 * ตรวจแค่รูปแบบ ไม่ตรวจว่าคีย์ใช้ได้จริง (นั่นคือหน้าที่ของปุ่มตรวจคีย์ซึ่งต้องยิงเน็ต)
 * เจตนาคือกันค่าที่ยิงไปก็พังแน่ ๆ ไม่ให้ถูกบันทึกไปเงียบ ๆ
 */
export function validateSettings(s: {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  label?: string;
}): string | null {
  if (s.label !== undefined && !s.label.trim())
    return 'ตั้งชื่อการเชื่อมต่อก่อน จะได้แยกออกว่าอันไหนเป็นอันไหน';
  if (s.provider === 'openai') {
    const b = s.baseUrl.trim();
    if (!b) return 'ยังไม่ได้ใส่ปลายทาง (base URL) - เลือกจากรายการหรือพิมพ์เอง';
    let u: URL;
    try {
      u = new URL(b);
    } catch {
      return 'base URL ไม่ถูกรูปแบบ ต้องเป็น URL เต็ม เช่น https://api.groq.com/openai/v1';
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      return 'base URL ต้องขึ้นต้นด้วย http:// หรือ https://';
  }
  if (!s.apiKey.trim() && !keyIsOptional(s.provider, s.baseUrl))
    return 'ยังไม่ได้ใส่ API key';
  return null;
}

/* ---------- ที่เก็บ ---------- */

const EMPTY: LlmStore = { active: null, items: [] };

export function loadStore(): LlmStore {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<LlmStore> & Partial<LlmConnection>;

    // ของเดิมเก็บชุดเดียวแบบแบน ๆ - ยกขึ้นมาเป็นรายการแรกให้ ผู้ใช้จะได้ไม่ต้องกรอกใหม่
    if (!Array.isArray(p.items) && typeof p.apiKey === 'string' && isProvider(p.provider)) {
      const one: LlmConnection = {
        id: 'migrated',
        label: META[p.provider].label,
        provider: p.provider,
        apiKey: p.apiKey,
        model: typeof p.model === 'string' ? p.model : '',
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
      };
      return { active: one.id, items: [one] };
    }

    const items = (Array.isArray(p.items) ? p.items : [])
      .filter((c): c is LlmConnection => !!c && isProvider(c.provider) && typeof c.id === 'string');
    const active = items.some((c) => c.id === p.active) ? p.active! : items[0]?.id ?? null;
    return { active, items };
  } catch {
    return EMPTY;
  }
}

export function saveStore(s: LlmStore): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* โหมดส่วนตัวเขียนไม่ได้ */
  }
}

export const activeOf = (s: LlmStore): LlmConnection | null =>
  s.items.find((c) => c.id === s.active) ?? null;

/** header ที่แนบไปกับ /api/ask ส่งทาง header ไม่ใช่ body จะได้ไม่ติดไปกับ log */
export function authHeaders(c: LlmConnection | null): Record<string, string> {
  if (!c) return {};
  const usable = c.apiKey.trim() || (c.provider === 'openai' && c.baseUrl?.trim());
  if (!usable) return {};
  return {
    'x-llm-provider': c.provider,
    ...(c.apiKey ? { 'x-llm-key': c.apiKey } : {}),
    ...(c.model ? { 'x-llm-model': c.model } : {}),
    ...(c.baseUrl ? { 'x-llm-base-url': c.baseUrl } : {}),
  };
}

/** ป้ายสั้น ๆ ไว้โชว์ว่าชุดนี้ยิงไปไหน */
export function connSubtitle(c: LlmConnection): string {
  const model = c.model || (c.provider === 'openai' ? defaultModelForBase(c.baseUrl) : META[c.provider].defaultModel);
  if (c.provider !== 'openai') return `${META[c.provider].label} · ${model}`;
  const host = (() => {
    try {
      return new URL(c.baseUrl ?? '').host;
    } catch {
      return c.baseUrl ?? '?';
    }
  })();
  return `${host} · ${model}`;
}

/* ============================================================ */

interface Props {
  open: boolean;
  store: LlmStore;
  onClose: () => void;
  onChange: (s: LlmStore) => void;
}

const blank = (): LlmConnection => ({
  id: crypto.randomUUID(),
  label: '',
  provider: 'gemini',
  apiKey: '',
  model: '',
  baseUrl: OPENAI_PRESETS[0].url,
});

export default function KeyPanel({ open, store, onClose, onChange }: Props) {
  const [draft, setDraft] = useState<LlmConnection | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setReveal(false);
      setModels(null);
      setCheckMsg(null);
      setSaveErr(null);
      setConfirmDel(null);
    }
  }, [open]);

  // เปลี่ยนเจ้า เปลี่ยนคีย์ หรือเปลี่ยนปลายทาง แปลว่ารายชื่อโมเดลเดิมใช้ไม่ได้แล้ว
  useEffect(() => {
    setModels(null);
    setCheckMsg(null);
    setSaveErr(null);
  }, [draft?.provider, draft?.apiKey, draft?.baseUrl]);

  const startAdd = () => {
    setDraft(blank());
    setIsNew(true);
  };
  const startEdit = (c: LlmConnection) => {
    setDraft({ ...c, baseUrl: c.baseUrl ?? OPENAI_PRESETS[0].url });
    setIsNew(false);
  };

  const patch = (v: Partial<LlmConnection>) => setDraft((d) => (d ? { ...d, ...v } : d));

  const remove = (id: string) => {
    const items = store.items.filter((c) => c.id !== id);
    onChange({ items, active: store.active === id ? items[0]?.id ?? null : store.active });
    setConfirmDel(null);
  };

  const fetchModels = async () => {
    if (!draft) return;
    const k = draft.apiKey.trim();
    const optional = keyIsOptional(draft.provider, draft.baseUrl ?? '');
    if (!k && !optional) return;
    setLoading(true);
    setCheckMsg(null);
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: {
          'x-llm-provider': draft.provider,
          ...(k ? { 'x-llm-key': k } : {}),
          ...(draft.provider === 'openai' ? { 'x-llm-base-url': (draft.baseUrl ?? '').trim() } : {}),
        },
      });
      const data = (await res.json()) as {
        models?: { id: string; label: string }[];
        error?: string;
      };
      if (!res.ok || !data.models) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModels(data.models);
      setCheckMsg({ ok: true, text: `คีย์ใช้ได้ เรียกได้ ${data.models.length} โมเดล` });
      // โมเดลที่เลือกไว้ไม่มีในรายชื่อ คือสาเหตุของ 400 ที่เคยเจอ
      if (draft.model && !data.models.some((m) => m.id === draft.model)) patch({ model: '' });
    } catch (err) {
      setModels(null);
      setCheckMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  const commit = () => {
    if (!draft) return;
    const problem = validateSettings({
      provider: draft.provider,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl ?? '',
      label: draft.label,
    });
    if (problem) {
      setSaveErr(problem);
      return;
    }
    const clean: LlmConnection = {
      ...draft,
      label: draft.label.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      baseUrl: draft.provider === 'openai' ? (draft.baseUrl ?? '').trim() : undefined,
    };
    const items = isNew
      ? [...store.items, clean]
      : store.items.map((c) => (c.id === clean.id ? clean : c));
    // เพิ่มชุดใหม่แล้วให้ใช้อันนั้นเลย เพราะคนเพิ่งกรอกมักตั้งใจจะใช้มันต่อ
    onChange({ items, active: isNew ? clean.id : store.active });
    setDraft(null);
  };

  const meta = draft ? META[draft.provider] : META.gemini;
  // ค่าดีฟอลต์ที่จะโชว์/ใช้จริง - OpenAI-compatible ขึ้นกับปลายทาง ไม่ใช่ค่าตายตัวของ Groq
  const effDefault = draft?.provider === 'openai' ? defaultModelForBase(draft.baseUrl) : meta.defaultModel;
  const optional = draft ? keyIsOptional(draft.provider, draft.baseUrl ?? '') : false;
  const looksWrong =
    !!draft && meta.prefix !== '' && draft.apiKey.trim().length > 0 &&
    !draft.apiKey.trim().startsWith(meta.prefix);
  const preset = OPENAI_PRESETS.find((p) => p.url === (draft?.baseUrl ?? '').trim());

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<KeyRound />}
        title="คีย์ของคุณเอง"
        description="เก็บได้หลายชุด แล้วเลือกว่าจะใช้อันไหน"
      >
        {!draft ? (
          <>
            <Field label="การเชื่อมต่อที่บันทึกไว้">
              {!store.items.length ? (
                <Hint>ยังไม่มี - กดเพิ่มด้านล่าง ถ้าไม่มีเลยจะใช้คีย์ของเซิร์ฟเวอร์แทน</Hint>
              ) : (
                <ul className="flex flex-col gap-1">
                  {store.items.map((c) => {
                    const on = store.active === c.id;
                    return (
                      <li
                        key={c.id}
                        className={`flex items-center gap-2 rounded-box border-2 px-2 py-1.5 ${
                          on ? 'border-brass bg-ink-700' : 'border-ink-600 bg-ink-800'
                        }`}
                      >
                        <button
                          onClick={() => onChange({ ...store, active: c.id })}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title={on ? 'กำลังใช้อยู่' : 'กดเพื่อเปลี่ยนมาใช้ชุดนี้'}
                        >
                          <span
                            className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 ${
                              on ? 'border-brass bg-brass' : 'border-ink-500'
                            }`}
                          >
                            {on && <Check className="size-2.5 text-ink-900" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-parchment">
                              {c.label}
                            </span>
                            <span className="block truncate text-[10px] text-dim">
                              {connSubtitle(c)}
                            </span>
                          </span>
                        </button>

                        {confirmDel === c.id ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>
                              <X />
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => remove(c.id)}>
                              ลบ
                            </Button>
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              title="แก้ไข"
                              onClick={() => startEdit(c)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              title="ลบชุดนี้"
                              onClick={() => setConfirmDel(c.id)}
                            >
                              <Trash2 />
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <Button variant="outline" size="sm" className="mt-1.5 w-full" onClick={startAdd}>
                <Plus /> เพิ่มการเชื่อมต่อ
              </Button>
            </Field>

            {store.active && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...store, active: null })}
              >
                เลิกใช้คีย์ของตัวเอง กลับไปใช้ของเซิร์ฟเวอร์
              </Button>
            )}

            <Hint>
              คีย์เก็บไว้ใน <code>localStorage</code> ของเบราว์เซอร์คุณเท่านั้น ไม่ได้ขึ้นฐานข้อมูล
              ส่งไปที่เซิร์ฟเวอร์ของแอปนี้เฉพาะตอนถามคำถาม แล้วใช้ยิงต่อไปที่ผู้ให้บริการ
              ไม่ถูกบันทึกลงดิสก์และไม่ถูก log
              <br />
              ถ้าเครื่องนี้มีคนอื่นใช้ด้วย หรือจะเอาแอปนี้ไป deploy บนเน็ต ให้กดลบเมื่อเลิกใช้
            </Hint>

            <DialogFooter>
              <Button variant="primary" onClick={onClose}>
                เสร็จแล้ว
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Field label="ชื่อการเชื่อมต่อ" hint="ตั้งให้จำง่าย เช่น Gemini ส่วนตัว หรือ Ollama ในเครื่อง">
              <Input
                value={draft.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder={META[draft.provider].label}
                spellCheck={false}
              />
            </Field>

            <Field label="ผู้ให้บริการ">
              <Select
                value={draft.provider}
                onValueChange={(v) => patch({ provider: v as ProviderId, model: '' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">{META.anthropic.label}</SelectItem>
                  <SelectItem value="gemini">{META.gemini.label}</SelectItem>
                  <SelectItem value="openai">{META.openai.label}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {draft.provider === 'openai' && (
              <Field
                label="ปลายทาง (base URL)"
                hint={
                  preset
                    ? `เอาคีย์จาก ${preset.keys}`
                    : 'ใส่เองได้ ต้องเป็น URL ที่มี /chat/completions และ /models ต่อท้าย (ปกติลงท้ายด้วย /v1)'
                }
              >
                <Select
                  value={preset?.url ?? 'custom'}
                  onValueChange={(v) => v !== 'custom' && patch({ baseUrl: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPENAI_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.url}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">กำหนดเอง</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="mt-1"
                  value={draft.baseUrl ?? ''}
                  onChange={(e) => patch({ baseUrl: e.target.value })}
                  placeholder="https://api.groq.com/openai/v1"
                  spellCheck={false}
                />
              </Field>
            )}

            <Field
              label={optional ? 'API key (ปลายทางในเครื่อง ไม่ต้องใส่)' : 'API key'}
              hint={
                <>
                  {optional
                    ? 'เซิร์ฟเวอร์ในเครื่องไม่ตรวจคีย์ เว้นว่างไว้ได้เลย'
                    : `เอาจาก ${meta.where} ${meta.note}`}
                  {looksWrong && (
                    <b className="mt-1 block text-brass">
                      คีย์ของ{meta.label}มักขึ้นต้นด้วย {meta.prefix} เลือกผู้ให้บริการถูกอันแล้วใช่ไหม
                    </b>
                  )}
                </>
              }
            >
              <div className="flex gap-1.5">
                <Input
                  type={reveal ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                  placeholder={meta.prefix ? `${meta.prefix}...` : 'วางคีย์ของเจ้าที่เลือกไว้'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 shrink-0"
                  onClick={() => setReveal((v) => !v)}
                  title={reveal ? 'ซ่อนคีย์' : 'แสดงคีย์'}
                >
                  {reveal ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </Field>

            <Field
              label="โมเดล"
              hint={
                checkMsg ? (
                  <b className={checkMsg.ok ? 'text-carpet-lite' : 'text-brass'}>{checkMsg.text}</b>
                ) : !models ? (
                  optional
                    ? `Ollama มีเฉพาะโมเดลที่ pull ไว้ในเครื่อง - กดโหลดรายชื่อแล้วเลือก อย่าเดา (ค่าดีฟอลต์ ${effDefault} อาจไม่มี)`
                    : 'กดปุ่มด้านล่างเพื่อดูว่าคีย์นี้เรียกโมเดลไหนได้บ้าง จะได้ไม่ต้องเดาชื่อ'
                ) : null
              }
            >
              {models ? (
                <Select
                  value={draft.model || 'default'}
                  onValueChange={(v) => patch({ model: v === 'default' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">ใช้ค่าดีฟอลต์ ({effDefault})</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={draft.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  placeholder={`${effDefault} (ไม่ใส่ก็ได้)`}
                  spellCheck={false}
                />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 w-full"
                onClick={fetchModels}
                disabled={loading || (!draft.apiKey.trim() && !optional)}
              >
                {models ? <RefreshCw /> : <ShieldCheck />}
                {loading ? 'กำลังตรวจ' : models ? 'โหลดรายชื่อใหม่' : 'ตรวจคีย์ และโหลดรายชื่อโมเดล'}
              </Button>
            </Field>

            {saveErr && (
              <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">
                <b className="text-brass">บันทึกไม่ได้</b> {saveErr}
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                ยกเลิก
              </Button>
              <Button variant="primary" onClick={commit}>
                {isNew ? 'เพิ่ม' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
