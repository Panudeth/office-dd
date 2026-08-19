'use client';

import {
  CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEPT_BY_ID } from '@/lib/departments';
import { MEETING_MODES, type Consult, type Opinion } from '@/lib/protocol';
import type { MeetingRow } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import { fmt } from '@/components/ui/rich-text';
import Portrait from '@/components/Portrait';
import { t } from '@/lib/i18n';

/* ============================================================
   สมุดบันทึกของเลขาฯ - แท็บในแผงขวา (ไม่ใช่ dialog แล้ว)
   ปฏิทินรายเดือนบอกว่าวันไหนมีประชุมกี่เรื่อง กดวันแล้วเห็นรายการวันนั้น
   ไม่กดวันไหน = เห็นทั้งหมดของเดือนที่กำลังดู เรียงล่าสุดก่อน
   ============================================================ */

interface Props {
  meetings: MeetingRow[];
  loading: boolean;
  error: string | null;
  /** ยังใช้ไม่ได้เพราะอะไร (ไม่ได้ล็อกอิน / ยังไม่เลือกออฟฟิศ / ยังไม่ได้ตั้งค่า Supabase) */
  blocked: string | null;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

const fmtTime = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });
const fmtMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' });
const fmtDay = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export default function SecretaryTab({
  meetings, loading, error, blocked, onRefresh, onDelete,
}: Props) {
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  // เดือนที่กำลังดู - เริ่มที่เดือนปัจจุบัน
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  /** ปฏิทินเต็มพับไว้ก่อน - แผงนี้พื้นที่น้อย เนื้อหาหลักคือรายการประชุม ไม่ใช่ตาราง */
  const [calOpen, setCalOpen] = useState(false);

  // จำนวนประชุมต่อวัน - ใช้ทั้งเลขบนปฏิทินและกรองรายการ
  const byDay = useMemo(() => {
    const m = new Map<string, MeetingRow[]>();
    for (const r of meetings) {
      const k = dayKey(new Date(r.created_at));
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    return m;
  }, [meetings]);

  // เปลี่ยนเดือนแล้ววันที่เลือกไว้ไม่อยู่ในเดือนนั้น = ล้างทิ้ง จะได้ไม่งงว่าทำไมรายการว่าง
  useEffect(() => {
    if (pickedDay && !pickedDay.startsWith(monthKey(cursor))) setPickedDay(null);
  }, [cursor, pickedDay]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) {
      // ค้นหาข้ามทุกเดือน - คนที่พิมพ์ค้นไม่ได้อยากไล่เปลี่ยนเดือนเอง
      return meetings.filter(
        (m) =>
          m.question.toLowerCase().includes(needle) ||
          m.summary.toLowerCase().includes(needle) ||
          (m.minutes ?? '').toLowerCase().includes(needle) ||
          m.dept_ids.some((d) => (DEPT_BY_ID.get(d)?.nameTh ?? d).toLowerCase().includes(needle)),
      );
    }
    if (pickedDay) return byDay.get(pickedDay) ?? [];
    const mk = monthKey(cursor);
    return meetings.filter((r) => dayKey(new Date(r.created_at)).startsWith(mk));
  }, [meetings, byDay, cursor, pickedDay, q]);

  const toggle = (id: string) => setExpanded((o) => ({ ...o, [id]: !o[id] }));

  // ตารางปฏิทิน 6 แถว x 7 วัน เริ่มวันอาทิตย์
  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);
  const todayKey = dayKey(new Date());
  const monthTotal = meetings.filter((r) => monthKey(new Date(r.created_at)) === monthKey(cursor)).length;

  if (blocked) {
    return (
      <p className="m-2 rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">
        {blocked}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-2">
      {/* ---------- เดือน + ปฏิทิน (พับได้) ---------- */}
      <div className="shrink-0 rounded-box border-2 border-ink-600 bg-ink-700 p-1.5">
        <div className="flex items-center gap-1">
          <Button
            size="icon" variant="ghost" className="size-6" title={t('เดือนก่อน')}
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft />
          </Button>
          <button
            className="flex-1 text-center text-[12px] font-semibold text-parchment hover:text-brass"
            title={t('กลับมาเดือนนี้')}
            onClick={() => {
              const d = new Date();
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
              setPickedDay(null);
            }}
          >
            {fmtMonth.format(cursor)}
          </button>
          <Button
            size="icon" variant="ghost" className="size-6" title={t('เดือนถัดไป')}
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight />
          </Button>
          <Button
            size="icon" variant={calOpen ? 'primary' : 'ghost'} className="size-6"
            title={calOpen ? t('พับปฏิทิน') : t('กางปฏิทิน - เลือกวัน')}
            onClick={() => setCalOpen((v) => !v)}
          >
            <CalendarDays />
          </Button>
          <Button size="icon" variant="ghost" className="size-6" onClick={onRefresh} disabled={loading} title={t('โหลดใหม่')}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
          </Button>
        </div>
        {calOpen && (
        <div className="mt-1 grid grid-cols-7 gap-0.5 text-center text-[9px] text-dim">
          {WEEKDAYS.map((w) => <div key={w} className="py-0.5">{t(w)}</div>)}
          {grid.map((d) => {
            const k = dayKey(d);
            const n = byDay.get(k)?.length ?? 0;
            const inMonth = d.getMonth() === cursor.getMonth();
            const on = pickedDay === k;
            const tone = on
              ? 'border-brass bg-ink-600 text-parchment'
              : n
                ? 'border-ink-500 bg-ink-800 text-parchment hover:border-brass'
                : 'border-transparent text-dim/60';
            return (
              <button
                key={k}
                onClick={() => setPickedDay(on ? null : k)}
                disabled={!n}
                title={n ? t('{day} - {n} เรื่อง', { day: fmtDay.format(d), n }) : undefined}
                className={`relative flex h-6 flex-col items-center justify-center rounded-[3px] border text-[10px] disabled:cursor-default ${tone} ${inMonth ? '' : 'opacity-40'} ${k === todayKey ? 'font-bold underline' : ''}`}
              >
                {d.getDate()}
                {n > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-brass px-0.5 text-[8px] font-bold leading-3.5 text-ink-900">
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        )}
        <div className="mt-1 flex items-center justify-between text-[10px] text-dim">
          <span>{t('เดือนนี้ {n} เรื่อง', { n: monthTotal })}{pickedDay ? t(' · กรองวันที่ {day}', { day: pickedDay.slice(-2) }) : ''}</span>
          {pickedDay && (
            <button className="text-brass hover:underline" onClick={() => setPickedDay(null)}>
              {t('ดูทั้งเดือน')}
            </button>
          )}
        </div>
      </div>

      {/* ---------- ค้นหา ---------- */}
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ค้นทุกเดือน จากคำถาม / ข้อสรุป / แผนก')}
          className="h-8 pl-7 text-[11px]"
        />
      </div>

      {error && (
        <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] text-brass-lite">
          {error}
        </p>
      )}

      {/* ---------- รายการ ---------- */}
      {loading && !meetings.length ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-dim">
          <LoaderCircle className="size-4 animate-spin" /> {t('กำลังเปิดสมุดบันทึก')}
        </div>
      ) : !rows.length ? (
        <Hint className="py-4 text-center">
          {q
            ? t('ไม่พบบันทึกที่ตรงกับคำค้น')
            : pickedDay
              ? t('วันนี้ไม่มีประชุม')
              : meetings.length
                ? t('เดือนนี้ยังไม่มีประชุม')
                : t('ยังไม่มีการประชุม - ถามคำถามแรกแล้วเลขาฯ จะจดให้เอง')}
        </Hint>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {rows.map((m) => {
            const on = !!expanded[m.id];
            const mode = MEETING_MODES.find((x) => x.id === m.mode);
            const ops = (m.transcript ?? []) as Opinion[];
            const cs = (m.consults ?? []) as Consult[];
            const when = new Date(m.created_at);
            return (
              <article key={m.id} className="rounded-box border-2 border-ink-600 bg-ink-700 p-2">
                <button onClick={() => toggle(m.id)} aria-expanded={on} className="flex w-full items-start gap-1.5 text-left">
                  {on ? (
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-dim" />
                  ) : (
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-dim" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold leading-snug text-parchment">{m.question}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="text-[10px] text-dim">
                        {pickedDay ? fmtTime.format(when) : `${fmtDay.format(when)} ${fmtTime.format(when)}`}
                      </span>
                      {mode && <Badge variant="brass">{t(mode.th)}</Badge>}
                      {m.dept_ids.map((id) => {
                        const d = DEPT_BY_ID.get(id);
                        return d ? (
                          <span key={id} className="flex items-center gap-1 text-[10px] text-dim">
                            <i className="size-2 rounded-[2px]" style={{ background: d.color }} />
                            {t(d.shortTh)}
                          </span>
                        ) : null;
                      })}
                    </span>
                  </span>
                </button>

                {!!m.attendees?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.attendees.map((a) => (
                      <span
                        key={a.id}
                        title={`${a.name} - ${a.title}`}
                        className="flex items-center gap-1 rounded-box border border-ink-500 bg-ink-800 py-0.5 pl-0.5 pr-1.5 text-[10px]"
                      >
                        <Portrait palette={a.palette} size={1} className="block shrink-0" />
                        <b className="font-semibold text-parchment">{a.name}</b>
                      </span>
                    ))}
                  </div>
                )}

                {on && (
                  <div className="mt-1.5 border-t border-ink-600 pt-1.5">
                    {m.minutes && (
                      <div className="mb-1.5 rounded-box border border-wood-dark bg-wood-deep/40 px-2 py-1.5">
                        <div className="mb-0.5 text-[10px] font-semibold text-brass-lite">{t('รายงานการประชุม (เลขาฯ จด)')}</div>
                        <div className="text-[12px] leading-relaxed text-parchment-2">{fmt(m.minutes)}</div>
                      </div>
                    )}
                    {m.minutes && <div className="mb-0.5 text-[10px] font-semibold text-dim">{t('คำสรุปของประธาน')}</div>}
                    <div className="text-[12px] leading-relaxed text-parchment-2">
                      {m.summary ? fmt(m.summary) : <Hint>{t('ไม่มีข้อสรุปบันทึกไว้')}</Hint>}
                    </div>
                    {m.audience === 'customer' && (
                      <div className="mt-1.5 rounded-box border border-brass/50 bg-wood-deep/40 px-2 py-1.5">
                        <div className="mb-0.5 text-[10px] font-semibold text-brass">
                          {m.asked_by_label ? t('{name} ถาม', { name: m.asked_by_label }) : `${t('ลูกค้าถาม')}${m.source ? ` (${m.source.toUpperCase()})` : ''}`} - {t('ตอบลูกค้าว่า (สิ่งที่ลูกค้าเห็น)')}
                        </div>
                        <div className="text-[12px] leading-relaxed text-parchment-2">
                          {m.customer_reply ? fmt(m.customer_reply) : <Hint>{t('ยังไม่ได้ตอบ')}</Hint>}
                        </div>
                      </div>
                    )}
                    {(!!ops.length || !!cs.length) && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] text-dim hover:text-parchment">
                          {m.mode === 'relay'
                            ? t('บันทึกการเดินสาย ({n} แผนก)', { n: ops.length })
                            : t('บันทึกการถกกัน ({n} ความเห็น)', { n: ops.length })}
                        </summary>
                        <div className="mt-1 flex flex-col gap-1">
                          {ops.map((o, i) => {
                            const c = cs.find((x) => x.step === o.step);
                            return (
                              <div key={`${o.agentId}-${i}`}>
                                {c && (
                                  <div className="mb-1 rounded-box border border-dashed border-wood-dark bg-wood-deep/40 px-2 py-1 text-[11px] text-parchment-2">
                                    <b className="text-brass-lite">{t('{from} ถาม {to}:', { from: c.fromName, to: c.toName })}</b> {c.text}
                                  </div>
                                )}
                                <div className="rounded-box border border-ink-600 bg-ink-800 px-2 py-1 text-[11px]">
                                  <div className="mb-0.5 flex items-center gap-1.5">
                                    <b className="font-semibold text-wall-mid">{o.agentName}</b>
                                    <Badge>{o.agentRole}</Badge>
                                    {o.round === 2 && <Badge variant="brass">{t('รอบค้าน')}</Badge>}
                                  </div>
                                  <div className="text-parchment-2">{fmt(o.text)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                    <div className="mt-1.5 flex justify-end">
                      {confirm === m.id ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-[11px] text-brass-lite">{t('ลบทิ้งถาวร?')}</span>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>{t('ไม่ลบ')}</Button>
                          <Button size="sm" variant="danger" onClick={() => { setConfirm(null); onDelete(m.id); }}>
                            <Trash2 /> {t('ลบ')}
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(m.id)}>
                          <Trash2 /> {t('ลบบันทึกนี้')}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
