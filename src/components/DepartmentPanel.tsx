'use client';

import {
  Building2, Check, Copy, Inbox, KeyRound, LoaderCircle, Plus, Send, Sparkles, Trash2, Webhook, Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { InfoTip } from '@/components/ui/infotip';
import { Hint } from '@/components/ui/panel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RoutingTab from '@/components/RoutingTab';
import {
  DEPARTMENTS, DEPT_BY_ID, DEPT_ID_RE, MAX_PLAYBOOK_CHARS, MAX_SKILL_CHARS, PRESET_BY_ID, ROLES, ROLE_ORDER, sanitizeDeptDef,
  slugifyDeptId, type AgentRole, type DepartmentDef,
} from '@/lib/departments';
import { t } from '@/lib/i18n';
import {
  accessToken, deleteChannel, listChannels, listInbox, saveChannel, sbError,
  type ChannelKind, type DeptChannel, type InboxRow,
} from '@/lib/supabase';

/* ============================================================
   แผนก - สร้าง/แก้แผนกได้อิสระ (ชื่ออะไรก็ได้ หน้าที่อะไรก็ได้)
     แท็บ "แผนก"     ชื่อ สี หน้าที่ (ภาษาคน) + ปุ่มให้ AI ร่างที่เหลือทั้งหมด
     แท็บ "สกิล"     สกิล markdown ที่ agent ทุกคนในแผนกอ่าน + มุมมอง 4 บทบาท + keywords
     แท็บ "Webhook"  URL รับข้อมูลเข้า (inbox) + token + playbook + รายการที่เข้ามาล่าสุด
     แท็บ "ส่งออก"    channel ที่แผนกจะเอารายงานไปโพสต์ (Teams / Slack / Discord / LINE / webhook)
   preset (6 แผนกเดิม) แก้ได้เหมือนกัน - ที่แก้ถูกเก็บเป็นแถวทับในออฟฟิศ ลบแถวนั้น = กลับเป็นค่าเดิม
   ============================================================ */

interface TokenRow { id: string; name: string; scope?: string; dept_ids?: string[]; created_at: string; last_used_at: string | null }

interface Props {
  open: boolean;
  onClose: () => void;
  /** null = สร้างแผนกใหม่ */
  deptId: string | null;
  officeId: string | null;
  canEdit: boolean;
  /** header คีย์ LLM ที่ใช้อยู่ - ให้ AI ร่างแผนก */
  llmHeaders: Record<string, string>;
  /** จำนวนพนักงานในแผนกนี้ - มีคนอยู่ลบไม่ได้ */
  headcount: number;
  onSave: (def: DepartmentDef) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** กลับไปหน้ารวมแผนก */
  onBack?: () => void;
  /** แสดงในแท็บของแผงขวา (ไม่มี dialog/แถบข้าง) */
  inline?: boolean;
}

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  teams: 'Microsoft Teams (Incoming Webhook / Workflows)',
  slack: 'Slack (Incoming Webhook)',
  discord: 'Discord (Webhook)',
  line: 'LINE (Messaging API push)',
  webhook: 'Webhook ทั่วไป (POST JSON)',
};
const COLORS = ['#9a5fc0', '#3fa06a', '#4a7fd0', '#e0a13f', '#e07aa8', '#5cbcc8', '#d9534f', '#8bc34a', '#ff8a3d', '#7986cb', '#26a69a', '#c0a060'];

const emptyDef = (): DepartmentDef => ({ id: '', nameTh: '', shortTh: '', color: COLORS[6], description: '', keywords: [], lenses: {}, skillText: '', playbook: '' });

export default function DepartmentPanel({ open, onClose, deptId, officeId, canEdit, llmHeaders, headcount, onSave, onDelete, onBack, inline = false }: Props) {
  const isNew = !deptId;
  const preset = deptId ? PRESET_BY_ID.get(deptId) : undefined;
  const [tab, setTab] = useState('main');
  const [def, setDef] = useState<DepartmentDef>(emptyDef());
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'save' | 'delete' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // โหลดค่าเดิมทุกครั้งที่เปิด
  useEffect(() => {
    if (!open) return;
    setErr(null); setOk(null); setBusy(null); setTab('main'); setIdTouched(!!deptId);
    const cur = deptId ? DEPT_BY_ID.get(deptId) : undefined;
    setDef(cur ? {
      id: cur.id, nameTh: cur.nameTh, shortTh: cur.shortTh, color: cur.color, description: cur.description ?? '',
      keywords: [...cur.keywords], lenses: { ...cur.lenses }, skillText: cur.skillText ?? '', playbook: cur.playbook ?? '',
    } : emptyDef());
  }, [open, deptId]);

  const set = <K extends keyof DepartmentDef>(k: K, v: DepartmentDef[K]) => setDef((d) => ({ ...d, [k]: v }));
  const setLens = (r: AgentRole, v: string) => setDef((d) => ({ ...d, lenses: { ...(d.lenses ?? {}), [r]: v } }));
  // id ตามชื่อจนกว่าผู้ใช้จะแตะช่อง id เอง
  const onName = (v: string) => { set('nameTh', v); if (!idTouched) set('id', slugifyDeptId(v)); };

  const idOk = DEPT_ID_RE.test(def.id);
  const idTaken = isNew && DEPT_BY_ID.has(def.id);
  const canSave = canEdit && !!def.nameTh.trim() && idOk && !idTaken && busy === null;

  const draft = async () => {
    if (!def.nameTh.trim()) { setErr(t('ใส่ชื่อแผนกก่อน')); return; }
    setBusy('draft'); setErr(null); setOk(null);
    try {
      const res = await fetch('/api/department/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...llmHeaders },
        body: JSON.stringify({ name: def.nameTh, description: def.description, existingIds: [...DEPT_BY_ID.keys()], ...(isNew ? {} : { id: def.id }), officeId: officeId ?? undefined }),
      });
      const data = (await res.json()) as { draft?: DepartmentDef; error?: string };
      if (!res.ok || !data.draft) throw new Error(data.error ?? `HTTP ${res.status}`);
      const d = data.draft;
      setDef((cur) => ({
        ...cur,
        id: isNew && !idTouched ? d.id : cur.id,
        shortTh: d.shortTh || cur.shortTh,
        color: isNew ? (d.color || cur.color) : cur.color,
        keywords: d.keywords?.length ? d.keywords : cur.keywords,
        lenses: { ...(cur.lenses ?? {}), ...(d.lenses ?? {}) },
        skillText: d.skillText || cur.skillText,
        playbook: d.playbook || cur.playbook,
      }));
      setOk(t('AI ร่างให้แล้ว - ตรวจแท็บ "สกิล" และ "Webhook" แล้วกดบันทึก'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const save = async () => {
    const clean = sanitizeDeptDef({ ...def, shortTh: def.shortTh || def.nameTh.slice(0, 12) });
    if (!clean) { setErr(t('ข้อมูลไม่ครบ - ต้องมีชื่อ และ id เป็น a-z 0-9 ขีด (2-32 ตัว)')); return; }
    setBusy('save'); setErr(null); setOk(null);
    try {
      await onSave(clean);
      setOk(t('บันทึกแล้ว'));
      if (isNew) onClose();
    } catch (e) {
      setErr(sbError(e));
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!deptId) return;
    setBusy('delete'); setErr(null);
    try { await onDelete(deptId); onClose(); } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
  };

  const overrideOfPreset = !!preset;
  const body = (
    <>
        {inline && (
          <div className="flex items-center gap-2 text-[12px] font-semibold text-parchment">
            {onBack && <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onBack} title={t('กลับไปรายการแผนก')}>←</Button>}
            <Building2 className="size-3.5" /> {isNew ? t('สร้างแผนกใหม่') : t('แผนก: {name}', { name: t(def.nameTh) || deptId || '' })}
          </div>
        )}
        {!canEdit && (
          <p className="rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px] text-dim">{t('อ่านได้อย่างเดียว - เจ้าของหรือ exec ของออฟฟิศเท่านั้นที่แก้แผนกได้')}</p>
        )}
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
          <TabsList className="rounded-t-box border border-b-0 border-wood-deep">
            <TabsTrigger value="main"><Building2 /> {t('ข้อมูลแผนก')}</TabsTrigger>
            <TabsTrigger value="skill"><Sparkles /> {t('สกิล')}</TabsTrigger>
            <TabsTrigger value="inbox" disabled={isNew}><Inbox /> {t('ขาเข้า')}</TabsTrigger>
            <TabsTrigger value="out" disabled={isNew}><Send /> {t('ขาออก')}</TabsTrigger>
          </TabsList>

          {/* ---------- แผนก ---------- */}
          <TabsContent value="main" className="min-h-0">
            <div className={`flex flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5 ${inline ? '' : 'max-h-[56vh]'}`}>
              {overrideOfPreset && (
                <div className="flex items-center gap-1.5 text-[11px] text-dim">
                  <Badge>{t('แผนกมาตรฐาน')}</Badge>
                  <InfoTip>{t('ค่าที่แก้ในหน้านี้ถูกเก็บเป็นค่าทับของออฟฟิศนี้เท่านั้น สกิลเดิมอยู่ใน')} <code>skills/{preset!.skill}.md</code> {t('- ปุ่ม "คืนค่าเดิม" ล้างค่าทับทั้งหมด')}</InfoTip>
                </div>
              )}
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Field label={t('ชื่อแผนก')}>
                  <Input value={def.nameTh} onChange={(e) => onName(e.target.value)} placeholder={t('เช่น IT Support, บัญชี GCP, Data Team')} disabled={!canEdit} maxLength={60} />
                </Field>
                <Field label={t('ชื่อย่อ (ป้าย)')}>
                  <Input value={def.shortTh} onChange={(e) => set('shortTh', e.target.value)} placeholder={def.nameTh.slice(0, 12) || t('ย่อ')} disabled={!canEdit} maxLength={20} />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Field label="id" info={t('ใช้ใน URL ของ webhook และ API (a-z 0-9 ขีดกลาง/ล่าง 2-32 ตัว) - ตั้งครั้งเดียว เปลี่ยนทีหลังไม่ได้ ระบบตั้งจากชื่อให้อัตโนมัติ')} hint={idTaken ? t('id นี้มีอยู่แล้ว') : !idOk && def.id ? t('ใช้ได้เฉพาะ a-z 0-9 ขีดกลาง/ล่าง 2-32 ตัว') : undefined}>
                  <Input value={def.id} onChange={(e) => { setIdTouched(true); set('id', e.target.value.toLowerCase()); }} disabled={!canEdit || !isNew} placeholder="it-support" className={idTaken || (def.id && !idOk) ? 'border-rug' : ''} />
                </Field>
                <Field label={t('สี')}>
                  <div className="flex flex-wrap gap-1 pt-1" style={{ maxWidth: 150 }}>
                    {COLORS.map((c) => (
                      <button key={c} type="button" disabled={!canEdit} onClick={() => set('color', c)} title={c}
                        className={`size-5 rounded-box border-2 ${def.color === c ? 'border-parchment' : 'border-transparent'}`} style={{ background: c }} />
                    ))}
                  </div>
                </Field>
              </div>
              <Field
                label={t('หน้าที่ของแผนก')}
                info={t('เขียนเหมือนอธิบายให้พนักงานใหม่ฟัง ใช้ 3 อย่าง: AI ร่างสกิล/มุมมอง/keywords/playbook จากตรงนี้ · เลขาฯ ใช้ตัดสินว่าคำถามไหนควรส่งมาแผนกนี้ · เป็นสกิลมาตรฐานถ้ายังไม่มีสกิล')}
              >
                <Textarea rows={5} value={def.description ?? ''} onChange={(e) => set('description', e.target.value)} disabled={!canEdit} maxLength={1000}
                  placeholder={t('เช่น รับ bug report จาก logger ของระบบ จัดระดับความรุนแรง (low/medium/high/critical) สรุปว่ากระทบใคร แนะนำขั้นตอนแก้เบื้องต้น ถ้า high ขึ้นไปให้แจ้งทีมทันที และสรุปรายวันว่ามีอะไรค้าง')} />
              </Field>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" onClick={draft} disabled={!canEdit || busy !== null || !def.nameTh.trim()}>
                  {busy === 'draft' ? <LoaderCircle className="animate-spin" /> : <Wand2 />} {t('ให้ AI ร่างที่เหลือ')}
                </Button>
                <InfoTip>{t('ใช้คีย์ AI ที่เลือกอยู่ ร่างสกิล มุมมอง 4 บทบาท keywords และ playbook จากชื่อ + หน้าที่ แก้ได้ทุกช่องก่อนบันทึก - ไม่กดก็ได้ ระบบใช้สกิลมาตรฐานให้')}</InfoTip>
              </div>
            </div>
          </TabsContent>

          {/* ---------- สกิล ---------- */}
          <TabsContent value="skill" className="min-h-0">
            <div className={`flex flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5 ${inline ? '' : 'max-h-[56vh]'}`}>
              <Field
                label={<span className="flex flex-1 items-center gap-2">{t('สกิล')} <span className="ml-auto text-[10px] font-normal text-dim">{(def.skillText ?? '').length}/{MAX_SKILL_CHARS}</span></span>}
                info={<>{t('markdown ที่ agent ทุกคนในแผนกอ่านก่อนตอบ (วางไว้ต้น system prompt)')} {overrideOfPreset ? <>{t('ว่าง = ใช้')} <code>skills/{preset!.skill}.md</code>{t('ของเดิม')}</> : t('ว่าง = ใช้สกิลมาตรฐานที่ประกอบจากชื่อ + หน้าที่ + playbook')}</>}
              >
                <Textarea rows={12} className="font-mono text-[11px]" value={def.skillText ?? ''} onChange={(e) => set('skillText', e.target.value)} disabled={!canEdit} maxLength={MAX_SKILL_CHARS}
                  placeholder={t('# Skill: ...\n\n## หน้าที่\n\n## หลักการทำงาน\n\n## ขอบเขต\n\n## รูปแบบคำตอบ')} />
              </Field>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">{t('มุมมองต่อบทบาท')} <InfoTip>{t('คนที่ 1-4 ของแผนกได้บทบาทผู้เสนอ/ผู้ค้าน/ผู้ตรวจสอบ/ผู้ดูความเป็นไปได้ตามลำดับ - มุมมองตรงนี้บอกว่าแต่ละบทบาทต้องมองเรื่องจากมุมไหน ทำให้ 4 คนในแผนกเดียวกันไม่พูดเหมือนกัน')}</InfoTip></div>
              {ROLE_ORDER.map((r) => (
                <Field key={r} label={t(ROLES[r].th)}>
                  <Input value={def.lenses?.[r] ?? ''} onChange={(e) => setLens(r, e.target.value)} disabled={!canEdit} maxLength={300} placeholder={preset?.lenses[r] ?? t('มุมที่คนบทบาทนี้ต้องมองเป็นหลัก')} />
                </Field>
              ))}
              <Field label="keywords" info={t('คั่นด้วยจุลภาค - ใช้เลือกแผนกจากคำในคำถามเฉพาะตอนไม่มีคีย์ AI (มีคีย์ เลขาฯ อ่านจากหน้าที่ + มุมมองแทน) ไม่บังคับ')}>
                <Input value={(def.keywords ?? []).join(', ')} onChange={(e) => set('keywords', e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 40))} disabled={!canEdit} />
              </Field>
            </div>
          </TabsContent>

          {/* ---------- Webhook เข้า ---------- */}
          <TabsContent value="inbox" className="min-h-0">
            <div className={`flex flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5 ${inline ? '' : 'max-h-[56vh]'}`}>
              <Field
                label={<span className="flex flex-1 items-center gap-2">Playbook <span className="ml-auto text-[10px] font-normal text-dim">{(def.playbook ?? '').length}/{MAX_PLAYBOOK_CHARS}</span></span>}
                info={t('สิ่งที่แผนกต้องทำเมื่อมีข้อมูลยิงเข้ามาทาง webhook - หัวหน้าแผนกอ่าน playbook พร้อมข้อมูล แล้วเขียนรายงาน/ตัดสินใจตามนั้น ข้อมูลที่เข้ามาถือเป็นข้อมูล ไม่ใช่คำสั่ง')}
              >
                <Textarea rows={3} value={def.playbook ?? ''} onChange={(e) => set('playbook', e.target.value)} disabled={!canEdit} maxLength={MAX_PLAYBOOK_CHARS}
                  placeholder={t('1. อ่านข้อมูล จัดระดับความรุนแรง\n2. สรุป: เกิดอะไร กระทบใคร ต้องทำอะไรใน 24 ชม.\n3. ถ้า severity ≥ high ระบุ "แจ้งทีมทันที" ไว้บรรทัดแรก\n4. ตอบสั้น อ่านในแชทได้จบใน 10 บรรทัด')} />
              </Field>
              {!isNew && officeId ? <RoutingTab officeId={officeId} deptId={def.id} canEdit={canEdit} part="in" /> : (
                <Hint>{t('ใช้ได้เมื่อล็อกอินและเลือกออฟฟิศ')} <InfoTip>{t('ต้องตั้ง Supabase และ SUPABASE_SECRET_KEY บนเซิร์ฟเวอร์ - webhook เข้าเก็บและประมวลผลฝั่งเซิร์ฟเวอร์')}</InfoTip></Hint>
              )}
            </div>
          </TabsContent>

          {/* ---------- ขาออก ---------- */}
          <TabsContent value="out" className="min-h-0">
            <div className={`flex flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5 ${inline ? '' : 'max-h-[56vh]'}`}>
              {!isNew && officeId ? <RoutingTab officeId={officeId} deptId={def.id} canEdit={canEdit} part="out" /> : (
                <Hint>{t('ใช้ได้เมื่อล็อกอินและเลือกออฟฟิศ')}</Hint>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {(err || ok) && (
          <p className={`rounded-box border px-2 py-1 text-[11px] ${err ? 'border-rug-dark bg-[#3f2018] text-rug-lite' : 'border-carpet-dark bg-[#22401f] text-carpet-lite'}`}>{err ?? ok}</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          {onBack && !inline && <Button size="sm" variant="outline" onClick={onBack} title={t('กลับไปหน้ารวมแผนก')}>← {t('แผนกทั้งหมด')}</Button>}
          {!isNew && canEdit && (
            <Button size="sm" variant="danger" onClick={remove} disabled={busy !== null || (!overrideOfPreset && headcount > 0)}
              title={!overrideOfPreset && headcount > 0 ? t('มีพนักงาน {n} คนอยู่ - เลิกจ้างก่อน', { n: headcount }) : overrideOfPreset ? t('ล้างค่าทับ กลับเป็นแผนกมาตรฐาน') : t('ลบแผนกนี้ (พร้อม channel/webhook ของมัน)')}>
              {busy === 'delete' ? <LoaderCircle className="animate-spin" /> : <Trash2 />} {overrideOfPreset ? t('คืนค่าเดิม') : t('ลบแผนก')}
            </Button>
          )}
          <span className="flex-1" />
          {!inline && <Button size="sm" variant="outline" onClick={onClose}>{t('ปิด')}</Button>}
          <Button size="sm" variant="primary" onClick={save} disabled={!canSave}>
            {busy === 'save' ? <LoaderCircle className="animate-spin" /> : <Check />} {isNew ? t('สร้างแผนก') : t('บันทึก')}
          </Button>
        </div>
    </>
  );
  if (inline) return open ? body : null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent icon={<Building2 />} title={isNew ? t('สร้างแผนกใหม่') : t('แผนก: {name}', { name: t(def.nameTh) || deptId || '' })} description={t('ตั้งชื่อ หน้าที่ สกิล และช่องทางเข้า-ออกของแผนก')} wide>
        {body}
      </DialogContent>
    </Dialog>
  );
}


/* ============================================================
   ขาเข้าแบบ LINE Official Account - ลูกค้าทัก LINE แล้วแผนกนี้ตอบ (customer flow)
   secret/token ส่งไปเก็บผ่าน API (เข้ารหัสฝั่งเซิร์ฟเวอร์) หน้าเว็บไม่เห็นค่าจริงอีก
   ============================================================ */
interface InboundMasked { id: string; dept_id: string; kind: string; label: string; enabled: boolean; created_at: string; hasSecret: boolean; hasToken: boolean; ack: string }

export function LineInboundSection({ officeId, deptId, canEdit }: { officeId: string; deptId: string; canEdit: boolean }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  /** deptId '*' = โหมดออฟฟิศ (หน้า "เชื่อมต่อ"): เห็นทุก OA และเลือกแผนกที่ตอบได้ */
  const all = deptId === '*';
  const [pickDept, setPickDept] = useState<string>('');
  const [rows, setRows] = useState<InboundMasked[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InboundMasked | null>(null);
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [ack, setAck] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const hdr = async () => {
    const t = await accessToken();
    return { 'Content-Type': 'application/json', ...(t ? { 'x-sb-token': t } : {}) };
  };
  const load = async () => {
    try {
      const res = await fetch(`/api/office/inbound?officeId=${officeId}${all ? '' : `&deptId=${deptId}`}`, { headers: await hdr() });
      const data = (await res.json()) as { inbound?: InboundMasked[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRows(data.inbound ?? []);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, [officeId, deptId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setEditing(null); setLabel(''); setSecret(''); setToken(''); setAck(''); setOpen(false); };
  const startEdit = (r: InboundMasked) => { setEditing(r); setLabel(r.label); setSecret(''); setToken(''); setAck(r.ack); setPickDept(r.dept_id); setOpen(true); setErr(null); };
  const save = async () => {
    const target = all ? pickDept : deptId;
    if (!target) { setErr(t('เลือกแผนกที่จะตอบลูกค้าก่อน')); return; }
    setBusy('save'); setErr(null);
    try {
      const res = await fetch('/api/office/inbound', {
        method: 'POST', headers: await hdr(),
        body: JSON.stringify({ officeId, deptId: target, ...(editing ? { id: editing.id } : {}), label, secret, token, ack }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      reset();
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const toggle = async (r: InboundMasked) => {
    setBusy(r.id); setErr(null);
    try {
      const res = await fetch('/api/office/inbound', { method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId, deptId: r.dept_id, id: r.id, label: r.label, enabled: !r.enabled }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const remove = async (id: string) => {
    setBusy(id); setErr(null);
    try {
      const res = await fetch('/api/office/inbound', { method: 'DELETE', headers: await hdr(), body: JSON.stringify({ officeId, id }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const copy = async (k: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* ไม่มี clipboard */ }
  };
  const canSave = !!(editing ? true : secret.trim() && token.trim());

  return (
    <div className="flex flex-col gap-1.5 rounded-box border border-ink-600 bg-ink-900/40 p-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
          LINE Official Account
          <InfoTip>
            {t('ลูกค้าทัก LINE OA แล้ว')}<b>{t('แผนกนี้')}</b>{t('ตอบ (ตอบรับทันที แล้ว push คำตอบจริงตาม - ลูกค้าเห็นเฉพาะข้อมูลสาธารณะ)')}<br />
            {t('ค่าจาก LINE Developers → channel:')} <b>Basic settings → Channel secret</b> {t('และ')} <b>Messaging API → Channel access token (long-lived)</b><br />
            {t('บันทึกแล้วจะได้ Webhook URL ไปวางใน Messaging API → Webhook URL → Verify → เปิด Use webhook · ปิด Auto-reply ของ OA ด้วย')}<br />
            {t('token เดียวกันถูกใช้กับช่องส่งออกแบบ LINE ของแผนกนี้ให้อัตโนมัติ')}
          </InfoTip>
        </span>
        <span className="flex-1" />
        {canEdit && !open && <Button size="sm" variant="outline" onClick={() => { reset(); setOpen(true); }}><Plus /> {t('เพิ่ม LINE OA')}</Button>}
      </div>
      {rows.length === 0 && !open && <Hint className="text-[10px]">{t('ยังไม่ได้ผูก LINE OA กับแผนกนี้')}</Hint>}
      {rows.map((r) => {
        const url = `${origin}/api/line/webhook/${r.id}`;
        return (
          <div key={r.id} className={`flex flex-col gap-1 rounded-box border bg-ink-700 px-2 py-1 text-[11px] ${editing?.id === r.id ? 'border-brass' : 'border-ink-600'}`}>
            <div className="flex items-center gap-2">
              <Badge variant={r.enabled ? 'good' : 'default'}>LINE</Badge>
              <span className="text-parchment">{r.label}</span>
              {all && <span className="text-[10px] text-dim">→ {t('ตอบโดย')} {t(DEPT_BY_ID.get(r.dept_id)?.nameTh ?? r.dept_id)}</span>}
              {(!r.hasSecret || !r.hasToken) && <Badge variant="bad">{t('secret/token ไม่ครบ')}</Badge>}
              <span className="flex-1" />
              {canEdit && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(r)} disabled={busy !== null}>{t('แก้ไข')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(r)} disabled={busy !== null}>{r.enabled ? t('ปิด') : t('เปิด')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r.id)} disabled={busy !== null} title={t('ลบ')}><Trash2 /></Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-dim">Webhook URL</span>
              <code className="min-w-0 flex-1 truncate rounded-box bg-ink-900 px-2 py-0.5 text-parchment-2">{url}</code>
              <Button size="sm" variant="outline" onClick={() => copy(r.id, url)}>{copied === r.id ? <Check /> : <Copy />}</Button>
            </div>
          </div>
        );
      })}
      {open && canEdit && (
        <div className="flex flex-col gap-1.5 rounded-box border border-dashed border-ink-500 p-2">
          {all && (
            <Field label={t('แผนกที่ตอบลูกค้าจาก OA นี้')}>
              <div className="flex flex-wrap gap-1">
                {DEPARTMENTS.map((d) => (
                  <button key={d.id} type="button" onClick={() => setPickDept(d.id)}
                    className={`rounded-box border px-2 py-0.5 text-[11px] ${pickDept === d.id ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>{t(d.nameTh)}</button>
                ))}
              </div>
            </Field>
          )}
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Field label={t('ชื่อเรียก')}><Input className="h-8" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('เช่น LINE ร้านหลัก')} maxLength={80} /></Field>
            <Field label={t('ข้อความตอบรับทันที')} info={t('ส่งกลับทันทีที่ลูกค้าทัก ระหว่างรอคำตอบจริง - ว่าง = ใช้ข้อความมาตรฐาน')}>
              <Input className="h-8" value={ack} onChange={(e) => setAck(e.target.value)} placeholder={t('รับเรื่องแล้วค่ะ กำลังหาข้อมูลให้ สักครู่นะคะ')} maxLength={300} />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Field label="Channel secret" info="LINE Developers → channel → Basic settings → Channel secret" hint={editing ? t('ว่าง = คงค่าเดิม') : undefined}>
              <Input className="h-8" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </Field>
            <Field label="Channel access token" info="LINE Developers → Messaging API → Channel access token (long-lived) → Issue" hint={editing ? t('ว่าง = คงค่าเดิม') : undefined}>
              <Input className="h-8" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={save} disabled={busy !== null || !canSave}>{busy === 'save' ? <LoaderCircle className="animate-spin" /> : <Check />} {editing ? t('บันทึกการแก้ไข') : t('บันทึก')}</Button>
            <Button size="sm" variant="outline" onClick={reset} disabled={busy !== null}>{t('ยกเลิก')}</Button>
            {!editing && <span className="text-[10px] text-dim">{t('บันทึกแล้วจะได้ Webhook URL ไปวางใน LINE console')}</span>}
          </div>
        </div>
      )}
      {err && <p className="text-[11px] text-rug-lite">{err}</p>}
    </div>
  );
}

/* ============================================================
   Webhook เข้า: URL + token + รายการล่าสุด
   ============================================================ */
function InboxSection({ officeId, deptId, canEdit }: { officeId: string; deptId: string; canEdit: boolean }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/api/office/inbox/${deptId}`;
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<InboxRow[]>([]);
  /** ชื่อแหล่งข้อมูลของ token ที่จะสร้าง (เช่น gcp-billing) - ใช้เป็น source ของทุกอย่างที่ยิงผ่าน token นี้ */
  const [srcName, setSrcName] = useState('');

  const hdr = async () => {
    const t = await accessToken();
    return { 'Content-Type': 'application/json', ...(t ? { 'x-sb-token': t } : {}) };
  };
  const load = async () => {
    try {
      const res = await fetch(`/api/office/token?officeId=${officeId}`, { headers: await hdr() });
      const data = (await res.json()) as { tokens?: TokenRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTokens((data.tokens ?? []).filter((t) => t.scope === 'inbox' && (t.dept_ids ?? []).includes(deptId)));
    } catch (e) { setTokens([]); setErr(e instanceof Error ? e.message : String(e)); }
    try { setRows((await listInbox(officeId, 100)).filter((r) => r.dept_id === deptId).slice(0, 20)); } catch { /* ตารางยังไม่มี */ }
  };
  useEffect(() => { void load(); }, [officeId, deptId]); // eslint-disable-line react-hooks/exhaustive-deps
  // มีรายการที่ยังทำงานอยู่ -> ตามดูทุก 3 วิ (โมเดลในเครื่องอาจใช้เวลาเป็นนาที)
  const running = rows.some((r) => r.status === 'received' || r.status === 'running');
  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(iv);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const [testing, setTesting] = useState(false);
  const fireTest = async () => {
    setTesting(true); setErr(null);
    try {
      // ยิงในนามแหล่งที่พิมพ์ไว้ (ถ้ามี) - จะได้ทดสอบว่าช่องส่งออกที่กรองแหล่งรับถูกไหม
      const res = await fetch('/api/office/inbox/test', { method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId, deptId, source: srcName.trim() || undefined }) });
      const data = (await res.json()) as { inboxId?: string; error?: string };
      if (!res.ok || !data.inboxId) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setTesting(false); }
  };

  const create = async () => {
    setBusy(true); setErr(null); setFresh(null);
    try {
      const res = await fetch('/api/office/token', {
        method: 'POST', headers: await hdr(), body: JSON.stringify({ officeId, name: srcName.trim() || `inbox ${deptId}`, scope: 'inbox', deptIds: [deptId] }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFresh(data.token);
      setSrcName('');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/office/token', { method: 'DELETE', headers: await hdr(), body: JSON.stringify({ officeId, id }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const copy = async (k: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* ไม่มี clipboard */ }
  };
  const curl = `curl -X POST "${url}" \\
  -H "Authorization: Bearer ${fresh ?? '<token>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"${t('ตัวอย่าง')}","source":"my-service","ask":"${t('สรุปให้หน่อย')}","data":{"anything":"here"}}'`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
        {t('URL รับข้อมูลเข้า')}
        <InfoTip>
          {t('POST JSON มาที่ URL นี้พร้อม')} <code>Authorization: Bearer &lt;token&gt;</code><br />
          {t('ห่อเป็น')} <code>{'{ title, source, ask, data, intent:"note"|"task", deliver, idempotencyKey, wait }'}</code> {t('หรือไม่ห่อก็ได้ (ทั้งก้อน = data)')}<br />
          {t('ตอบ 202 ทันที หัวหน้าแผนกทำงานต่อ - ดูสถานะที่')} <code>?id=</code> {t('· ผลถูกส่งออกไปทุกช่องในแท็บ "ส่งออก"')}
        </InfoTip>
      </div>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-box border border-ink-600 bg-ink-900 px-2 py-1 text-[11px] text-parchment-2">{url}</code>
        <Button size="sm" variant="outline" onClick={() => copy('url', url)}>{copied === 'url' ? <Check /> : <Copy />}</Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
          {t('token ต่อแหล่งข้อมูล')}
          <InfoTip>{t('ตั้งชื่อตามระบบที่จะเรียกเข้ามา (gcp-billing, sentry, n8n ...) แล้วสร้าง token ให้ระบบนั้นโดยเฉพาะ - สร้างได้หลายอัน')}<br />
            {t('ทุกอย่างที่ยิงผ่าน token ไหนจะติด source = ชื่อนั้นอัตโนมัติ (เห็นในรายการด้านล่าง ในสมุดเลขาฯ และใช้เลือกช่องส่งออก) เพิกถอนทีละอันได้โดยไม่กระทบระบบอื่น')}<br />
            {t('token ยิงเข้าได้เฉพาะแผนกนี้ โชว์ครั้งเดียว หายแล้วสร้างใหม่')}</InfoTip>
        </span>
        {canEdit && (
          <>
            <Input className="h-7 w-52 px-2 text-[11px]" value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder={t('ชื่อระบบที่จะเรียกเข้ามา เช่น gcp-billing')} maxLength={60}
              onKeyDown={(e) => { if (e.key === 'Enter' && srcName.trim()) void create(); }} />
            <Button size="sm" onClick={create} disabled={busy || !srcName.trim()} title={srcName.trim() ? t('สร้าง token ชื่อ "{name}"', { name: srcName.trim() }) : t('ตั้งชื่อก่อน')}><KeyRound /> {t('สร้าง token')}</Button>
          </>
        )}
      </div>
      {fresh && (
        <div className="rounded-box border-2 border-brass/60 bg-wood-deep/50 p-2 text-[11px]">
          <div className="mb-1 text-brass-lite">{tokens?.[0] ? t('token ใหม่ สำหรับ "{name}" - โชว์ครั้งเดียว', { name: tokens[0].name }) : t('token ใหม่ - โชว์ครั้งเดียว')}</div>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-box bg-ink-900 px-2 py-1 text-parchment">{fresh}</code>
            <Button size="sm" variant="outline" onClick={() => copy('tok', fresh)}>{copied === 'tok' ? <Check /> : <Copy />}</Button>
          </div>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col gap-1">
          <li className="text-[10px] text-dim">{t('token ที่ใช้อยู่ {n} อัน (แต่ละอัน = 1 ระบบที่เรียกเข้ามา)', { n: tokens.length })}</li>
          {tokens.map((tk) => (
            <li key={tk.id} className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px]">
              <KeyRound className="size-3 text-dim" />
              <span className="text-parchment">{tk.name}</span>
              <span className="text-dim">{t('สร้าง {date}', { date: new Date(tk.created_at).toLocaleDateString('th-TH') })}{tk.last_used_at ? ` · ${t('ใช้ล่าสุด {date}', { date: new Date(tk.last_used_at).toLocaleString('th-TH') })}` : ` · ${t('ยังไม่เคยใช้')}`}</span>
              <span className="flex-1" />
              {canEdit && <Button size="sm" variant="ghost" onClick={() => revoke(tk.id)} disabled={busy} title={t('เพิกถอน')}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-box border border-ink-600 bg-ink-900 p-2 text-[11px]">
        <summary className="cursor-pointer text-dim">{t('ตัวอย่าง curl')}</summary>
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-parchment-2">{curl}</pre>
      </details>
      {err && <p className="text-[11px] text-rug-lite">{err}</p>}

      <div className="mt-1 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
          {t('ที่เข้ามาล่าสุด')}
          {running && <LoaderCircle className="size-3 animate-spin text-brass" />}
        </span>
        <span className="flex-1" />
        {canEdit && (
          <Button size="sm" variant="outline" onClick={fireTest} disabled={testing || running} title={srcName.trim() ? t('ส่งข้อมูลตัวอย่างเข้าแผนกนี้ผ่านเส้นทางเดียวกับ webhook จริง ในนามแหล่ง "{name}" แล้วดูผลด้านล่าง (ส่งออกไปช่องที่รับแหล่งนี้)', { name: srcName.trim() }) : t('ส่งข้อมูลตัวอย่างเข้าแผนกนี้ผ่านเส้นทางเดียวกับ webhook จริง แล้วดูผลด้านล่าง (ส่งออกไปช่องที่รับแหล่งนี้)')}>
            {testing ? <LoaderCircle className="animate-spin" /> : <Send />} {t('ยิงทดสอบ')}
          </Button>
        )}
      </div>
      {rows.length === 0 ? <Hint className="text-[10px]">{t('ยังไม่มีอะไรยิงเข้ามา')}</Hint> : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.id} className="rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px]">
              <div className="flex items-center gap-2">
                <Badge variant={r.status === 'done' ? 'good' : r.status === 'error' ? 'bad' : r.status === 'running' ? 'brass' : 'default'}>{r.status}</Badge>
                <span className="truncate text-parchment">{r.title || t('(ไม่มีหัวข้อ)')}</span>
                <span className="text-dim">{r.source}</span>
                <span className="ml-auto shrink-0 text-dim">{new Date(r.created_at).toLocaleString('th-TH')}</span>
              </div>
              {r.answer && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-parchment-2">{r.answer}</p>}
              {r.error && <p className="mt-0.5 text-rug-lite">{r.error}</p>}
              {r.delivered?.length > 0 && (
                <p className="mt-0.5 text-[10px] text-dim">{t('ส่งออก:')} {r.delivered.map((d) => `${d.kind}${d.ok ? ' ✓' : ` ✗ ${d.error ?? ''}`}`).join(' · ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   ส่งออก: channel ของแผนก
   ============================================================ */
export function ChannelSection({ officeId, deptId, canEdit, compact = false, onChanged, rowExtra }: {
  officeId: string; deptId: string; canEdit: boolean; compact?: boolean; onChanged?: () => void;
  /** เนื้อหาเพิ่มใต้แต่ละแถวช่อง (เช่น ชิป "รับจากแหล่งไหน") */
  rowExtra?: (c: DeptChannel) => React.ReactNode;
}) {
  /** deptId '*' = คลังช่องส่งออกของออฟฟิศ (ทุกช่อง) - การผูกกับแผนก/แหล่งทำที่แท็บ "เข้า → ออก" ของแผนก */
  const shared = deptId === '*';
  const [sharedRows, setSharedRows] = useState<DeptChannel[]>([]);
  const usedBy = (c: DeptChannel) => (c.config.depts ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const toggleShared = async (c: DeptChannel) => {
    setBusy(c.id); setErr(null);
    try {
      const list = usedBy(c);
      const next = list.includes(deptId) ? list.filter((d) => d !== deptId) : [...list, deptId];
      await saveChannel(officeId, { ...c, config: { ...c.config, depts: next.join(', ') } });
      await load();
    } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
  };
  const [rows, setRows] = useState<DeptChannel[]>([]);
  const [kind, setKind] = useState<ChannelKind>('teams');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [to, setTo] = useState('');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  /** รับรายงานจากแหล่งไหน (คั่นจุลภาค) - ว่าง = ทุกแหล่ง */
  const [sources, setSources] = useState('');
  /** ช่องที่กำลังแก้ - null = ฟอร์มเพิ่มใหม่ */
  const [editing, setEditing] = useState<DeptChannel | null>(null);
  const resetForm = () => { setEditing(null); setLabel(''); setUrl(''); setTo(''); setToken(''); setSecret(''); setSources(''); };
  const startEdit = (c: DeptChannel) => {
    setEditing(c); setKind(c.kind); setLabel(c.label);
    setUrl(c.config.url ?? ''); setTo(c.config.to ?? ''); setToken(c.config.token ?? ''); setSecret(c.config.secret ?? ''); setSources(c.config.sources ?? '');
    setErr(null); setMsg(null);
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const all = await listChannels(officeId);
      // คลัง (shared) = ทุกช่องในออฟฟิศไม่ว่าสร้างจากแผนกไหน
      setRows(shared ? all : all.filter((c) => c.dept_id === deptId));
      setSharedRows(shared ? [] : all.filter((c) => c.dept_id === '*'));
      onChanged?.();
    } catch (e) { setErr(sbError(e)); }
    // แหล่งที่เลือกได้ = ชื่อ token ขาเข้าของแผนกนี้ + แหล่งที่เคยยิงเข้ามาจริง (ไม่ต้องพิมพ์เอง)
    const found = new Set<string>();
    try {
      const t = await accessToken();
      const res = await fetch(`/api/office/token?officeId=${officeId}`, { headers: t ? { 'x-sb-token': t } : {} });
      const data = (await res.json()) as { tokens?: TokenRow[] };
      for (const tk of data.tokens ?? []) if (tk.scope === 'inbox' && (shared || (tk.dept_ids ?? []).includes(deptId)) && tk.name) found.add(tk.name.trim());
    } catch { /* ไม่มีสิทธิ์/ยังไม่มี */ }
    try { for (const r of await listInbox(officeId, 200)) if ((shared || r.dept_id === deptId) && r.source) found.add(r.source.trim()); } catch { /* ตารางยังไม่มี */ }
    // LINE OA ที่ผูกกับแผนกนี้ก็เป็นแหล่ง (บทสนทนาลูกค้าถูกส่งต่อในชื่อ OA)
    try {
      const t = await accessToken();
      const res = await fetch(`/api/office/inbound?officeId=${officeId}${shared ? '' : `&deptId=${deptId}`}`, { headers: t ? { 'x-sb-token': t } : {} });
      const data = (await res.json()) as { inbound?: { label: string }[] };
      for (const r of data.inbound ?? []) if (r.label) found.add(r.label.trim());
    } catch { /* ไม่มีสิทธิ์/ยังไม่มี */ }
    setKnownSources([...found].filter(Boolean).sort());
  };
  const [knownSources, setKnownSources] = useState<string[]>([]);
  const chosen = sources.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const toggleSource = (name: string) => {
    const next = chosen.includes(name) ? chosen.filter((s) => s !== name) : [...chosen, name];
    setSources(next.join(', '));
  };
  useEffect(() => { void load(); }, [officeId, deptId]); // eslint-disable-line react-hooks/exhaustive-deps

  const needUrl = kind !== 'line';
  const valid = needUrl ? /^https?:\/\/\S+$/i.test(url.trim()) : !!to.trim();

  const add = async () => {
    setBusy('add'); setErr(null); setMsg(null);
    try {
      const config: Record<string, string> = {
        ...(needUrl
          ? { url: url.trim(), ...(kind === 'webhook' && secret.trim() ? { secret: secret.trim() } : {}) }
          : { to: to.trim(), ...(token.trim() ? { token: token.trim() } : {}) }),
        ...(sources.trim() ? { sources: sources.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).join(', ') } : {}),
        // ช่องใหม่ของแผนก: รับทุกแหล่งของแผนกนี้ไว้ก่อน (ไปติ๊กจำกัดที่แถวแหล่งได้) - แก้ไขช่องเดิมคง routes เดิม
        ...(editing ? (editing.config.routes ? { routes: editing.config.routes } : {}) : (!shared ? { routes: `${deptId}/*` } : {})),
      };
      const saved = await saveChannel(officeId, {
        ...(editing ? { id: editing.id } : {}),
        dept_id: deptId, kind, label: label.trim() || CHANNEL_LABEL[kind].split(' ')[0], config,
        events: editing?.events ?? ['report'], enabled: editing?.enabled ?? true,
      });
      resetForm();
      await load();
      setBusy(null);
      // เพิ่มแล้วยิงทดสอบให้เลย - รู้ทันทีว่า URL ใช้ได้ไหม
      await test(saved.id);
      return;
    } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
  };
  const remove = async (id: string) => {
    setBusy(id); setErr(null);
    try { await deleteChannel(officeId, id); await load(); } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
  };
  const toggle = async (c: DeptChannel) => {
    setBusy(c.id); setErr(null);
    try { await saveChannel(officeId, { ...c, enabled: !c.enabled }); await load(); } catch (e) { setErr(sbError(e)); } finally { setBusy(null); }
  };
  const test = async (id: string) => {
    setBusy(`test:${id}`); setErr(null); setMsg(null);
    try {
      const tok = await accessToken();
      const res = await fetch('/api/office/channel/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { 'x-sb-token': tok } : {}) },
        body: JSON.stringify({ officeId, channelId: id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMsg(t('ส่งข้อความทดสอบแล้ว - ไปดูในแชท'));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const useMemoKinds = useMemo(() => Object.keys(CHANNEL_LABEL) as ChannelKind[], []);

  return (
    <div className="flex flex-col gap-2">
      {!shared && !compact && (
        <>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
            {t('ช่องกลางของออฟฟิศ')}
            <InfoTip>{t('ช่องที่ตั้งไว้ครั้งเดียวที่ปุ่ม "เชื่อมต่อ" (แถบบน) → ช่องส่งออกกลาง - ติ๊กเพื่อให้รายงานของแผนกนี้ไปช่องนั้นด้วย ไม่ต้องวาง URL ซ้ำทุกแผนก · แก้ URL/ทดสอบทำที่หน้าเชื่อมต่อ')}</InfoTip>
          </div>
          {sharedRows.length === 0 ? <Hint className="text-[10px]">{t('ยังไม่มีช่องกลาง - ตั้งได้ที่ปุ่ม "เชื่อมต่อ" บนแถบบน')}</Hint> : (
            <ul className="flex flex-col gap-1">
              {sharedRows.map((c) => {
                const on = usedBy(c).includes(deptId);
                return (
                  <li key={c.id} className={`flex items-center gap-2 rounded-box border bg-ink-700 px-2 py-1 text-[11px] ${on ? 'border-carpet' : 'border-ink-600'}`}>
                    <button type="button" onClick={() => canEdit && void toggleShared(c)} disabled={!canEdit || busy !== null}
                      className={`size-4 shrink-0 rounded-box border ${on ? 'border-carpet bg-carpet-dark' : 'border-ink-500 bg-ink-800'}`} aria-label={t('ใช้กับแผนกนี้')}>{on ? '✓' : ''}</button>
                    <Badge variant={c.enabled ? 'good' : 'default'}>{c.kind}</Badge>
                    <span className="truncate text-parchment">{c.label}</span>
                    <span className="truncate text-dim">{c.kind === 'line' ? `→ ${c.config.to}` : c.config.url?.replace(/^https?:\/\//, '').slice(0, 32)}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 text-[10px] text-dim">{on ? t('แผนกนี้ใช้อยู่') : t('ไม่ได้ใช้')}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
        {shared ? t('ช่องส่งออกทั้งหมด') : t('ส่งออก - ช่องของแผนกนี้')}
        <InfoTip>
          {shared
            ? <>{t('ที่เก็บ Teams/Slack/Discord/LINE/webhook ทั้งออฟฟิศ')}<br /></>
            : <>{t('Teams/Slack/Discord/LINE/webhook ที่แผนกนี้จะโพสต์รายงานไป - ช่องใหม่รับ "ทุกแหล่งของแผนกนี้" ก่อน แล้วไปติ๊กจำกัดที่แถวแหล่งด้านบนได้')}<br /></>}
          {t('Teams: Workflows → "Post to a channel when a webhook request is received" แล้วเอา URL มาวาง')}<br />
          {t('LINE: ต้องมี OA และ userId/groupId ปลายทาง (groupId ได้จาก join event ของ webhook)')}
        </InfoTip>
      </div>
      {rows.length === 0 ? <Hint className="text-[10px]">{shared ? t('ยังไม่มีช่องกลาง') : t('ยังไม่มีช่องเฉพาะแผนก')}</Hint> : (
        <ul className="flex flex-col gap-1">
          {rows.map((c) => (
            <li key={c.id} className={`flex flex-col gap-1 rounded-box border bg-ink-700 px-2 py-1 text-[11px] ${editing?.id === c.id ? 'border-brass' : 'border-ink-600'}`}>
              <div className="flex items-center gap-2">
              <Webhook className="size-3 text-dim" />
              <Badge variant={c.enabled ? 'good' : 'default'}>{c.kind}</Badge>
              <span className="truncate text-parchment">{c.label}</span>
              <span className="truncate text-dim">{c.kind === 'line' ? `→ ${c.config.to}` : c.config.url?.replace(/^https?:\/\//, '').slice(0, 40)}</span>
              {compact
                ? <Badge className="shrink-0 whitespace-nowrap" title={(c.config.routes ?? '') || t('ยังไม่มีแหล่งไหนส่งมาช่องนี้')}>{(c.config.routes ?? '').split(/[,\n]/).filter((x) => x.trim()).length || t('ยังไม่ผูก')}{(c.config.routes ?? '').trim() ? ` ${t('เส้นทาง')}` : ''}</Badge>
                : <Badge className="max-w-40 shrink-0 truncate whitespace-nowrap" title={c.config.sources ? t('รับจาก: {sources}', { sources: c.config.sources }) : t('รับทุกแหล่ง')}>{c.config.sources ? t('จาก {sources}', { sources: c.config.sources }) : t('ทุกแหล่ง')}</Badge>}
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => test(c.id)} disabled={busy !== null || !c.enabled} title={t('ส่งข้อความทดสอบไปที่ช่องนี้')}>
                {busy === `test:${c.id}` ? <LoaderCircle className="animate-spin" /> : <Send />} {t('ทดสอบ')}
              </Button>
              {canEdit && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(c)} disabled={busy !== null} title={t('แก้ไขชื่อ/URL')}>{t('แก้ไข')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(c)} disabled={busy !== null}>{c.enabled ? t('ปิด') : t('เปิด')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)} disabled={busy !== null} title={t('ลบ')}><Trash2 /></Button>
                </>
              )}
              </div>
              {rowExtra?.(c)}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-col gap-1.5 rounded-box border border-dashed border-ink-500 p-2">
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Field label={t('ชนิด')}>
              <Select value={kind} onValueChange={(v) => setKind(v as ChannelKind)}>
                <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {useMemoKinds.map((k) => <SelectItem key={k} value={k}>{t(CHANNEL_LABEL[k])}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('ชื่อเรียก')}>
              <Input className="h-8" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('เช่น ทีม DevOps')} maxLength={60} />
            </Field>
          </div>
          {needUrl ? (
            <>
              <Field label="Webhook URL" info={kind === 'webhook' ? t('ปลายทางที่จะรับ POST JSON { event, deptId, title, text, meetingId, inboxId, source, link, at }') : t('URL นี้คือ secret ในตัว (ใครมีก็โพสต์เข้าห้องได้) จึงเห็นได้เฉพาะเจ้าของ/exec - ไม่ต้องใส่คีย์อื่นเพิ่ม')}>
                <Input className="h-8" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
              </Field>
              {kind === 'webhook' && (
                <Field label="secret" info={t('ไม่บังคับ - ถ้าใส่ จะแนบไปใน header X-Office-Secret ทุกครั้ง ปลายทางใช้เช็คว่ามาจากออฟฟิศจริง ตั้งค่าเดียวกันไว้ทั้งสองฝั่ง')}>
                  <Input className="h-8" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('สุ่มอะไรก็ได้ แล้วเอาไปตั้งที่ปลายทางให้ตรงกัน')} />
                </Field>
              )}
            </>
          ) : (
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <Field label={t('ปลายทาง')} info={t('userId (U...) หรือ groupId (C...) ที่ OA จะ push ข้อความไป - OA ต้องอยู่ในกลุ่มนั้น')}><Input className="h-8" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Cxxxxxxxx / Uxxxxxxxx" /></Field>
              <Field label="channel access token" info={t('secret ของ Messaging API - ว่างไว้ = ใช้ LINE_CHANNEL_ACCESS_TOKEN ที่ตั้งบนเซิร์ฟเวอร์')}><Input className="h-8" value={token} onChange={(e) => setToken(e.target.value)} type="password" /></Field>
            </div>
          )}
          {!compact && <Field label={t('รับรายงานจากแหล่งไหน')} info={t('แหล่ง = token ขาเข้าที่ตั้งชื่อไว้ / LINE OA ที่ผูกกับแผนก (บทสนทนาลูกค้าจะถูกส่งต่อมาในชื่อ OA) / ค่า source ที่ระบบข้างนอกส่งมา - เลือกได้หลายอัน ช่องนี้จะได้เฉพาะรายงานจากแหล่งที่ติ๊ก · ทุกแหล่ง = ไม่กรอง (รวมแชท LINE ด้วย)')}>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => setSources('')}
                className={`rounded-box border px-2 py-0.5 text-[11px] ${chosen.length === 0 ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>
                {t('ทุกแหล่ง')}
              </button>
              {knownSources.map((s) => (
                <button key={s} type="button" onClick={() => toggleSource(s)}
                  className={`rounded-box border px-2 py-0.5 text-[11px] ${chosen.includes(s) ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-500 bg-ink-800 text-dim hover:border-brass'}`}>
                  {s}
                </button>
              ))}
              {chosen.filter((s) => !knownSources.includes(s)).map((s) => (
                <button key={s} type="button" onClick={() => toggleSource(s)} title={t('แหล่งที่ตั้งไว้แต่ยังไม่มี token/ข้อมูลเข้า')}
                  className="rounded-box border border-brass/60 bg-[#22401f] px-2 py-0.5 text-[11px] text-carpet-lite">{s} ×</button>
              ))}
              {knownSources.length === 0 && <span className="text-[10px] text-dim">{t('ยังไม่มีแหล่ง - ไปสร้าง token หรือผูก LINE OA ในแท็บ "Webhook เข้า" ก่อน')}</span>}
            </div>
          </Field>}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={add} disabled={busy !== null || !valid}>
              {busy === 'add' ? <LoaderCircle className="animate-spin" /> : editing ? <Check /> : <Plus />} {editing ? t('บันทึกการแก้ไข + ทดสอบ') : t('เพิ่มช่อง + ทดสอบ')}
            </Button>
            {editing && <Button size="sm" variant="outline" onClick={resetForm} disabled={busy !== null}>{t('ยกเลิก')}</Button>}
            <span className="text-[10px] text-dim">{editing ? t('กำลังแก้ "{name}"', { name: editing.label }) : t('บันทึกทันที และส่งข้อความทดสอบไปที่ช่องนี้ให้เลย')}</span>
          </div>
        </div>
      )}
      {(err || msg) && <p className={`text-[11px] ${err ? 'text-rug-lite' : 'text-carpet-lite'}`}>{err ?? msg}</p>}
    </div>
  );
}

/* ============================================================
   ศูนย์รวมแผนก - ปุ่มบนแถบบน: เห็นทุกแผนกในที่เดียว กดตั้งค่า / สร้างใหม่ ไม่ต้องไปหาเฟืองในแผงจ้าง
   ============================================================ */
/** รายการแผนก (ไม่มี dialog) - ใช้เป็นแท็บ "แผนก" ในหน้าต่างการเชื่อมต่อ */
export function DepartmentsList({ officeId, roster, canEdit, onPick }: {
  officeId: string | null;
  roster: { deptId: string }[];
  canEdit: boolean;
  /** null = สร้างใหม่ */
  onPick: (id: string | null) => void;
}) {
  const [channels, setChannels] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!officeId) { setChannels({}); return; }
    listChannels(officeId).then((rows) => {
      const m: Record<string, number> = {};
      for (const c of rows) if (c.enabled) m[c.dept_id] = (m[c.dept_id] ?? 0) + 1;
      setChannels(m);
    }).catch(() => setChannels({}));
  }, [officeId]);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <>
        <div className="flex items-center gap-2">
          <span className="flex flex-1 items-center gap-1.5 text-[11px] text-dim">
            {t('{n} แผนก', { n: DEPT_BY_ID.size })}
            <InfoTip>{t('แต่ละแผนกมี URL รับข้อมูลเข้าของตัวเอง')} (<code>{origin}/api/office/inbox/&lt;id&gt;</code>) {t('และช่องส่งออกไป Teams/Slack/Discord/LINE ได้หลายช่อง - กด "ตั้งค่า" เพื่อแก้สกิล/webhook ของแผนกนั้น')}</InfoTip>
          </span>
          <Button size="sm" variant="primary" onClick={() => onPick(null)} disabled={!canEdit} title={canEdit ? t('ตั้งแผนกใหม่ ชื่ออะไรก็ได้') : t('เจ้าของหรือ exec เท่านั้น')}>
            <Plus /> {t('แผนกใหม่')}
          </Button>
        </div>
        <ul className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto pr-1">
          {[...DEPT_BY_ID.values()].map((d) => {
            const n = roster.filter((r) => r.deptId === d.id).length;
            const ch = channels[d.id] ?? 0;
            return (
              <li key={d.id} className="flex items-center gap-2 rounded-box border-2 border-ink-600 border-l-4 bg-ink-700 px-2 py-1.5" style={{ borderLeftColor: d.color }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-parchment">
                    {t(d.nameTh)}
                    <code className="text-[10px] font-normal text-dim">{d.id}</code>
                    {d.custom && <Badge variant="brass">{PRESET_BY_ID.has(d.id) ? t('ทับ preset') : t('สร้างเอง')}</Badge>}
                  </div>
                  <div className="truncate text-[10px] text-dim">{d.description || (d.custom ? t('สกิลในออฟฟิศ') : `skills/${d.skill}.md`)}</div>
                </div>
                <span className="shrink-0 text-[10px] text-dim">{t('{n} คน', { n })}</span>
                <span className="shrink-0 text-[10px] text-dim" title={t('ช่องส่งออกที่เปิดอยู่')}>{ch ? t('{n} ช่องส่งออก', { n: ch }) : '-'}</span>
                <Button size="sm" variant="outline" onClick={() => onPick(d.id)}>{t('ตั้งค่า')}</Button>
              </li>
            );
          })}
        </ul>
    </>
  );
}

export function DepartmentsHub({ open, onClose, officeId, roster, canEdit, onPick }: {
  open: boolean; onClose: () => void; officeId: string | null; roster: { deptId: string }[]; canEdit: boolean; onPick: (id: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent icon={<Building2 />} title={t('แผนก')} description={t('ทุกแผนกของออฟฟิศ')} wide>
        <DepartmentsList officeId={officeId} roster={roster} canEdit={canEdit} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}
