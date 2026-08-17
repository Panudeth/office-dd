'use client';

import { Check, Copy, KeyRound, LoaderCircle, Plug, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useEffect, useState } from 'react';
import { accessToken, type Office } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';

/* ============================================================
   การเชื่อมต่อภายนอก - token ของออฟฟิศสำหรับ MCP / API / LINE
   token จริงโชว์ครั้งเดียวตอนสร้าง (เซิร์ฟเวอร์เก็บแค่ hash) หายแล้วสร้างใหม่
   ============================================================ */

interface TokenRow {
  id: string;
  name: string;
  /** internal = agent ของเรา (ทำได้ทุกอย่าง) / public = ช่องทางลูกค้า (ถาม PR ได้อย่างเดียว) */
  scope?: 'internal' | 'public';
  created_at: string;
  last_used_at: string | null;
}

export default function IntegrationsSection({ office }: { office: Office }) {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'internal' | 'public'>('internal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** token ที่เพิ่งสร้าง - โชว์ครั้งเดียว */
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const mcpUrl = `${origin}/api/mcp`;

  const hdr = async () => {
    const t = await accessToken();
    return { 'Content-Type': 'application/json', ...(t ? { 'x-sb-token': t } : {}) };
  };

  const load = async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/office/token?officeId=${office.id}`, { headers: await hdr() });
      const data = (await res.json()) as { tokens?: TokenRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRows(data.tokens ?? []);
    } catch (e) {
      setRows([]);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { void load(); }, [office.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true); setErr(null); setFresh(null);
    try {
      const res = await fetch('/api/office/token', {
        method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId: office.id, name: name.trim() || 'token', scope }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFresh(data.token);
      setName('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/office/token', {
        method: 'DELETE', headers: await hdr(), body: JSON.stringify({ officeId: office.id, id }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(null), 1500); } catch { /* ไม่ได้ก็ไม่เป็นไร */ }
  };

  const mcpConfig = JSON.stringify(
    { mcpServers: { 'visual-company': { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer <token>' } } } },
    null, 2,
  );

  return (
    <Field
      label={<span className="flex items-center gap-1.5"><Plug className="size-3.5" /> การเชื่อมต่อภายนอก (MCP / API / LINE)</span>}
      hint="internal = agent ของเราเอง (ถามทุกแผนก ประชุม อ่านสมุดได้)  public = ช่องทางลูกค้า (ถาม PR ได้อย่างเดียว ได้เฉพาะคำตอบที่กรองแล้ว ไม่เห็นสมุด) - เก็บเหมือนรหัสผ่าน"
    >
      <div className="flex flex-col gap-1.5">
        {rows === null ? (
          <Hint className="flex items-center gap-1.5"><LoaderCircle className="size-3 animate-spin" /> กำลังโหลด</Hint>
        ) : rows.length === 0 ? (
          <Hint>ยังไม่มี token</Hint>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px]">
                <KeyRound className="size-3.5 shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-parchment">{r.name}</span>
                <Badge variant={r.scope === 'public' ? 'brass' : 'good'}>{r.scope === 'public' ? 'public - ลูกค้า' : 'internal - ทีมเรา'}</Badge>
                <span className="shrink-0 text-[10px] text-dim">
                  {r.last_used_at ? `ใช้ล่าสุด ${new Date(r.last_used_at).toLocaleString('th-TH')}` : 'ยังไม่เคยใช้'}
                </span>
                <Button size="icon" variant="ghost" className="size-6" title="เพิกถอน" disabled={busy} onClick={() => revoke(r.id)}>
                  <Trash2 className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ token เช่น Claude Code / LINE bot" maxLength={60} />
          <Select value={scope} onValueChange={(v) => setScope(v === 'public' ? 'public' : 'internal')}>
            <SelectTrigger className="h-9 w-44 shrink-0 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">internal - agent ของเรา</SelectItem>
              <SelectItem value="public">public - ช่องทางลูกค้า</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="primary" className="shrink-0" size="sm" disabled={busy} onClick={create}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Plus />} สร้าง token
          </Button>
        </div>

        {fresh && (
          <div className="rounded-box border-2 border-brass/60 bg-ink-900 p-2">
            <div className="mb-1 text-[11px] font-semibold text-brass">token ใหม่ - คัดลอกตอนนี้ จะไม่โชว์อีก</div>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-box bg-ink-800 px-1.5 py-1 font-mono text-[11px] text-parchment">{fresh}</code>
              <Button size="sm" variant="outline" onClick={() => copy(fresh, 'tok')}>
                {copied === 'tok' ? <Check /> : <Copy />} คัดลอก
              </Button>
            </div>
          </div>
        )}

        <details className="rounded-box border border-ink-600 bg-ink-700 p-2 text-[11px]">
          <summary className="cursor-pointer text-dim hover:text-parchment">วิธีต่อ MCP (Claude Code / pugbase / อื่น ๆ)</summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-dim">URL</span>
              <code className="min-w-0 flex-1 truncate rounded-box bg-ink-900 px-1.5 py-0.5 font-mono text-parchment">{mcpUrl}</code>
              <Button size="icon" variant="ghost" className="size-6" onClick={() => copy(mcpUrl, 'url')}>{copied === 'url' ? <Check className="size-3" /> : <Copy className="size-3" />}</Button>
            </div>
            <div className="text-dim">Claude Code: <code>claude mcp add --transport http visual-company {mcpUrl} --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code></div>
            <pre className="overflow-x-auto rounded-box bg-ink-900 p-1.5 font-mono text-[10px] text-wall-top">{mcpConfig}</pre>
            <div className="text-dim">tools (internal): <code>list_departments</code> · <code>ask_department</code> (เร็ว) · <code>hold_meeting</code> (ประชุม) · <code>get_meeting</code> · <code>list_meetings</code></div>
            <div className="text-dim">tools (public): <code>ask_customer_service</code> เท่านั้น - PR ตอบจากข้อมูลสาธารณะ ถ้าต้องปรึกษาทีมจะเปิดประชุมภายในเองแล้วกรองคำตอบให้</div>
          </div>
        </details>

        <details className="rounded-box border border-ink-600 bg-ink-700 p-2 text-[11px]">
          <summary className="cursor-pointer text-dim hover:text-parchment">วิธีต่อ API ตรง / LINE</summary>
          <div className="mt-1.5 flex flex-col gap-1 text-dim">
            <div>API: <code>POST {origin}/api/office/ask</code> header <code>Authorization: Bearer &lt;token&gt;</code> body <code>{'{ "question": "...", "deptIds": ["legal"], "mode": "direct" }'}</code></div>
            <div>LINE: ตั้งใน <code>.env</code> ของเซิร์ฟเวอร์ <code>LINE_CHANNEL_SECRET</code>, <code>LINE_CHANNEL_ACCESS_TOKEN</code>, <code>LINE_OFFICE_ID={office.id}</code> แล้วชี้ Webhook URL ไปที่ <code>{origin}/api/line/webhook</code> - แผนกประชาสัมพันธ์จะตอบจากข้อมูลที่เปิดเผยได้ (โปรไฟล์ สินค้า โน้ต/เอกสารของ PR)</div>
            <div className="text-brass-lite">ทั้ง MCP/API/LINE ใช้คีย์ LLM ของเซิร์ฟเวอร์ (.env: LLM_PROVIDER, OPENAI_BASE_URL ฯลฯ) ไม่ใช่คีย์ในเบราว์เซอร์ - และต้องตั้ง SUPABASE_SECRET_KEY ที่เซิร์ฟเวอร์</div>
          </div>
        </details>

        {err && <p className="rounded-box border border-wood-dark bg-wood-deep/60 px-2 py-1 text-[11px] text-brass-lite">{err}</p>}
      </div>
    </Field>
  );
}
