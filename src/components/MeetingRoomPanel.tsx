'use client';

import { Crown, MessagesSquare, NotebookPen } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { DEPT_BY_ID } from '@/lib/departments';
import { MEETING_MODES, type ChatMessage, type Consult, type Opinion } from '@/lib/protocol';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Hint } from '@/components/ui/panel';
import { fmt } from '@/components/ui/rich-text';
import MeetingStatus, { type Activity } from '@/components/MeetingStatus';
import { t } from '@/lib/i18n';

/* ============================================================
   ห้องประชุม - มุมมองเต็มจอของการประชุมที่กำลังเกิด (หรือเพิ่งจบ)
   ครึ่งบน: ใครกำลังทำอะไร นานแค่ไหน  ครึ่งล่าง: บทสนทนาสด ตามลำดับที่พูดจริง
   มีไว้เพราะแผงเล็กเหนือแชทบอกได้แค่สถานะ แต่ไม่เห็นว่าเขาคุยอะไรกันไปแล้วบ้าง
   ============================================================ */

interface Props {
  open: boolean;
  onClose: () => void;
  /** ข้อความประชุมในแชท - transcript/consults ถูกเติมเข้ามาสด ๆ ระหว่างประชุม */
  message: ChatMessage | null;
  question: string;
  startedAt: number | null;
  phase: string | null;
  activities: Activity[];
}

export default function MeetingRoomPanel({
  open, onClose, message, question, startedAt, phase, activities,
}: Props) {
  const ops: Opinion[] = message?.transcript ?? [];
  const cs: Consult[] = message?.consults ?? [];
  const isRelay = message?.mode === 'relay';
  const finished = !!message && !message.pending;

  // เลื่อนลงล่างเองเมื่อมีคนพูดเพิ่ม - ผู้ใช้เปิดค้างไว้ดูได้เหมือนดูถ่ายทอดสด
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, ops.length, cs.length, finished, message?.minutes]);

  // โต๊ะกลม: แบ่งเป็นรอบ 1 / รอบ 2  สายพาน: ไล่ตามขั้น (คำถาม -> คำตอบ)
  const rounds: { title: string; items: Opinion[] }[] = isRelay
    ? [{ title: t('การเดินสาย'), items: ops }]
    : [
        { title: t('รอบแรก - แต่ละแผนกให้ความเห็น'), items: ops.filter((o) => o.round === 1) },
        { title: t('รอบสอง - ค้านข้ามแผนก'), items: ops.filter((o) => o.round === 2) },
      ].filter((r) => r.items.length);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<MessagesSquare />}
        title={t('ห้องประชุม')}
        description={question || t('ยังไม่มีการประชุม')}
        wide
      >
        <MeetingStatus startedAt={startedAt} phase={phase} activities={activities} />

        <div className="flex max-h-[52vh] min-h-0 flex-col gap-2 overflow-y-auto rounded-box border border-ink-600 bg-ink-900 p-2">
          {message?.mode && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
              <Badge variant="brass">{t(MEETING_MODES.find((x) => x.id === message.mode)?.th ?? '')}</Badge>
              {message.deptIds?.map((id) => {
                const d = DEPT_BY_ID.get(id);
                return d ? (
                  <span key={id} className="flex items-center gap-1">
                    <i className="size-2 rounded-[2px]" style={{ background: d.color }} />
                    {t(d.shortTh)}
                  </span>
                ) : null;
              })}
            </div>
          )}

          {!ops.length && !cs.length && (
            <Hint className="py-4 text-center">
              {startedAt ? t('ยังไม่มีใครพูด - รอคำตอบแรกจากห้องประชุม') : t('ยังไม่มีการประชุม - พิมพ์คำถามในช่องแชทเพื่อเริ่ม')}
            </Hint>
          )}

          {rounds.map((r) => (
            <section key={r.title} className="flex flex-col gap-1">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-dim">{r.title}</h4>
              {r.items.map((o, i) => {
                const od = o.deptId ? DEPT_BY_ID.get(o.deptId) : undefined;
                const c = isRelay ? cs.find((x) => x.step === o.step) : undefined;
                return (
                  <div key={`${o.agentId}-${o.round}-${o.step ?? i}`}>
                    {c && (
                      <div className="mb-1 rounded-box border border-dashed border-wood-dark bg-wood-deep/40 px-2 py-1 text-[11px] text-parchment-2">
                        <b className="text-brass-lite">{t('{from} ถาม {to}:', { from: c.fromName, to: c.toName })}</b> {c.text}
                      </div>
                    )}
                    <div className="rounded-box border border-ink-600 bg-ink-800 px-2 py-1.5 text-[12px]">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                        <b className="text-[11px] font-semibold text-wall-mid">{o.agentName}</b>
                        <Badge>{o.agentRole}</Badge>
                        {od && (
                          <span className="flex items-center gap-1 text-[10px] text-dim">
                            <i className="size-2 rounded-[2px]" style={{ background: od.color }} />
                            {t(od.shortTh)}
                          </span>
                        )}
                        {o.round === 2 && !isRelay && <Badge variant="brass">{t('ค้าน')}</Badge>}
                        {o.model && <span className="ml-auto text-[10px] text-dim/80">{o.model}</span>}
                      </div>
                      <div className="text-parchment-2">{fmt(o.text)}</div>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}

          {finished && (
            <section className="flex flex-col gap-1">
              <h4 className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brass">
                <Crown className="size-3" /> {t('คำสรุปของประธาน')}{message?.authorName ? ` - ${message.authorName}` : ''}
                {message?.model && <span className="ml-auto font-normal normal-case tracking-normal text-dim/80">{message.model}</span>}
              </h4>
              <div className="rounded-box border-2 border-brass/50 bg-ink-800 px-2 py-1.5 text-[12px] text-parchment">
                {fmt(message!.text)}
              </div>
            </section>
          )}

          {message?.customerReply && (
            <section className="flex flex-col gap-1">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-brass">{t('ตอบลูกค้าว่า (กรองแล้ว - ลูกค้าเห็นแค่นี้)')}</h4>
              <div className="rounded-box border border-brass/50 bg-wood-deep/40 px-2 py-1.5 text-[12px] text-parchment-2">
                {fmt(message.customerReply)}
              </div>
            </section>
          )}

          {message?.minutes && (
            <section className="flex flex-col gap-1">
              <h4 className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brass-lite">
                <NotebookPen className="size-3" /> {t('รายงานการประชุม (เลขาฯ จด)')}
              </h4>
              <div className="rounded-box border border-wood-dark bg-wood-deep/40 px-2 py-1.5 text-[12px] text-parchment-2">
                {fmt(message.minutes)}
              </div>
            </section>
          )}

          <div ref={endRef} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
