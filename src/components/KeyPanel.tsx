'use client';

import { useEffect, useState } from 'react';

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
    where: 'Anthropic Console → API keys',
    note: 'ต้องมีเครดิตในบัญชี — subscription Max/Pro ใช้กับ API ไม่ได้',
  },
  gemini: {
    label: 'Gemini (Google)',
    defaultModel: 'gemini-3.7-flash',
    prefix: 'AIza',
    where: 'Google AI Studio → Get API key',
    note: 'มี free tier แต่จำกัดจำนวนเรียกต่อนาที/ต่อวัน',
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

/** header ที่แนบไปกับ /api/ask — ส่งทาง header ไม่ใช่ body จะได้ไม่ติดไปกับ log */
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

  // เปลี่ยนเจ้า/เปลี่ยนคีย์ = รายชื่อเดิมใช้ไม่ได้แล้ว
  useEffect(() => { setModels(null); setCheckMsg(null); }, [provider, apiKey]);

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
      setCheckMsg({ ok: true, text: `คีย์ใช้ได้ · เรียกได้ ${data.models.length} โมเดล` });
      // โมเดลที่เลือกไว้ไม่มีในรายชื่อ = สาเหตุของ 400 ที่เคยเจอ
      if (model && !data.models.some((m) => m.id === model)) setModel('');
    } catch (err) {
      setModels(null);
      setCheckMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  const meta = META[provider];
  const looksWrong = apiKey.trim().length > 0 && !apiKey.trim().startsWith(meta.prefix);

  const save = () => {
    const k = apiKey.trim();
    if (!k) { onSave(null); onClose(); return; }
    const next: LlmSettings = { provider, apiKey: k, model: model.trim() };
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* โหมดส่วนตัวอาจเขียนไม่ได้ */ }
    onSave(next);
    onClose();
  };

  const clear = () => {
    try { window.localStorage.removeItem(STORE_KEY); } catch { /* ไม่เป็นไร */ }
    onSave(null);
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>🔑 คีย์ของคุณเอง</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>

        <label className="field">
          <span>ผู้ให้บริการ</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as 'anthropic' | 'gemini')}>
            <option value="anthropic">{META.anthropic.label}</option>
            <option value="gemini">{META.gemini.label}</option>
          </select>
        </label>

        <label className="field">
          <span>API key</span>
          <div className="key-row">
            <input
              type={reveal ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`${meta.prefix}…`}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="ghost" onClick={() => setReveal((v) => !v)}>
              {reveal ? '🙈' : '👁'}
            </button>
          </div>
          <small>เอาจาก {meta.where} · {meta.note}</small>
          {looksWrong && <small className="bad">คีย์ของ{meta.label}มักขึ้นต้นด้วย {meta.prefix} — เลือกผู้ให้บริการถูกอันแล้วใช่ไหม</small>}
        </label>

        <div className="field">
          <span>โมเดล</span>
          {models ? (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">ใช้ค่าดีฟอลต์ ({meta.defaultModel})</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`${meta.defaultModel} (ไม่ใส่ก็ได้)`}
              spellCheck={false}
            />
          )}
          <button
            type="button"
            className="ghost check"
            onClick={fetchModels}
            disabled={loading || !apiKey.trim()}
          >
            {loading ? 'กำลังตรวจ…' : models ? '↻ โหลดรายชื่อใหม่' : '✓ ตรวจคีย์ + โหลดรายชื่อโมเดล'}
          </button>
          {checkMsg && (
            <small className={checkMsg.ok ? 'good' : 'bad'}>
              {checkMsg.ok ? '✓ ' : '⚠️ '}{checkMsg.text}
            </small>
          )}
          {!models && !checkMsg && (
            <small>กดปุ่มด้านบนเพื่อดูว่าคีย์นี้เรียกโมเดลไหนได้บ้าง จะได้ไม่ต้องเดาชื่อ</small>
          )}
        </div>

        <p className="hint">
          คีย์เก็บไว้ใน <code>localStorage</code> ของเบราว์เซอร์คุณเท่านั้น ส่งไปที่เซิร์ฟเวอร์ของแอปนี้
          เฉพาะตอนถามคำถาม แล้วใช้ยิงต่อไปที่ผู้ให้บริการ — ไม่ถูกบันทึกลงดิสก์และไม่ถูก log<br />
          ถ้าเครื่องนี้มีคนอื่นใช้ด้วย หรือจะเอาแอปนี้ไป deploy บนเน็ต ให้กด &ldquo;ลบคีย์&rdquo; เมื่อเลิกใช้
        </p>

        <div className="modal-actions">
          <button className="ghost" onClick={clear} disabled={!settings}>ลบคีย์</button>
          <button className="primary" onClick={save}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}
