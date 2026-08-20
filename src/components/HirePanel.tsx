'use client';

import {
  AlertTriangle, Cpu, Crown, LayoutGrid, List, Lock, Minus, NotebookPen, Plug, Plus, Settings2, UserPlus, Users, Wrench,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { DEPARTMENTS } from '@/lib/departments';
import { SECRETARY_NAME, SECRETARY_PAL } from '@/game/map';
import { deptHeadIds } from '@/lib/heads';
import type { LlmRoles } from '@/components/KeyPanel';
import type { AgentState, EmployeeSnapshot } from '@/game/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/infotip';
import { Hint, Panel, PanelBody } from '@/components/ui/panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import Portrait from '@/components/Portrait';
import { t } from '@/lib/i18n';

/** ตัวเลือกโมเดลต่อคน - id ของชุดคีย์ใน KeyPanel + ป้ายสั้น ๆ */
export interface LlmOption {
  id: string;
  label: string;
}

/** สถานะจาก game loop - แปลให้อ่านออกว่าตอนนี้เขาทำอะไรอยู่บนแผนที่ */
const STATE_TH: Record<AgentState, string> = {
  work: 'นั่งทำงาน',
  walk: 'กำลังเดิน',
  meet: 'อยู่ในห้องประชุม',
  think: 'กำลังคิด',
  report: 'กำลังรายงาน',
  coffee: 'พักกดน้ำ',
  eat: 'กินข้าว',
  lounge: 'นั่งโซฟา',
  bench: 'นั่งม้านั่ง',
  pond: 'ชมบ่อน้ำ',
  chat: 'คุยกับเพื่อน',
  smoke: 'ออกไปสูบบุหรี่',
  idle: 'ยืนเล่น',
};

/** สถานะที่แปลว่ากำลังทำงานที่ผู้ใช้สั่ง - เน้นสีให้เห็นว่าใครกำลังยุ่ง */
const BUSY_STATES: AgentState[] = ['meet', 'think', 'report'];

interface Props {
  roster: EmployeeSnapshot[];
  seatsLeft: number;
  /** ที่นั่งที่แผนกนี้จะได้ (ว่างอยู่ + วางโต๊ะเพิ่มได้ใกล้ป้ายแผนก) (deptId -> จำนวน) */
  roomLeft: Record<string, number>;
  onHire: (deptId: string, count: number) => void;
  onFire: (deptId: string) => void;
  onFocus: (id: string | null) => void;
  disabled: boolean;
  /** ถ้ามีค่า แปลว่ายังจ้างไม่ได้ - text บอกเหตุผล action คือป้ายบนปุ่มที่พาไปแก้ */
  lock?: { text: string; action: string | null } | null;
  onUnlock?: () => void;
  /** แท็บที่เปิดอยู่ - คุมจากข้างนอก เพราะปุ่มเลขาฯ บนแถบบนต้องสั่งเปิดแท็บสมุดได้ */
  tab: string;
  onTab: (t: string) => void;
  /** เนื้อหาแท็บ "จัดออฟฟิศ" (LayoutPanel) - หน้าเว็บเป็นคนประกอบให้ เพราะต้องคุยกับ world */
  layoutPanel?: ReactNode;
  /** เนื้อหาแท็บ "แผนก & เชื่อมต่อ" (รายการแผนก / แก้แผนก / webhook เข้า / นโยบาย) - หน้าเว็บประกอบให้ */
  connectPanel?: ReactNode;
  /** เนื้อหาแท็บสมุดเลขาฯ - ประกอบจากข้างนอก (page มีข้อมูล meetings อยู่แล้ว) */
  secretary: ReactNode;
  meetingCount: number;
  /**
   * โมเดลต่อคน - ชุดคีย์ที่บันทึกไว้ใน KeyPanel  ว่างเปล่า = ไม่โชว์ตัวเลือกเลย
   * llmOf คืน id ที่ตั้งไว้ให้คนนี้ (undefined = ตามค่าเริ่มต้น) และ llmDefaultLabel บอกว่าค่าเริ่มต้นคืออะไร
   */
  llmOptions?: LlmOption[];
  llmOf?: (employeeId: string) => string | undefined;
  llmDefaultLabel?: string;
  onLlm?: (employeeId: string, connId: string | null) => void;
  /** โมเดลของตำแหน่งพิเศษ (ประธาน / ลูกทีม / เลขาฯ) - ค่าเดียวกับที่ตั้งใน "คีย์ของฉัน" */
  roleLlm?: LlmRoles;
  onRoleLlm?: (k: keyof LlmRoles, connId: string | null) => void;
  /** ชุดที่ active อยู่ - ค่าเริ่มต้นสุดท้ายของทุกคน */
  llmActiveLabel?: string;
  /** ป้ายค่าเริ่มต้นของหัวหน้าแผนก (ค่า chair หรือถอยไปค่าลูกทีม) */
  llmHeadLabel?: string;
  /** เปิดหน้าต่างแผนก - null = สร้างแผนกใหม่ */
  onEditDept?: (id: string | null) => void;
  /** แก้/สร้างแผนกได้ไหม (owner/exec) - ดูอย่างเดียวก็ยังเปิดดูสกิล/webhook ได้ */
  deptCanEdit?: boolean;
}

/** มุมมองแผงพนักงาน - จำไว้ข้ามรีเฟรช */
const VIEW_KEY = 'visual-company.staffview';
type StaffView = 'card' | 'list';

export default function HirePanel({
  roster, seatsLeft, roomLeft, onHire, onFire, onFocus, disabled, lock, onUnlock,
  tab, onTab: setTab, secretary, meetingCount, layoutPanel, connectPanel,
  llmOptions = [], llmOf, llmDefaultLabel = t('ค่าเริ่มต้น'), onLlm,
  roleLlm, onRoleLlm, llmActiveLabel = t('คีย์ของเซิร์ฟเวอร์'), llmHeadLabel = llmDefaultLabel,
  onEditDept, deptCanEdit = false,
}: Props) {
  const off = disabled || !!lock;

  const [view, setViewState] = useState<StaffView>('card');
  // localStorage อ่านได้เฉพาะฝั่ง client - โหลดหลัง mount ไม่งั้น SSR ไม่ตรง
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'list' || v === 'card') setViewState(v);
    } catch { /* ใช้ค่าเริ่มต้น */ }
  }, []);
  const setView = (v: StaffView) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* โหมดส่วนตัว */ }
  };

  // บอกเหตุผลที่กดไม่ได้ พร้อมทางออก - ปุ่มเทาเฉย ๆ ไม่ช่วยให้รู้ว่าต้องทำอะไร
  const lockNote = lock && (
    <div className="flex items-center gap-2 rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">
      <Lock className="size-3.5 shrink-0" />
      <span className="flex-1">{lock.text}</span>
      {lock.action && onUnlock && (
        <Button size="sm" variant="primary" className="shrink-0" onClick={onUnlock}>
          {lock.action}
        </Button>
      )}
    </div>
  );

  /** หัวหน้าแผนก = คนแรกที่จ้าง - โชว์มงกุฎ และเป็นคนที่ใช้โมเดล "หัวหน้าแผนก" */
  const heads = deptHeadIds(roster);

  // จัดกลุ่มตามแผนกโดยคงลำดับของ DEPARTMENTS ไว้ จะได้ไม่สลับที่ทุกครั้งที่ poll
  const groups = DEPARTMENTS.map((d) => ({
    dept: d,
    team: roster.filter((r) => r.deptId === d.id),
  })).filter((g) => g.team.length > 0);

  return (
    <Panel>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="staff">
            <Users /> {t('พนักงาน')} {roster.length}
          </TabsTrigger>
          <TabsTrigger value="hire">
            <UserPlus /> {t('จ้างเพิ่ม')}
          </TabsTrigger>
          <TabsTrigger value="notes">
            <NotebookPen /> {t('สมุดเลขาฯ')}{meetingCount > 0 ? ` ${meetingCount}` : ''}
          </TabsTrigger>
          <TabsTrigger value="layout" title={t('จัดโต๊ะ เก้าอี้ ของตกแต่ง')}>
            <Wrench /> {t('จัดออฟฟิศ')}
          </TabsTrigger>
          <TabsTrigger value="connect" title={t('แผนก / webhook เข้า-ออก / MCP / LINE / นโยบายโมเดล')}>
            <Plug /> {t('แผนก & เชื่อมต่อ')}
          </TabsTrigger>
          <Badge
            variant={seatsLeft > 0 ? 'default' : 'bad'}
            className="ml-auto self-center"
          >
            {t('โต๊ะว่าง')} {seatsLeft}
          </Badge>
        </TabsList>

        {/* ---------- แท็บพนักงานปัจจุบัน ---------- */}
        <TabsContent value="staff" className="min-h-0">
          <PanelBody className="gap-1.5">
            {lockNote}

            {/* ตำแหน่งพิเศษ - ไม่ใช่พนักงานที่จ้าง แต่มีโมเดลของตัวเอง
                ประธานเปลี่ยนคนตามแผนกเจ้าของเรื่อง เลขาฯ เป็นตัวละครประจำ */}
            {llmOptions.length > 0 && onRoleLlm && (
              <div className="flex flex-col gap-1 rounded-box border-2 border-wood-dark bg-wood-deep/40 p-1.5">
                {(
                  [
                    {
                      k: 'chair' as const,
                      icon: <Crown className="size-3.5 text-brass" />,
                      name: t('หัวหน้าแผนกทุกคน'),
                      sub: t('คนแรกที่จ้างในแต่ละแผนก - ใช้ทุกรอบ และเป็นประธานที่ประชุมได้'),
                      def: t('ค่าเริ่มต้น · {label}', { label: llmDefaultLabel }),
                    },
                    {
                      k: 'member' as const,
                      icon: <Users className="size-3.5 text-dim" />,
                      name: t('ลูกทีมที่เหลือ'),
                      sub: t('ค่าเริ่มต้นของคนที่ไม่ได้ตั้งรายคน'),
                      def: t('ค่าเริ่มต้น · {label}', { label: llmActiveLabel }),
                    },
                    {
                      k: 'secretary' as const,
                      icon: <Portrait palette={SECRETARY_PAL} size={1} className="block shrink-0" />,
                      name: SECRETARY_NAME,
                      sub: t('เลขาฯ จดรายงานการประชุมหลังจบ'),
                      def: t('ตามค่าลูกทีม'),
                    },
                  ]
                ).map(({ k, icon, name, sub, def }) => {
                  const cur = roleLlm?.[k];
                  const isOff = k === 'secretary' && cur === 'off';
                  const opt = llmOptions.find((o) => o.id === cur);
                  return (
                    <div key={k} className="flex items-center gap-1.5">
                      <span className="flex w-5 shrink-0 items-center justify-center">{icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold text-parchment">{name}</span>
                        <span className="block truncate text-[10px] text-dim">{sub}</span>
                      </span>
                      <Select
                        value={opt ? opt.id : isOff ? 'off' : '_default'}
                        onValueChange={(v) => onRoleLlm(k, v === '_default' ? null : v)}
                        disabled={disabled}
                      >
                        <SelectTrigger
                          className={`h-6 w-40 shrink-0 gap-1 px-1.5 text-[10px] ${opt || isOff ? 'border-brass/60 text-parchment' : 'text-dim'}`}
                          title={opt ? t('{name} ใช้ {label}', { name, label: opt.label }) : def}
                        >
                          <Cpu className="size-3 shrink-0" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_default">{def}</SelectItem>
                          {k === 'secretary' && <SelectItem value="off">{t('ไม่จดรายงาน')}</SelectItem>}
                          {llmOptions.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            )}

            {!roster.length ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <Hint>{t('ยังไม่มีพนักงานในบริษัท')}</Hint>
                <Button size="sm" variant="primary" onClick={() => setTab('hire')}>
                  <UserPlus /> {t('ไปหน้าจ้างพนักงาน')}
                </Button>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {/* สลับมุมมอง - การ์ดเห็นหน้าชัด รายการเห็นทีเดียวหลายคนและตั้งโมเดลง่าย */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-dim">{t('มุมมอง')}</span>
                  <Button
                    size="icon" variant={view === 'card' ? 'primary' : 'ghost'} className="size-6"
                    title={t('การ์ด')} onClick={() => setView('card')}
                  >
                    <LayoutGrid className="size-3" />
                  </Button>
                  <Button
                    size="icon" variant={view === 'list' ? 'primary' : 'ghost'} className="size-6"
                    title={t('รายการ')} onClick={() => setView('list')}
                  >
                    <List className="size-3" />
                  </Button>
                </div>

                {groups.map(({ dept, team }) => (
                  <div key={dept.id}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <i className="size-2.5 rounded-[2px]" style={{ background: dept.color }} />
                      <span className="text-[11px] font-semibold text-parchment">
                        {t(dept.nameTh)}
                      </span>
                      <span className="text-[11px] text-dim">{t('{n} คน', { n: team.length })}</span>
                      {team.length === 1 && (
                        <span
                          className="ml-auto flex items-center gap-1 text-[10px] text-brass-lite"
                          title={t('มีคนเดียวจะไม่มีใครค้าน ต้องครบ 3 คนถึงถกกันได้')}
                        >
                          <AlertTriangle className="size-3" /> {t('ยังไม่มีใครค้าน')}
                        </span>
                      )}
                    </div>

                    <div
                      className={
                        view === 'card'
                          ? 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5'
                          : 'flex flex-col gap-1'
                      }
                    >
                      {team.map((m) => {
                        const working = BUSY_STATES.includes(m.state);
                        const isHead = heads.get(m.deptId) === m.id;
                        const picked = llmOf?.(m.id);
                        const pickedOpt = picked ? llmOptions.find((o) => o.id === picked) : undefined;
                        const select = llmOptions.length > 0 && onLlm && (
                          <Select
                            value={pickedOpt ? pickedOpt.id : '_default'}
                            onValueChange={(v) => onLlm(m.id, v === '_default' ? null : v)}
                            disabled={disabled}
                          >
                            <SelectTrigger
                              className={`h-6 gap-1 px-1.5 text-[10px] ${view === 'card' ? 'w-full' : 'w-40 shrink-0'} ${pickedOpt ? 'border-brass/60 text-parchment' : 'text-dim'}`}
                              title={pickedOpt ? t('คนนี้ใช้ {label}', { label: pickedOpt.label }) : t('ใช้ค่าเริ่มต้น ({label})', { label: isHead ? llmHeadLabel : llmDefaultLabel })}
                            >
                              <Cpu className="size-3 shrink-0" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_default">{isHead ? t('ตามหัวหน้าแผนก') : t('ตามลูกทีม')} · {isHead ? llmHeadLabel : llmDefaultLabel}</SelectItem>
                              {llmOptions.map((o) => (
                                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );

                        if (view === 'list') {
                          return (
                            <div
                              key={m.id}
                              className={`flex items-center gap-1.5 rounded-box border-2 bg-ink-700 px-1.5 py-1 ${pickedOpt ? 'border-brass/50' : 'border-ink-600'}`}
                            >
                              <button
                                onClick={() => onFocus(m.id)}
                                title={t('เลื่อนกล้องไปหา {name}', { name: m.name })}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-brass"
                              >
                                <Portrait palette={m.palette} size={1} className="block shrink-0" />
                                {isHead && <Crown className="size-3 shrink-0 text-brass" aria-label={t('หัวหน้าแผนก')} />}
                                <span className="truncate text-[11px] font-semibold text-parchment">{m.name}</span>
                                <span className="hidden truncate text-[10px] text-dim sm:inline">{t(m.title)}</span>
                                <span className={`ml-auto shrink-0 text-[10px] ${working ? 'text-brass' : 'text-carpet-lite'}`}>
                                  {t(STATE_TH[m.state])}
                                </span>
                              </button>
                              {select}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={m.id}
                            className={`flex flex-col rounded-box border-2 bg-ink-700 ${pickedOpt ? 'border-brass/50' : 'border-ink-600'}`}
                          >
                            <button
                              onClick={() => onFocus(m.id)}
                              title={t('เลื่อนกล้องไปหา {name}', { name: m.name })}
                              className="flex items-center gap-1.5 rounded-box p-1 text-left hover:bg-ink-600"
                            >
                              {/* รูปนี้วาดด้วยโค้ดเดียวกับตัวบนแผนที่ สีจึงตรงกันเสมอ */}
                              <span
                                className="shrink-0 rounded-[3px] border border-ink-500"
                                style={{ background: 'rgba(0,0,0,.25)' }}
                              >
                                <Portrait palette={m.palette} size={2} className="block" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1 text-[11px] font-semibold text-parchment">
                                  {isHead && <Crown className="size-3 shrink-0 text-brass" aria-label={t('หัวหน้าแผนก')} />}
                                  <span className="truncate">{m.name}</span>
                                </span>
                                <span className="block truncate text-[10px] text-dim">
                                  {t(m.title)}
                                </span>
                                <span
                                  className={`block truncate text-[10px] ${
                                    working ? 'text-brass' : 'text-carpet-lite'
                                  }`}
                                >
                                  {t(STATE_TH[m.state])}
                                </span>
                              </span>
                            </button>
                            {/* โมเดลของคนนี้ - โชว์ต่อเมื่อมีชุดคีย์ให้เลือก ค่าเริ่มต้นตามที่ตั้งใน "คีย์ของฉัน" */}
                            {select && <div className="px-1 pb-1">{select}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PanelBody>
        </TabsContent>

        {/* ---------- แท็บจ้างเพิ่ม ---------- */}
        <TabsContent value="hire" className="min-h-0">
          <PanelBody className="gap-1.5">
            {lockNote}

            <Hint className="flex items-center gap-1.5">
              {t('จ้าง 1 คน = agent 1 ตัว · ครบ 3 คนถึงถกเต็มรูปแบบ')}
              <InfoTip>{t('คนที่ 1-4 ของแผนกได้บทบาทผู้เสนอ ผู้ค้าน ผู้ตรวจสอบ ผู้ดูความเป็นไปได้ตามลำดับ แต่ละบทบาทถูกประเมินคนละเกณฑ์จึงเถียงกันจริง · สกิลถูกอ่านตอนถามคำถาม ไม่ใช่ตอนกดจ้าง')}</InfoTip>
            </Hint>

            {onEditDept && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7" onClick={() => onEditDept(null)} disabled={!deptCanEdit}
                  title={deptCanEdit ? t('ตั้งแผนกใหม่ - ชื่ออะไรก็ได้ ให้ AI ร่างสกิลให้ แล้วผูก webhook เข้า/ออกได้') : t('เจ้าของหรือ exec ของออฟฟิศเท่านั้น')}>
                  <Plus /> {t('แผนกใหม่')}
                </Button>
                <InfoTip>{t('ตั้งแผนกชื่ออะไรก็ได้ เช่น IT Support รับ bug จาก logger แล้วแจ้ง Teams - ให้ AI ร่างสกิลให้ แล้วผูก webhook เข้า/ช่องส่งออกในหน้าเดียวกัน (หรือกด "แผนก & Webhook" บนแถบบน)')}</InfoTip>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {DEPARTMENTS.map((d) => {
                const team = roster.filter((r) => r.deptId === d.id);
                return (
                  <div
                    key={d.id}
                    className="rounded-box border-2 border-ink-600 border-l-4 bg-ink-700 p-2"
                    style={{ borderLeftColor: d.color }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-parchment">{t(d.nameTh)}</span>
                      {onEditDept && (
                        <button type="button" onClick={() => onEditDept(d.id)} title={t('ตั้งค่าแผนก: สกิล / webhook เข้า / ส่งออก')}
                          className="rounded-box border border-transparent p-0.5 text-dim hover:border-ink-500 hover:text-parchment">
                          <Settings2 className="size-3.5" />
                        </button>
                      )}
                      <span
                        className="ml-auto min-w-5 rounded-box px-1.5 text-center text-[11px] font-bold text-ink-900"
                        style={{ background: team.length ? d.color : 'var(--color-ink-500)' }}
                      >
                        {team.length}
                      </span>
                    </div>

                    <p className="mb-1.5 mt-0.5 line-clamp-2 text-[11px] text-dim" title={d.description}>
                      {d.custom
                        ? (d.description || t('แผนกของออฟฟิศ - สกิลเก็บในออฟฟิศ'))
                        : <>{t('ใช้สกิล')} <code>skills/{d.skill}.md</code></>}
                    </p>

                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => onHire(d.id, 1)}
                        disabled={off || (roomLeft[d.id] ?? 0) < 1}
                        title={lock?.text ?? ((roomLeft[d.id] ?? 0) < 1 ? t('ไม่มีที่ว่างให้วางโต๊ะเพิ่ม - ไปแท็บจัดออฟฟิศ ลบ/ย้ายของหรือขยายพื้นที่ก่อน') : undefined)}
                                              >
                        <UserPlus /> {t('จ้าง')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => onHire(d.id, 3)}
                        disabled={off || (roomLeft[d.id] ?? 0) < 3}
                        title={lock?.text ?? ((roomLeft[d.id] ?? 0) < 3 ? t('เหลือที่ว่าง {n} ที่', { n: roomLeft[d.id] ?? 0 }) : undefined)}
                                              >
                        <Users /> {t('ทีม 3 คน')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onFire(d.id)}
                        disabled={off || team.length === 0}
                        title={lock?.text ?? t('เลิกจ้างคนล่าสุดของแผนกนี้')}
                      >
                        <Minus />
                        <span className="sr-only">{t('เลิกจ้าง')}</span>
                      </Button>
                    </div>

                    {team.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {team.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => onFocus(m.id)}
                            title={t('เลื่อนกล้องไปหา {name}', { name: m.name })}
                            className="flex items-center gap-1 rounded-box border border-ink-500 bg-ink-800 py-0.5 pl-0.5 pr-1.5 text-[11px] hover:border-brass"
                          >
                            <Portrait palette={m.palette} size={1} className="block shrink-0" />
                            <b className="font-semibold text-parchment">{m.name}</b>
                            <span className="text-dim">{t(m.title)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </PanelBody>
        </TabsContent>

        {/* ---------- แท็บสมุดบันทึกของเลขาฯ ---------- */}
        {/* ---------- แท็บจัดออฟฟิศ (เนื้อหามาจากหน้าเว็บ) ---------- */}
        <TabsContent value="layout" className="min-h-0">
          {layoutPanel}
        </TabsContent>
        <TabsContent value="connect" className="min-h-0">
          <PanelBody className="gap-2 overflow-y-auto">{connectPanel}</PanelBody>
        </TabsContent>

        <TabsContent value="notes" className="min-h-0">
          {secretary}
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
