'use client';

import { BellRing, ChevronDown, ChevronRight, LoaderCircle, RefreshCw, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEPT_BY_ID } from '@/lib/departments';
import type { MeetingRow } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import { fmt } from '@/components/ui/rich-text';
import { getLang, t } from '@/lib/i18n';

/* ============================================================
   สมุดประชาสัมพันธ์ (operator) - ลูกค้าติดต่ออะไรเข้ามาบ้างในแต่ละวัน
   คู่กับสมุดเลขาฯ ที่เก็บการประชุมภายใน: อันนี้เก็บ "หน้าบ้าน" - ใครถามอะไร ตอบไปว่าอะไร
   เรื่องไหนต้องปรึกษาทีม (escalate) กางดูสรุปภายในได้ เพราะคนดูคือคนใน
   ============================================================ */

interface Props {
  open: boolean;
  onClose: () => void;
  meetings: MeetingRow[];
  loading: boolean;
  onRefresh: () => void;
}

const SOURCE_TH: Record<string, string> = { line: 'LINE', mcp: 'MCP', api: 'API', web: 'เว็บ' };

const locale = () => (getLang() === 'th' ? 'th-TH' : 'en-US');
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (key: string) => {
  const today = dayKey(new Date().toISOString());
  const yest = dayKey(new Date(Date.now() - 86400000).toISOString());
  const d = new Date(`${key}T00:00:00`);
  const th = d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return key === today ? t('วันนี้ · {date}', { date: th }) : key === yest ? t('เมื่อวาน · {date}', { date: th }) : th;
};
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

export default function OperatorPanel({ open, onClose, meetings, loading, onRefresh }: Props) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  // เฉพาะรายการที่ลูกค้าเป็นคนถาม - การประชุมภายในอยู่สมุดเลขาฯ
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return meetings
      .filter((m) => m.audience === 'customer')
      .filter((m) => !needle
        || m.question.toLowerCase().includes(needle)
        || (m.customer_reply ?? '').toLowerCase().includes(needle)
        || (m.summary ?? '').toLowerCase().includes(needle));
  }, [meetings, q]);

  const byDay = useMemo(() => {
    const map = new Map<string, MeetingRow[]>();
    for (const m of rows) {
      const k = dayKey(m.created_at);
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const total = rows.length;
  const escalatedCount = rows.filter((m) => m.mode === 'relay').length;
  const pending = rows.filter((m) => m.status === 'running').length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<BellRing />}
        title={t('สมุดประชาสัมพันธ์')}
        description={t('คำถามจากคนนอก (LINE / MCP / API) คำตอบที่ส่งกลับ และเรื่องที่ต้องปรึกษาทีม')}
        wide
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-dim">{t('ทั้งหมด')} <b className="text-parchment">{total}</b> {t('เรื่อง')}</span>
          <span className="text-dim">{t('ปรึกษาทีม')} <b className="text-brass">{escalatedCount}</b></span>
          {pending > 0 && <Badge variant="brass">{t('กำลังตอบ')} {pending}</Badge>}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-dim" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ค้นคำถาม/คำตอบ')} className="h-7 w-52 pl-6 text-[11px]" />
            </div>
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading} title={t('โหลดใหม่')}>
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            </Button>
          </div>
        </div>

        <div className="flex max-h-[62vh] min-h-0 flex-col gap-2 overflow-y-auto rounded-box border border-ink-600 bg-ink-900 p-2">
          {!byDay.length && (
            <Hint className="py-6 text-center">
              {loading ? t('กำลังโหลด...') : q ? t('ไม่พบรายการที่ค้น') : t('ยังไม่มีลูกค้าติดต่อเข้ามา - เมื่อมีคำถามผ่าน LINE หรือ token public จะขึ้นที่นี่')}
            </Hint>
          )}
          {byDay.map(([day, list]) => (
            <section key={day} className="flex flex-col gap-1">
              <h4 className="sticky top-0 z-10 flex items-center gap-2 bg-ink-900 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dim">
                {dayLabel(day)} <span className="font-normal normal-case tracking-normal">· {t('{n} เรื่อง', { n: list.length })}</span>
              </h4>
              {list.map((m) => {
                const on = openId === m.id;
                const escalated = m.mode === 'relay';
                const depts = (m.dept_ids ?? []).filter((d) => d !== 'pr');
                return (
                  <article key={m.id} className={`rounded-box border-2 px-2 py-1.5 ${escalated ? 'border-brass/40 bg-ink-800' : 'border-ink-600 bg-ink-800'}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="tabular-nums text-dim">{timeLabel(m.created_at)}</span>
                      <Badge variant="brass">{t(SOURCE_TH[m.source ?? ''] ?? m.source ?? '?')}</Badge>
                      {m.asked_by_label && <span className="text-parchment">{m.asked_by_label}</span>}
                      {m.status === 'running' && <Badge>{t('กำลังตอบ')}</Badge>}
                      {m.status === 'error' && <Badge variant="bad">{t('ล้มเหลว')}</Badge>}
                      {escalated && (
                        <span className="flex items-center gap-1 text-brass" title={t('PR ตอบเองไม่ได้ ต้องปรึกษาทีม')}>
                          <Users className="size-3" /> {t('ปรึกษา')} {depts.map((d) => t(DEPT_BY_ID.get(d)?.shortTh ?? d)).join(', ') || t('ทีม')}
                        </span>
                      )}
                    </div>
                    <div className="mb-1 rounded-box border border-wood-deep bg-wood-mid/60 px-2 py-1 text-[12px] text-parchment">
                      <span className="mr-1 text-[10px] text-parchment-2/70">{t('ลูกค้าถาม')}</span>
                      {m.question}
                    </div>
                    <div className="rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[12px] text-parchment-2">
                      <span className="mr-1 text-[10px] text-dim">{t('ตอบลูกค้าว่า')}</span>
                      {m.customer_reply ? fmt(m.customer_reply) : <span className="text-dim">{m.status === 'running' ? t('กำลังตอบ...') : t('(ยังไม่มีคำตอบ)')}</span>}
                    </div>
                    {(m.summary || m.minutes) && (
                      <button
                        onClick={() => setOpenId(on ? null : m.id)}
                        className="mt-1 flex items-center gap-1 text-[10px] text-dim hover:text-parchment"
                      >
                        {on ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        {t('สรุปภายใน (คนในเห็นเท่านั้น)')}{escalated ? t(' - จากที่ปรึกษาทีม') : ''}
                      </button>
                    )}
                    {on && (
                      <div className="mt-1 flex flex-col gap-1">
                        {m.summary && (
                          <div className="rounded-box border border-dashed border-ink-500 px-2 py-1 text-[11px] text-parchment-2">{fmt(m.summary)}</div>
                        )}
                        {m.minutes && (
                          <div className="rounded-box border border-wood-dark bg-wood-deep/40 px-2 py-1 text-[11px] text-parchment-2">
                            <div className="mb-0.5 text-[10px] font-semibold text-brass-lite">{t('รายงานการประชุม (เลขาฯ)')}</div>
                            {fmt(m.minutes)}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
