'use client';

import { Check, Copy, Cpu, KeyRound, LoaderCircle, Lock, Plug, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useEffect, useState } from 'react';
import { accessToken, setOfficeLlmPolicy, type Office } from '@/lib/supabase';
import { clearOfficeLlm, fetchOfficeLlmStatus, type OfficeLlmStatus } from '@/lib/office-llm-client';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/infotip';
import { Field, Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import { LineInboundSection } from '@/components/DepartmentPanel';
import { DEPARTMENTS } from '@/lib/departments';

/* ============================================================
   การเชื่อมต่อภายนอก - token ของออฟฟิศสำหรับ MCP / API / LINE
   token จริงโชว์ครั้งเดียวตอนสร้าง (เซิร์ฟเวอร์เก็บแค่ hash) หายแล้วสร้างใหม่
   ============================================================ */

interface TokenRow {
  id: string;
  name: string;
  /** internal = agent ของเรา (ทำได้ทุกอย่าง) / public = ช่องทางลูกค้า (ถาม PR ได้อย่างเดียว) */
  scope?: 'internal' | 'public' | 'inbox';
  /** scope inbox: แผนกที่ยิงเข้าได้ */
  dept_ids?: string[];
  created_at: string;
  last_used_at: string | null;
}

export default function IntegrationsSection({ office, onPolicy, part = 'in' }: { office: Office; onPolicy?: (p: 'any' | 'local') => void; part?: 'in' | 'out' | 'settings' }) {
  const [policy, setPolicy] = useState<'any' | 'local'>(office.llm_policy === 'local' ? 'local' : 'any');
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  useEffect(() => { setPolicy(office.llm_policy === 'local' ? 'local' : 'any'); }, [office.id, office.llm_policy]);
  const changePolicy = async (p: 'any' | 'local') => {
    setPolicyBusy(true); setPolicyErr(null);
    try { await setOfficeLlmPolicy(office.id, p); setPolicy(p); onPolicy?.(p); }
    catch (e) { setPolicyErr(e instanceof Error ? e.message : String(e)); }
    finally { setPolicyBusy(false); }
  };
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'internal' | 'public' | 'inbox'>('inbox');
  /** แผนกที่ token แบบ inbox ยิงเข้าได้ (เลือกตอนสร้าง - แก้ทีหลังได้ทั้งที่นี่และในแผนก) */
  const [inboxDepts, setInboxDepts] = useState<string[]>([]);
  const patchToken = async (id: string, patch: { deptIds?: string[]; name?: string }) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/office/token', { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ officeId: office.id, id, ...patch }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** token ที่เพิ่งสร้าง - โชว์ครั้งเดียว */
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** ชุดคีย์/โมเดลที่บันทึกบนเซิร์ฟเวอร์ให้ MCP/LINE/API - undefined = ยังไม่โหลด, null = ดูไม่ได้ */
  const [llmStatus, setLlmStatus] = useState<OfficeLlmStatus | null | undefined>(undefined);
  const loadLlm = async () => {
    try { setLlmStatus(await fetchOfficeLlmStatus(office.id)); } catch { setLlmStatus(null); }
  };
  useEffect(() => { void loadLlm(); }, [office.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearLlm = async () => {
    setBusy(true); setErr(null);
    try { await clearOfficeLlm(office.id); await loadLlm(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

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
        method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId: office.id, name: name.trim() || 'token', scope, ...(scope === 'inbox' ? { deptIds: inboxDepts } : {}) }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFresh(data.token);
      setName(''); setInboxDepts([]);
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
      label={part === 'in' ? <span className="flex items-center gap-1.5"><Plug className="size-3.5" /> บัตรผ่านขาเข้าของออฟฟิศ - ใครยิงเข้ามาได้บ้าง</span> : undefined}
      info={part === 'in' ? 'ที่นี่ = สร้าง "บัตรผ่าน" ให้ระบบข้างนอกยิงเข้าออฟฟิศ ทำครั้งเดียว ใช้ได้หลายแผนก (ต่างจากในหน้าแผนกที่แค่ติ๊กว่าแผนกนั้นรับจากบัตรไหน) · webhook เข้า = ระบบยิงข้อมูลให้แผนกที่เลือก · internal = agent ของเราเอง ถามทุกแผนก/ประชุม/อ่านสมุด (MCP/API) · public = ช่องทางลูกค้า ได้เฉพาะคำตอบที่กรองแล้ว · LINE OA = ลูกค้าทัก LINE แล้วแผนกที่เลือกตอบ · token โชว์ครั้งเดียว เก็บเหมือนรหัสผ่าน' : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {part !== 'in' ? null : rows === null ? (
          <Hint className="flex items-center gap-1.5"><LoaderCircle className="size-3 animate-spin" /> กำลังโหลด</Hint>
        ) : rows.length === 0 ? (
          <Hint>ยังไม่มี token</Hint>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px]">
                <KeyRound className="size-3.5 shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-parchment">{r.name}</span>
                <Badge variant={r.scope === 'public' ? 'brass' : r.scope === 'inbox' ? 'default' : 'good'}>
                  {r.scope === 'public' ? 'public - ลูกค้า' : r.scope === 'inbox' ? 'webhook เข้า' : 'internal - ทีมเรา'}
                </Badge>
                {r.scope === 'inbox' && (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] text-dim">→ แผนก:</span>
                    {DEPARTMENTS.map((d) => {
                      const on = (r.dept_ids ?? []).includes(d.id);
                      return (
                        <button key={d.id} type="button" disabled={busy} title={d.nameTh}
                          onClick={() => void patchToken(r.id, { deptIds: on ? (r.dept_ids ?? []).filter((x) => x !== d.id) : [...(r.dept_ids ?? []), d.id] })}
                          className={`rounded-box border px-1.5 py-px text-[10px] ${on ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>
                          {on ? '✓ ' : ''}{d.shortTh}
                        </button>
                      );
                    })}
                  </span>
                )}
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

        {part === 'in' && (<>
        <div className="flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={scope === 'inbox' ? 'ชื่อระบบที่จะยิงเข้า เช่น gcp-billing' : 'ชื่อ token เช่น Claude Code / LINE bot'} maxLength={60} />
          <Select value={scope} onValueChange={(v) => setScope(v === 'public' ? 'public' : v === 'inbox' ? 'inbox' : 'internal')}>
            <SelectTrigger className="h-9 w-48 shrink-0 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inbox">webhook เข้า - ระบบยิงข้อมูลให้แผนก</SelectItem>
              <SelectItem value="internal">internal - agent ของเรา (MCP/API)</SelectItem>
              <SelectItem value="public">public - ช่องทางลูกค้า</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="primary" className="shrink-0" size="sm" disabled={busy || (scope === 'inbox' && (!name.trim() || !inboxDepts.length))} onClick={create}
            title={scope === 'inbox' && !name.trim() ? 'พิมพ์ชื่อระบบก่อน' : scope === 'inbox' && !inboxDepts.length ? 'เลือกแผนกที่จะรับอย่างน้อย 1' : undefined}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Plus />} สร้าง token
          </Button>
        </div>

        {scope === 'inbox' && (
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-dim">แผนกที่รับ:</span>
            {DEPARTMENTS.map((d) => {
              const on = inboxDepts.includes(d.id);
              return (
                <button key={d.id} type="button" onClick={() => setInboxDepts((l) => (on ? l.filter((x) => x !== d.id) : [...l, d.id]))}
                  className={`rounded-box border px-2 py-0.5 ${on ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>{on ? '✓ ' : ''}{d.shortTh}</button>
              );
            })}
            <InfoTip>ระบบนี้ยิงเข้าแผนกไหนได้บ้าง - เปลี่ยนทีหลังได้ทั้งที่นี่และในหน้าแผนก (แท็บ "ขาเข้า" ติ๊กรับ) · URL ที่ระบบต้องยิง: <code>{origin}/api/office/inbox/&lt;deptId&gt;</code></InfoTip>
            {(!name.trim() || !inboxDepts.length) && <span className="text-[10px] text-brass">{!name.trim() ? 'พิมพ์ชื่อระบบ' : 'เลือกแผนกที่รับอย่างน้อย 1'} แล้วปุ่ม "สร้าง token" จะกดได้</span>}
          </div>
        )}
        {err && <p className="rounded-box border border-rug-dark bg-[#3f2018] px-2 py-1 text-[11px] text-rug-lite">{err}</p>}
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
            <div>LINE: ตั้งจากหน้าเว็บ - <b>แผนก &amp; Webhook</b> → เลือกแผนกที่ตอบลูกค้า → แท็บ <b>Webhook เข้า</b> → <b>เพิ่ม LINE OA</b> (ได้ URL <code>{origin}/api/line/webhook/&lt;id&gt;</code> ไปวางใน LINE console) - ลูกค้าเห็นเฉพาะข้อมูลที่ติดว่าเปิดเผยได้</div>
          </div>
        </details>

        <div className="rounded-box border border-ink-600 bg-ink-700 p-2 text-[11px]">
          <LineInboundSection officeId={office.id} deptId="*" canEdit />
        </div>
        </>)}



        {part === 'settings' && (<>
        <div className="rounded-box border border-ink-600 bg-ink-700 p-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <Lock className="size-3.5 shrink-0 text-dim" />
            <span className="text-parchment">นโยบายโมเดลของออฟฟิศ</span>
            <InfoTip>
              <b>ทุกผู้ให้บริการ</b> = ใช้คีย์ Claude/Gemini/OpenAI-compatible ได้ตามที่ตั้งใน "คีย์ของฉัน"<br />
              <b>เฉพาะโมเดลในเครื่อง/LAN</b> = เซิร์ฟเวอร์ปฏิเสธทุกคำขอที่ชุดคีย์ไม่ได้ชี้ไป localhost / IP วง LAN / .local (Ollama, LM Studio)
              ครอบทั้งประชุมจากหน้าเว็บ MCP/API/LINE webhook เข้า และการฝังเอกสาร - ข้อมูลบริษัทไม่ออกจากเครื่องแม้ใครจะใส่คีย์ข้างนอกมา<br />
              เจ้าของออฟฟิศเท่านั้นที่เปลี่ยนได้
            </InfoTip>
            <span className="flex-1" />
            {(['any', 'local'] as const).map((p) => (
              <Button key={p} size="sm" variant={policy === p ? 'primary' : 'outline'} className="h-6 px-2 text-[10px]" disabled={policyBusy} onClick={() => policy !== p && void changePolicy(p)}>
                {p === 'any' ? 'ทุกผู้ให้บริการ' : 'เฉพาะโมเดลในเครื่อง/LAN'}
              </Button>
            ))}
          </div>
          {policy === 'local' && <p className="mt-1 text-[10px] text-carpet-lite">เปิดอยู่ - คำขอที่ใช้คีย์ข้างนอกจะถูกปฏิเสธพร้อมข้อความบอกให้เปลี่ยนชุดคีย์</p>}
          {policyErr && <p className="mt-1 text-[10px] text-rug-lite">{policyErr}</p>}
        </div>

        <div className="rounded-box border border-ink-600 bg-ink-700 p-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <Cpu className="size-3.5 shrink-0 text-dim" />
            <span className="text-parchment">โมเดลที่ MCP / API / LINE ใช้</span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => void loadLlm()}>รีเฟรช</Button>
          </div>
          {llmStatus === undefined ? (
            <Hint className="mt-1">กำลังโหลด</Hint>
          ) : llmStatus?.configured ? (
            <div className="mt-1 flex flex-col gap-1 text-dim">
              <div className="flex flex-wrap items-center gap-1.5">
                ใช้ชุดคีย์ที่ sync จาก &quot;คีย์ของฉัน&quot;
                {llmStatus.updatedAt && <> · อัปเดต {new Date(llmStatus.updatedAt).toLocaleString('th-TH')}</>}
                <InfoTip>ใช้ชุดคีย์/โมเดลรายคนตามที่ตั้งใน &quot;คีย์ของฉัน&quot; และแผงพนักงาน sync อัตโนมัติจากเบราว์เซอร์ของเจ้าของ/exec และเข้ารหัสก่อนบันทึกลงฐานข้อมูล</InfoTip>
              </div>
              <div className="flex flex-wrap gap-1">
                {llmStatus.connections.map((c) => (
                  <Badge key={c.id} variant="good">{c.label || c.provider}{c.model ? ` · ${c.model}` : ''}{!c.hasKey && c.provider !== 'openai' ? ' (ไม่มีคีย์)' : ''}</Badge>
                ))}
              </div>
              <div>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-brass-lite" disabled={busy} onClick={() => void clearLlm()}>
                  <Trash2 className="size-3" /> ลบออกจากเซิร์ฟเวอร์ (กลับไปใช้ .env)
                </Button>
              </div>
            </div>
          ) : (
            <Hint className="mt-1 flex items-center gap-1.5">
              ยังไม่มีชุดคีย์บนเซิร์ฟเวอร์ - ใช้ค่าจาก <code>.env</code>
              <InfoTip side="top">
                ตอนนี้ MCP/API/LINE ใช้ค่าจาก <code>.env</code> (LLM_PROVIDER, OPENAI_BASE_URL, OPENAI_MODEL)
                เพิ่มชุดคีย์ใน &quot;คีย์ของฉัน&quot; แล้วระบบจะ sync ให้อัตโนมัติ (เฉพาะเจ้าของ/exec)
              </InfoTip>
            </Hint>
          )}
        </div>

        </>)}
        {err && <p className="rounded-box border border-wood-dark bg-wood-deep/60 px-2 py-1 text-[11px] text-brass-lite">{err}</p>}
      </div>
    </Field>
  );
}
