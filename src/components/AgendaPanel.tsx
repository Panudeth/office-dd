'use client';

import { Check, ClipboardList, Crown, LoaderCircle, Play, Sparkles, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEPARTMENTS, DEPT_BY_ID, ROLE_ORDER } from '@/lib/departments';
import { MAX_ATTENDEES, MEETING_MODES, type Agenda, type MeetingMode } from '@/lib/protocol';
import type { EmployeeSnapshot } from '@/game/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import Portrait from '@/components/Portrait';
import { deptHeadIds } from '@/lib/heads';

export interface AgendaPick {
  agentIds: string[];
  mode: MeetingMode;
  ownerDeptId: string;
  /** ประธานที่ประชุม/คนสรุป - หัวหน้าแผนกคนหนึ่งที่อยู่ในรายชื่อผู้เข้าประชุม */
  chairId: string;
}

interface Props {
  open: boolean;
  question: string;
  agenda: Agenda | null;
  loading: boolean;
  error: string | null;
  roster: EmployeeSnapshot[];
  onCancel: () => void;
  onStart: (pick: AgendaPick) => void;
}

const byRole = (a: EmployeeSnapshot, b: EmployeeSnapshot) =>
  ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);

/**
 * เลือกคนให้อัตโนมัติจากระเบียบวาระ
 * โต๊ะกลมส่งแผนกละ 2 คน (ผู้เสนอ+ผู้ค้าน) เพราะต้องมีคนค้านในแผนกตัวเองด้วย
 * สายพานส่งแผนกละ 1 คน เพราะเป็นการเดินไปถามทีละคน ไม่ใช่ประชุม
 */
function autoPick(agenda: Agenda, roster: EmployeeSnapshot[], mode: MeetingMode): string[] {
  const perDept = mode === 'relay' ? 1 : 2;
  const picked: string[] = [];
  // เจ้าของเรื่องได้เลือกก่อน ถ้าที่นั่งไม่พอจะได้ไม่ตกสำรวจ
  const order = [...agenda.items].sort((a, b) =>
    a.deptId === agenda.ownerDeptId ? -1 : b.deptId === agenda.ownerDeptId ? 1 : 0,
  );
  for (const item of order) {
    const team = roster.filter((r) => r.deptId === item.deptId).sort(byRole);
    for (const m of team.slice(0, perDept)) {
      if (picked.length >= MAX_ATTENDEES) return picked;
      picked.push(m.id);
    }
  }
  return picked;
}

export default function AgendaPanel({
  open, question, agenda, loading, error, roster, onCancel, onStart,
}: Props) {
  const [mode, setMode] = useState<MeetingMode>('roundtable');
  /** ประธานที่เลือกไว้ (id พนักงาน) - แผนกเจ้าของเรื่องคือแผนกของคนนี้ */
  const [chair, setChair] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  // ผู้ใช้แก้รายชื่อเองแล้วหรือยัง - ถ้าแก้แล้ว การสลับโหมดต้องไม่ไปล้างของที่เขาเลือก
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!agenda) return;
    setMode(agenda.mode);
    setChair(deptHeadIds(roster).get(agenda.ownerDeptId) ?? '');
    setPicked(autoPick(agenda, roster, agenda.mode));
    setTouched(false);
    // roster เปลี่ยนตลอดจาก game loop - ผูกกับ agenda อย่างเดียว ไม่งั้นเลือกใหม่ทุก 400ms
  }, [agenda]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggested = useMemo(
    () => new Map((agenda?.items ?? []).map((i) => [i.deptId, i.reason])),
    [agenda],
  );

  // แผนกที่ถูกเสนอขึ้นก่อน ที่เหลือตามหลังไว้ให้เพิ่มเองได้
  const depts = useMemo(() => {
    const hired = DEPARTMENTS.filter((d) => roster.some((r) => r.deptId === d.id));
    return [...hired].sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)));
  }, [roster, suggested]);

  const pickedSet = new Set(picked);
  const pickedDepts = [...new Set(picked.map((id) => roster.find((r) => r.id === id)?.deptId))]
    .filter((v): v is string => !!v);
  const full = picked.length >= MAX_ATTENDEES;

  const toggle = (id: string) => {
    setTouched(true);
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : full ? prev : [...prev, id],
    );
  };

  const changeMode = (m: MeetingMode) => {
    setMode(m);
    // ยังไม่ได้แก้เอง = ให้ระบบจัดคนใหม่ตามโหมด (สายพานใช้คนน้อยกว่า)
    if (!touched && agenda) setPicked(autoPick(agenda, roster, m));
  };

  /**
   * ประธานเลือกได้เฉพาะหัวหน้าแผนก (คนแรกที่จ้าง) ของแผนกที่มีคนเข้าประชุม
   * หัวหน้าเป็นคนที่ใช้โมเดลเก่งสุดอยู่แล้ว และเป็นคนที่ผู้ใช้จำได้ว่าเป็นใคร
   */
  const heads = deptHeadIds(roster);
  const chairOptions = pickedDepts
    .map((d) => roster.find((r) => r.id === heads.get(d)))
    .filter((r): r is EmployeeSnapshot => !!r);
  const chairValid = chairOptions.some((r) => r.id === chair);
  const effectiveChair = chairValid ? chair : chairOptions[0]?.id ?? '';
  // แผนกเจ้าของเรื่องคือแผนกของประธาน - relay ใช้เป็นคนถือคำถาม
  const effectiveOwner = roster.find((r) => r.id === effectiveChair)?.deptId ?? pickedDepts[0] ?? '';
  const chooseChair = (id: string) => {
    setChair(id);
    // ประธานต้องนั่งอยู่ในห้องจริง - ถ้าผู้ใช้เอาหัวหน้าออกไปแล้ว ดึงกลับเข้ามา
    if (!pickedSet.has(id) && !full) { setTouched(true); setPicked((p) => [...p, id]); }
  };
  const relayTooSmall = mode === 'relay' && pickedDepts.length < 2;

  const blocked = !picked.length
    ? 'ต้องเลือกอย่างน้อย 1 คน'
    : relayTooSmall
      ? 'สายพานต้องมีอย่างน้อย 2 แผนก ไม่งั้นไม่มีใครให้เดินไปถาม'
      : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        icon={<ClipboardList />}
        title="ระเบียบวาระการประชุม"
        description="ตรวจว่าใครควรเข้าประชุม แก้ได้ก่อนเริ่ม"
      >
        <p className="rounded-box border border-ink-600 bg-ink-700 px-2 py-1.5 text-[12px] leading-relaxed text-parchment">
          {question}
        </p>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-dim">
            <LoaderCircle className="size-4 animate-spin" />
            เลขานุการกำลังอ่านคำถาม และเลือกแผนกที่เกี่ยวข้อง
          </div>
        ) : error ? (
          <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">
            <b className="text-brass">เลือกแผนกอัตโนมัติไม่สำเร็จ</b> {error}
            <br />
            เลือกเองด้านล่างแล้วเริ่มประชุมได้เลย
          </p>
        ) : null}

        {agenda && !loading && (
          <>
            {agenda.note && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-carpet-lite">
                <Sparkles className="mt-px size-3.5 shrink-0" />
                <span>{agenda.note}</span>
              </p>
            )}
            {agenda.fallback && (
              <Hint className="text-brass">
                ยังไม่มีคีย์ LLM เลขาฯ จึงเลือกจากการนับคำในคำถาม ไม่ได้อ่านความหมายจริง
              </Hint>
            )}

            <Field label="รูปแบบการประชุม">
              <div className="flex gap-1.5">
                {MEETING_MODES.map((m) => (
                  <Button
                    key={m.id}
                    size="sm"
                    variant={mode === m.id ? 'primary' : 'outline'}
                    className={mode === m.id ? 'flex-1' : 'flex-1 border-ink-500'}
                    onClick={() => changeMode(m.id)}
                  >
                    {m.th}
                  </Button>
                ))}
              </div>
              <Hint className="mt-1">{MEETING_MODES.find((m) => m.id === mode)?.hint}</Hint>
            </Field>

            <Field
              label={mode === 'relay' ? 'เจ้าของเรื่อง (คนถือคำถามและสรุป)' : mode === 'direct' ? 'คนตอบ' : 'ประธานที่ประชุม (คนสรุป)'}
              hint="เลือกได้เฉพาะหัวหน้าแผนก (คนแรกที่จ้างในแผนก) - หัวหน้าถกในรอบปกติด้วย แล้วสวมหมวกประธานตอนสรุป"
            >
              <div className="flex flex-wrap gap-1.5">
                {chairOptions.map((r) => {
                  const d = DEPT_BY_ID.get(r.deptId);
                  const on = effectiveChair === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => chooseChair(r.id)}
                      title={`${r.name} - ${r.title}`}
                      className={`flex items-center gap-1.5 rounded-box border-2 py-1 pl-1 pr-2 text-[11px] font-semibold ${
                        on ? 'border-brass bg-ink-700 text-parchment' : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'
                      }`}
                    >
                      <Portrait palette={r.palette} size={1} className="block shrink-0" />
                      {on && <Crown className="size-3 text-brass" />}
                      {r.name}
                      <span className={on ? 'font-normal text-parchment-2/70' : 'font-normal text-dim'}>{d?.shortTh ?? r.deptId}</span>
                    </button>
                  );
                })}
                {!chairOptions.length && <Hint>เลือกคนก่อน แล้วค่อยเลือกประธาน</Hint>}
              </div>
            </Field>

            <Field label="ผู้เข้าประชุม">
              <div className="mb-1 flex items-center gap-2">
                <Users className="size-3.5 text-dim" />
                <span className={`text-[11px] ${full ? 'text-brass' : 'text-dim'}`}>
                  {picked.length} / {MAX_ATTENDEES} ที่นั่ง
                  {full && ' - เต็มแล้ว เอาใครออกก่อนถึงจะเพิ่มได้'}
                </span>
              </div>

              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
                {depts.map((d) => {
                  const team = roster.filter((r) => r.deptId === d.id).sort(byRole);
                  const reason = suggested.get(d.id);
                  return (
                    <div
                      key={d.id}
                      className="rounded-box border-2 border-ink-600 border-l-4 bg-ink-700 p-2"
                      style={{ borderLeftColor: d.color }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-parchment">{d.nameTh}</span>
                        {reason ? (
                          <Badge variant="brass">เลขาฯ แนะนำ</Badge>
                        ) : (
                          <Badge>ไม่ได้ถูกเสนอ</Badge>
                        )}
                      </div>
                      {reason && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-dim">{reason}</p>
                      )}

                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {team.map((m) => {
                          const on = pickedSet.has(m.id);
                          return (
                            <button
                              key={m.id}
                              onClick={() => toggle(m.id)}
                              disabled={!on && full}
                              title={on ? 'เอาออกจากวาระ' : full ? 'ที่นั่งเต็มแล้ว' : 'เพิ่มเข้าวาระ'}
                              className={`flex items-center gap-1.5 rounded-box border-2 px-1.5 py-1 text-[11px] disabled:opacity-40 ${
                                on
                                  ? 'border-carpet bg-carpet-dark text-white'
                                  : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'
                              }`}
                            >
                              <span
                                className={`flex size-3 items-center justify-center rounded-[2px] ${
                                  on ? 'bg-white' : 'border border-ink-500'
                                }`}
                              >
                                {on && <Check className="size-2.5 text-carpet-dark" />}
                              </span>
                              {heads.get(m.deptId) === m.id && <Crown className="size-3 text-brass" />}
                              <b className="font-semibold">{m.name}</b>
                              <span className={on ? 'text-white/70' : 'text-dim'}>{m.title}</span>
                            </button>
                          );
                        })}
                        {!team.length && <Hint>ยังไม่มีพนักงานในแผนกนี้</Hint>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {blocked && agenda && !loading && (
          <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] text-brass-lite">
            {blocked}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={loading || !!blocked || !picked.length}
            onClick={() => onStart({ agentIds: picked, mode, ownerDeptId: effectiveOwner, chairId: effectiveChair })}
          >
            <Play /> เริ่มประชุม
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
