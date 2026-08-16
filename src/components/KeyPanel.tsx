'use client';

import { Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export interface LlmSettings {
  provider: 'anthropic' | 'gemini';
  apiKey: string;
  model: string;
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
} as const;

export function loadSettings(): LlmSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LlmSettings>;
    if (!p.apiKey || (p.provider !== 'anthropic' && p.provider !== 'gemini')) return null;
    return { provider: p.provider, apiKey: p.apiKey, model: p.model ?? '' };
  } catch {
    return null;
  }
}

/** header ที่แนบไปกับ /api/ask ส่งทาง header ไม่ใช่ body จะได้ไม่ติดไปกับ log */
export function authHeaders(s: LlmSettings | null): Record<string, string> {
  if (!s?.apiKey) return {};
  return {
    'x-llm-provider': s.provider,
    'x-llm-key': s.apiKey,
    ...(s.model ? { 'x-llm-model': s.model } : {}),
  };
}

interface Props {
  open: boolean;
  settings: LlmSettings | null;
  onClose: () => void;
  onSave: (s: LlmSettings | null) => void;
}

export default function KeyPanel({ open, settings, onClose, onSave }: Props) {
  const [provider, setProvider] = useState<'anthropic' | 'gemini'>(settings?.provider ?? 'anthropic');
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [model, setModel] = useState(settings?.model ?? '');
  const [reveal, setReveal] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setProvider(settings?.provider ?? 'anthropic');
    setApiKey(settings?.apiKey ?? '');
    setModel(settings?.model ?? '');
    setReveal(false);
    setModels(null);
    setCheckMsg(null);
  }, [open, settings]);

  // เปลี่ยนเจ้าหรือเปลี่ยนคีย์ แปลว่ารายชื่อเดิมใช้ไม่ได้แล้ว
  useEffect(() => {
    setModels(null);
    setCheckMsg(null);
  }, [provider, apiKey]);

  const fetchModels = async () => {
    const k = apiKey.trim();
    if (!k) return;
    setLoading(true);
    setCheckMsg(null);
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'x-llm-provider': provider, 'x-llm-key': k },
      });
      const data = (await res.json()) as {
        models?: { id: string; label: string }[];
        error?: string;
      };
      if (!res.ok || !data.models) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModels(data.models);
      setCheckMsg({ ok: true, text: `คีย์ใช้ได้ เรียกได้ ${data.models.length} โมเดล` });
      // โมเดลที่เลือกไว้ไม่มีในรายชื่อ คือสาเหตุของ 400 ที่เคยเจอ
      if (model && !data.models.some((m) => m.id === model)) setModel('');
    } catch (err) {
      setModels(null);
      setCheckMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  const meta = META[provider];
  const looksWrong = apiKey.trim().length > 0 && !apiKey.trim().startsWith(meta.prefix);

  const save = () => {
    const k = apiKey.trim();
    if (!k) {
      onSave(null);
      onClose();
      return;
    }
    const next: LlmSettings = { provider, apiKey: k, model: model.trim() };
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* โหมดส่วนตัวอาจเขียนไม่ได้ */
    }
    onSave(next);
    onClose();
  };

  const clear = () => {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* ไม่เป็นไร */
    }
    onSave(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<KeyRound />}
        title="คีย์ของคุณเอง"
        description="ตั้งค่าผู้ให้บริการ API key และโมเดลที่จะใช้"
      >
        <Field label="ผู้ให้บริการ">
          <Select value={provider} onValueChange={(v) => setProvider(v as 'anthropic' | 'gemini')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">{META.anthropic.label}</SelectItem>
              <SelectItem value="gemini">{META.gemini.label}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="API key"
          hint={
            <>
              เอาจาก {meta.where} {meta.note}
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
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`${meta.prefix}...`}
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
              'กดปุ่มด้านบนเพื่อดูว่าคีย์นี้เรียกโมเดลไหนได้บ้าง จะได้ไม่ต้องเดาชื่อ'
            ) : null
          }
        >
          {models ? (
            <Select value={model || 'default'} onValueChange={(v) => setModel(v === 'default' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">ใช้ค่าดีฟอลต์ ({meta.defaultModel})</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`${meta.defaultModel} (ไม่ใส่ก็ได้)`}
              spellCheck={false}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-full"
            onClick={fetchModels}
            disabled={loading || !apiKey.trim()}
          >
            {models ? <RefreshCw /> : <ShieldCheck />}
            {loading ? 'กำลังตรวจ' : models ? 'โหลดรายชื่อใหม่' : 'ตรวจคีย์ และโหลดรายชื่อโมเดล'}
          </Button>
        </Field>

        <Hint>
          คีย์เก็บไว้ใน <code>localStorage</code> ของเบราว์เซอร์คุณเท่านั้น ส่งไปที่เซิร์ฟเวอร์ของแอปนี้
          เฉพาะตอนถามคำถาม แล้วใช้ยิงต่อไปที่ผู้ให้บริการ ไม่ถูกบันทึกลงดิสก์และไม่ถูก log
          <br />
          ถ้าเครื่องนี้มีคนอื่นใช้ด้วย หรือจะเอาแอปนี้ไป deploy บนเน็ต ให้กดลบคีย์เมื่อเลิกใช้
        </Hint>

        <DialogFooter>
          <Button variant="ghost" onClick={clear} disabled={!settings}>
            <Trash2 /> ลบคีย์
          </Button>
          <Button variant="primary" onClick={save}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
