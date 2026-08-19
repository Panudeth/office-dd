'use client';

import { Check, Copy, KeyRound, LoaderCircle, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChannelSection } from '@/components/DepartmentPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/infotip';
import { Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import { accessToken, listChannels, listInbox, saveChannel, sbError, type DeptChannel, type InboxRow } from '@/lib/supabase';

/* ============================================================
   "เข้า → ออก" ของแผนก - ประโยคเดียว: แหล่งไหนเข้ามา → ส่งไปช่องไหน
     แถว = แหล่งที่เข้ามา (token ต่อระบบ / LINE OA / อื่น ๆ)   ชิป = ช่องส่งออก (คลังกลางของออฟฟิศ) ติ๊กเพื่อผูก
     เส้นทางเก็บที่ช่อง: config.routes = ["<deptId>/<source>", "<deptId>/*"]  ('*' = ทุกแหล่งของแผนกนี้)
     ช่องส่งออกมีที่เดียวทั้งออฟฟิศ (จัดการในกล่องพับด้านล่าง หรือหน้า "เชื่อมต่อ") - ไม่มี "ช่องเฉพาะแผนก/ช่องกลาง" อีก
   ============================================================ */

interface TokenRow { id: string; name: string; scope?: string; dept_ids?: string[]; created_at: string; last_used_at: string | null }
interface InboundRow { id: string; dept_id: string; label: string; enabled: boolean }

export const routeKey = (deptId: string, source: string) => `${deptId}/${source}`;
export const parseRoutes = (c: DeptChannel): string[] => (c.config.routes ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
export const chOn = (c: DeptChannel, key: string) => parseRoutes(c).includes(key);
export const channelTarget = (c: DeptChannel) => (c.kind === 'line' ? `LINE → ${c.config.to ?? ''}` : (c.config.url ?? '').replace(/^https?:\/\//, '').slice(0, 28));

export default function RoutingTab({ officeId, deptId, canEdit, part = 'in' }: { officeId: string; deptId: string; canEdit: boolean; part?: 'in' | 'out' }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/api/office/inbox/${deptId}`;
  const [channels, setChannels] = useState<DeptChannel[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [lines, setLines] = useState<InboundRow[]>([]);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [srcName, setSrcName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const hdr = async () => {
    const t = await accessToken();
    return { 'Content-Type': 'application/json', ...(t ? { 'x-sb-token': t } : {}) };
  };
  /** ช่องแบบเก่า (ผูกด้วย dept_id/config.depts/config.sources) -> แปลงเป็น routes ครั้งเดียว จะได้เห็นชิปตรงกับที่ส่งจริง */
  const migrate = async (all: DeptChannel[]): Promise<DeptChannel[]> => {
    const out: DeptChannel[] = [];
    for (const c of all) {
      if ((c.config.routes ?? '').trim()) { out.push(c); continue; }
      const listOf = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const sources = listOf(c.config.sources);
      const depts = c.dept_id === '*' ? listOf(c.config.depts) : [c.dept_id];
      const routes = depts.flatMap((d) => (sources.length ? sources.map((s) => routeKey(d, s)) : [routeKey(d, '*')]));
      if (!routes.length) { out.push(c); continue; }
      try { out.push(await saveChannel(officeId, { ...c, config: { ...c.config, routes: routes.join(', ') } })); } catch { out.push(c); }
    }
    return out;
  };
  const load = async () => {
    try { setChannels(await migrate(await listChannels(officeId))); } catch (e) { setErr(sbError(e)); }
    try {
      const res = await fetch(`/api/office/token?officeId=${officeId}`, { headers: await hdr() });
      const data = (await res.json()) as { tokens?: TokenRow[] };
      setTokens((data.tokens ?? []).filter((t) => t.scope === 'inbox'));
    } catch { /* ไม่มีสิทธิ์ */ }
    try {
      const res = await fetch(`/api/office/inbound?officeId=${officeId}`, { headers: await hdr() });
      const data = (await res.json()) as { inbound?: InboundRow[] };
      setLines(data.inbound ?? []);
    } catch { /* ไม่มีสิทธิ์ */ }
    try { setRows((await listInbox(officeId, 100)).filter((r) => r.dept_id === deptId).slice(0, 12)); } catch { /* ตารางยังไม่มี */ }
  };
  useEffect(() => { void load(); }, [officeId, deptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = rows.some((r) => r.status === 'received' || r.status === 'running');
  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(iv);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRoute = async (c: DeptChannel, key: string) => {
    setBusy(`${c.id}:${key}`); setErr(null);
    try {
      const cur = parseRoutes(c);
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      await saveChannel(officeId, { ...c, config: { ...c.config, routes: next.join(', ') } });
      await load();
    } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
  };
  /** แผนกนี้ "รับ" จาก token นี้ไหม - แก้ dept_ids ของ token (คลังกลางที่หน้า "เชื่อมต่อ") */
  const subscribeToken = async (t: TokenRow, on: boolean) => {
    setBusy(t.id); setErr(null);
    try {
      const cur = t.dept_ids ?? [];
      const next = on ? [...new Set([...cur, deptId])] : cur.filter((d) => d !== deptId);
      const res = await fetch('/api/office/token', { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ officeId, id: t.id, deptIds: next }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const createToken = async () => {
    setBusy('token'); setErr(null); setFresh(null);
    try {
      const res = await fetch('/api/office/token', { method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId, name: srcName.trim(), scope: 'inbox', deptIds: [deptId] }) });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFresh(data.token); setSrcName('');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const revoke = async (id: string) => {
    setBusy(id); setErr(null);
    try {
      const res = await fetch('/api/office/token', { method: 'DELETE', headers: await hdr(), body: JSON.stringify({ officeId, id }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const fireTest = async (source: string) => {
    setTesting(source); setErr(null);
    try {
      const res = await fetch('/api/office/inbox/test', { method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId, deptId, source }) });
      const data = (await res.json()) as { inboxId?: string; error?: string };
      if (!res.ok || !data.inboxId) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setTesting(null); }
  };
  const copy = async (k: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* ไม่มี clipboard */ }
  };

  const enabledChannels = channels.filter((c) => c.enabled && c.dept_id === deptId);
  /** แถวแหล่ง: ชื่อ + ชิปช่อง */
  const RouteRow = ({ source, label, badge, extra, subscribed, onSubscribe, note }: {
    source: string; label: string; badge: React.ReactNode; extra?: React.ReactNode;
    /** undefined = แถวถาวร (เช่น ทุกแหล่ง) / true-false = แผนกนี้รับจากแหล่งนี้อยู่ไหม */
    subscribed?: boolean; onSubscribe?: (on: boolean) => void; note?: string;
  }) => {
    const key = routeKey(deptId, source);
    const anyKey = routeKey(deptId, '*');
    const targets = enabledChannels.filter((c) => chOn(c, key));
    const viaAll = enabledChannels.filter((c) => chOn(c, anyKey) && !chOn(c, key));
    const off = subscribed === false;
    const showChips = part === 'out';
    return (
      <li className={`flex flex-col gap-1 rounded-box border px-2 py-1.5 text-[11px] ${off ? 'border-ink-700 bg-ink-800/60 opacity-70' : 'border-ink-600 bg-ink-700'}`}>
        <div className="flex items-center gap-2">
          {subscribed !== undefined && (
            <button type="button" disabled={!canEdit || busy !== null} onClick={() => onSubscribe?.(!subscribed)} title={subscribed ? 'แผนกนี้รับจากแหล่งนี้อยู่ - กดเพื่อเลิกรับ' : 'กดเพื่อให้แผนกนี้รับจากแหล่งนี้'}
              className={`size-4 shrink-0 rounded-box border text-[10px] leading-none ${subscribed ? 'border-carpet bg-carpet-dark text-white' : 'border-ink-500 bg-ink-800'}`}>{subscribed ? '✓' : ''}</button>
          )}
          {badge}
          <span className="truncate font-semibold text-parchment">{label}</span>
          {note && <span className="text-[10px] text-dim">{note}</span>}
          {showChips && !off && targets.length === 0 && viaAll.length === 0 && source !== '*' && <Badge variant="bad">ยังไม่ส่งไปไหน</Badge>}
          <span className="flex-1" />
          {!off && extra}
        </div>
        {showChips && !off && <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-dim">→ ส่งไปที่</span>
          {enabledChannels.length === 0 && <span className="text-[10px] text-dim">ยังไม่มีช่องส่งออกของแผนกนี้ - เพิ่มในกล่อง "ส่งออก" ด้านล่าง</span>}
          {enabledChannels.map((c) => {
            const on = chOn(c, key);
            const inherited = source !== '*' && !on && chOn(c, anyKey);
            return (
              <button key={c.id} type="button" disabled={!canEdit || busy !== null} onClick={() => void toggleRoute(c, key)}
                title={`${c.kind} · ${channelTarget(c)}${inherited ? ' (ได้อยู่แล้วผ่าน "ทุกแหล่ง")' : ''}`}
                className={`rounded-box border px-2 py-0.5 text-[11px] ${on ? 'border-carpet bg-[#22401f] text-carpet-lite' : inherited ? 'border-carpet/40 bg-ink-800 text-carpet-lite/70' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>
                {on ? '✓ ' : inherited ? '↳ ' : ''}{c.label || c.kind}
              </button>
            );
          })}
        </div>}
      </li>
    );
  };

  /** ชิป "รับจากแหล่งไหน" ใต้แต่ละช่องในแท็บขาออก */
  const sourceChips = (c: DeptChannel) => {
    const anyKey = routeKey(deptId, '*');
    const srcs: { key: string; label: string; badge?: string }[] = [
      ...tokens.filter((t) => (t.dept_ids ?? []).includes(deptId)).map((t) => ({ key: routeKey(deptId, t.name), label: t.name, badge: 'webhook' })),
      ...lines.filter((l) => l.dept_id === deptId).map((l) => ({ key: routeKey(deptId, l.label), label: l.label, badge: 'LINE' })),
    ];
    const all = chOn(c, anyKey);
    return (
      <div className="flex flex-wrap items-center gap-1 pl-5">
        <span className="text-[10px] text-dim">← รับจาก</span>
        <button type="button" disabled={!canEdit || busy !== null} onClick={() => void toggleRoute(c, anyKey)}
          className={`rounded-box border px-2 py-0.5 text-[10px] ${all ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>{all ? '✓ ' : ''}ทุกแหล่งของแผนก</button>
        {srcs.map((s) => {
          const on = chOn(c, s.key);
          // ติ๊ก "ทุกแหล่ง" อยู่ = แหล่งย่อยได้หมด (โชว์ ↳) - กดแหล่งย่อยจะสลับเป็น "เฉพาะที่เลือก" ให้เอง
          const pick = async () => {
            if (!all) { await toggleRoute(c, s.key); return; }
            setBusy(`${c.id}:${s.key}`); setErr(null);
            try {
              const others = srcs.filter((x) => x.key !== s.key).map((x) => x.key); // ที่เหลือคงได้เหมือนเดิม ยกเว้นตัวที่กด (= เอาออก)
              const next = parseRoutes(c).filter((k) => k !== anyKey && !srcs.some((x) => x.key === k)).concat(others);
              await saveChannel(officeId, { ...c, config: { ...c.config, routes: next.join(', ') } });
              await load();
            } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
          };
          return (
            <button key={s.key} type="button" disabled={!canEdit || busy !== null} onClick={() => void pick()}
              title={all ? 'ได้อยู่แล้วผ่าน "ทุกแหล่งของแผนก" - กดเพื่อเอาแหล่งนี้ออก (จะเปลี่ยนเป็นเลือกรายแหล่ง)' : on ? 'กดเพื่อเลิกรับจากแหล่งนี้' : 'กดเพื่อรับจากแหล่งนี้'}
              className={`rounded-box border px-2 py-0.5 text-[10px] ${on ? 'border-carpet bg-[#22401f] text-carpet-lite' : all ? 'border-carpet/40 bg-ink-800 text-carpet-lite/70' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>{on ? '✓ ' : all ? '↳ ' : ''}{s.label}</button>
          );
        })}
        {!all && !srcs.some((s) => chOn(c, s.key)) && <Badge variant="bad">ไม่มีแหล่งไหนส่งมาช่องนี้</Badge>}
      </div>
    );
  };

  if (part === 'out') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
          ขาออก - แผนกนี้ส่งรายงานไปไหน
          <InfoTip>ช่อง (Teams/Slack/Discord/LINE/webhook) เป็นของแผนกนี้ - เพิ่มด้วยฟอร์มด้านล่าง แล้วใต้แต่ละช่องติ๊กว่า "รับจากแหล่งไหน" (แหล่งที่แผนกนี้ติ๊กรับไว้ในแท็บขาเข้า) · "ทุกแหล่งของแผนก" = ทุกอย่างที่เข้าแผนกนี้ รวมยิงทดสอบ</InfoTip>
        </div>
        <ChannelSection officeId={officeId} deptId={deptId} canEdit={canEdit} compact onChanged={load} rowExtra={sourceChips} />
        {err && <p className="text-[11px] text-rug-lite">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ---- แหล่งที่เข้ามา ---- */}
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
        ขาเข้า - แผนกนี้รับจากใคร
        <InfoTip>
          <b>ต่างกันยังไง:</b> หน้า "การเชื่อมต่อ" = <b>สร้างบัตรผ่าน</b> (token / LINE OA) ให้ระบบข้างนอกยิงเข้าออฟฟิศ ทำครั้งเดียว ใช้ได้หลายแผนก · แท็บนี้ = <b>แผนกนี้ติ๊กว่าจะรับจากบัตรไหน</b> + URL ของแผนกนี้ที่ระบบต้องยิงมา + playbook<br />
          แถว = บัตรผ่านทั้งหมดของออฟฟิศ ☐ = แผนกนี้รับ · "ส่งไปไหน" ไปตั้งที่แท็บขาออก
        </InfoTip>
        {running && <LoaderCircle className="size-3 animate-spin text-brass" />}
      </div>
      <ul className="flex flex-col gap-1">
        {tokens.map((t) => (
          <RouteRow key={t.id} source={t.name} label={t.name} badge={<Badge>webhook</Badge>}
            subscribed={(t.dept_ids ?? []).includes(deptId)} onSubscribe={(on) => void subscribeToken(t, on)}
            note={(t.dept_ids ?? []).filter((d) => d !== deptId).length ? `(แผนกอื่นที่รับด้วย: ${(t.dept_ids ?? []).filter((d) => d !== deptId).join(', ')})` : undefined}
            extra={<>
              <span className="text-[10px] text-dim">{t.last_used_at ? `ใช้ล่าสุด ${new Date(t.last_used_at).toLocaleString('th-TH')}` : 'ยังไม่เคยใช้'}</span>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => void fireTest(t.name)} disabled={testing !== null || running} title="ยิงข้อมูลตัวอย่างในนามแหล่งนี้">{testing === t.name ? <LoaderCircle className="animate-spin" /> : <Send />} ทดสอบ</Button>
              {canEdit && <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => void revoke(t.id)} disabled={busy !== null} title="เพิกถอน token"><Trash2 /></Button>}
            </>} />
        ))}
        {lines.filter((l) => l.dept_id === deptId).map((l) => (
          <RouteRow key={l.id} source={l.label} label={l.label} badge={<Badge variant={l.enabled ? 'good' : 'default'}>LINE OA</Badge>}
            note={'(ลูกค้าทัก OA นี้ → แผนกนี้ตอบ · แชทถูกส่งต่อเป็นแหล่งชื่อนี้ · เปลี่ยนแผนกที่ตอบได้ที่หน้า "การเชื่อมต่อ")'}
            extra={<span className="text-[10px] text-dim">คำถาม+คำตอบ</span>} />
        ))}
        {tokens.length === 0 && lines.length === 0 && <Hint className="text-[10px]">ยังไม่มีแหล่งในออฟฟิศ - สร้างด้านล่าง หรือที่ปุ่ม "เชื่อมต่อ" → ขาเข้า</Hint>}
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-7" onClick={() => void fireTest('ทดสอบจากหน้าออฟฟิศ')} disabled={testing !== null || running}>{testing ? <LoaderCircle className="animate-spin" /> : <Send />} ยิงทดสอบเข้าแผนกนี้</Button>
        <span className="text-[10px] text-dim">ส่งข้อมูลตัวอย่างผ่านเส้นทางเดียวกับ webhook จริง (แมสเซนเจอร์มาส่ง → รายงาน → ช่องที่รับ "ทุกแหล่งของแผนก")</span>
      </div>

      {/* ---- เพิ่มแหล่ง ---- */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-box border border-dashed border-ink-500 p-2">
          <span className="text-[11px] text-dim">เพิ่มแหล่ง:</span>
          <Input className="h-7 w-52 px-2 text-[11px]" value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="ชื่อระบบ เช่น gcp-billing" maxLength={60}
            onKeyDown={(e) => { if (e.key === 'Enter' && srcName.trim()) void createToken(); }} />
          <Button size="sm" onClick={createToken} disabled={busy !== null || !srcName.trim()}>{busy === 'token' ? <LoaderCircle className="animate-spin" /> : <KeyRound />} สร้าง token</Button>
          {!srcName.trim() && <span className="text-[10px] text-dim">พิมพ์ชื่อระบบก่อน</span>}
          {err && <span className="text-[11px] text-rug-lite">{err}</span>}
          <InfoTip>ทางลัดสร้างบัตรผ่านใหม่ + ให้แผนกนี้รับทันที (เหมือนสร้างที่หน้า "การเชื่อมต่อ") 1 ระบบ = 1 token ชื่อจะติดเป็น source ทุกครั้งที่ยิงเข้ามา · LINE OA เพิ่มที่หน้า "การเชื่อมต่อ"</InfoTip>
        </div>
      )}
      {fresh && (
        <div className="rounded-box border-2 border-brass/60 bg-wood-deep/50 p-2 text-[11px]">
          <div className="mb-1 text-brass-lite">token ใหม่ - โชว์ครั้งเดียว · ยิงมาที่ URL ด้านล่างพร้อม <code>Authorization: Bearer &lt;token&gt;</code></div>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-box bg-ink-900 px-2 py-1 text-parchment">{fresh}</code>
            <Button size="sm" variant="outline" onClick={() => copy('tok', fresh)}>{copied === 'tok' ? <Check /> : <Copy />}</Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] text-dim">URL รับข้อมูล</span>
        <code className="min-w-0 flex-1 truncate rounded-box border border-ink-600 bg-ink-900 px-2 py-1 text-[11px] text-parchment-2">{url}</code>
        <Button size="sm" variant="outline" onClick={() => copy('url', url)}>{copied === 'url' ? <Check /> : <Copy />}</Button>
        <InfoTip>POST JSON อะไรก็ได้ - ห่อเป็น <code>{'{ title, source, ask, data, intent, deliver, idempotencyKey, wait }'}</code> หรือไม่ห่อ (ทั้งก้อน = data) · ตอบ 202 ทันที ดูสถานะที่ <code>?id=</code></InfoTip>
      </div>


      {/* ---- ที่เข้ามาล่าสุด ---- */}
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">ที่เข้ามาล่าสุด</div>
      {rows.length === 0 ? <Hint className="text-[10px]">ยังไม่มีอะไรยิงเข้ามา</Hint> : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.id} className="rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px]">
              <div className="flex items-center gap-2">
                <Badge variant={r.status === 'done' ? 'good' : r.status === 'error' ? 'bad' : r.status === 'running' ? 'brass' : 'default'}>{r.status}</Badge>
                <span className="truncate text-parchment">{r.title || '(ไม่มีหัวข้อ)'}</span>
                <span className="text-dim">← {r.source}</span>
                <span className="ml-auto shrink-0 text-dim">{new Date(r.created_at).toLocaleString('th-TH')}</span>
              </div>
              {r.answer && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-parchment-2">{r.answer}</p>}
              {r.error && <p className="mt-0.5 text-rug-lite">{r.error}</p>}
              <p className="mt-0.5 text-[10px] text-dim">
                {r.delivered?.length ? `→ ${r.delivered.map((d) => `${d.label || d.kind}${d.ok ? ' ✓' : ` ✗ ${d.error ?? ''}`}`).join(' · ')}` : (r.status === 'done' ? '→ ไม่ได้ส่งออก (ไม่มีช่องผูกกับแหล่งนี้)' : '')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-[11px] text-rug-lite">{err}</p>}
    </div>
  );
}
