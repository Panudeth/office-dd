'use client';

import { Check, Clock, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEPT_BY_ID } from '@/lib/departments';
import type { WorkTask } from '@/lib/protocol';
import type { Palette } from '@/game/types';
import Portrait from '@/components/Portrait';
import { Button } from '@/components/ui/button';

/* ============================================================
   แผงสถานะการประชุม - บอกว่าใครกำลังทำอะไร นานแค่ไหน ด้วยโมเดลไหน
   มีไว้เพราะประชุม 12 คนกับโมเดลในเครื่องอาจนานเป็นนาที
   ถ้าเห็นแค่ "ทีมกำลังถกกัน..." บรรทัดเดียว จะแยกไม่ออกว่าช้าปกติหรือค้าง
   ============================================================ */

export interface Activity {
  agentId: string;
  name: string;
  deptId?: string;
  palette?: Palette;
  model?: string;
  task: WorkTask;
  label: string;
  /** เวลาเริ่มคิด (ms) */
  startedAt: number;
  /** เวลาที่ตอบเสร็จ - undefined คือยังคิดอยู่ */
  doneAt?: number;
  /** ล้มเหลว (เช่นเลขาฯ เขียนรายงานไม่สำเร็จ) */
  failed?: boolean;
  /** งานที่ทำเสร็จไปแล้วก่อนหน้า (รอบก่อน) - เก็บไว้บอกเวลารวมต่อคน */
  history: { task: WorkTask; ms: number }[];
}

interface Props {
  /** null = ไม่ได้ประชุมอยู่ */
  startedAt: number | null;
  phase: string | null;
  activities: Activity[];
  onClose?: () => void;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} วิ` : `${Math.floor(s / 60)} นาที ${s % 60} วิ`;
};

export default function MeetingStatus({ startedAt, phase, activities, onClose }: Props) {
  // เดินนาฬิกาทุกวินาทีเฉพาะตอนมีคนยังคิดอยู่ - จบแล้วหยุด ไม่ให้ re-render ทิ้งเปล่า
  const [now, setNow] = useState(() => Date.now());
  const running = startedAt !== null && activities.some((a) => !a.doneAt);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  if (startedAt === null && !activities.length) return null;

  const total = (running ? now : Math.max(startedAt ?? 0, ...activities.map((a) => a.doneAt ?? 0))) - (startedAt ?? 0);
  const thinking = activities.filter((a) => !a.doneAt).length;
  const aborted = !running && activities.some((a) => a.failed && a.task !== 'minutes');
  // คนที่คิดนานสุดตอนนี้ - ชี้ตัวให้เห็นว่าคอขวดอยู่ตรงไหน
  const slowest = activities.filter((a) => !a.doneAt).sort((a, b) => a.startedAt - b.startedAt)[0];

  return (
    <div className="mb-1.5 shrink-0 rounded-box border-2 border-ink-500 bg-ink-800 text-[11px]">
      <div className="flex items-center gap-2 border-b border-ink-600 px-2 py-1">
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-brass" />
        ) : aborted ? (
          <X className="size-3.5 shrink-0 text-rug-lite" />
        ) : (
          <Check className="size-3.5 shrink-0 text-carpet-lite" />
        )}
        <span className={`min-w-0 flex-1 truncate ${aborted ? 'text-rug-lite' : 'text-parchment'}`}>
          {running ? phase ?? 'กำลังประชุม' : aborted ? 'ประชุมหยุดกลางทาง - ดูสาเหตุในแชท' : 'ประชุมเสร็จแล้ว'}
        </span>
        {running && thinking > 0 && (
          <span className="shrink-0 text-dim">{thinking} คนกำลังคิด</span>
        )}
        <span className="flex shrink-0 items-center gap-1 text-dim" title="เวลารวมตั้งแต่เริ่มประชุม">
          <Clock className="size-3" /> {fmt(total)}
        </span>
        {!running && onClose && (
          <Button size="icon" variant="ghost" className="size-5" title="ซ่อน" onClick={onClose}>
            <X className="size-3" />
          </Button>
        )}
      </div>

      <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto px-1.5 py-1">
        {activities.map((a) => {
          const d = a.deptId ? DEPT_BY_ID.get(a.deptId) : undefined;
          const elapsed = (a.doneAt ?? now) - a.startedAt;
          const prev = a.history.reduce((n, h) => n + h.ms, 0);
          const isSlow = slowest?.agentId === a.agentId && elapsed > 20000;
          return (
            <li key={a.agentId} className="flex items-center gap-1.5">
              {a.palette ? (
                <Portrait palette={a.palette} size={1} className="block shrink-0" />
              ) : (
                <span className="inline-block size-4 shrink-0" />
              )}
              <span className="w-24 shrink-0 truncate font-semibold text-parchment" title={a.name}>
                {a.name}
              </span>
              {d && <i className="size-2 shrink-0 rounded-[2px]" style={{ background: d.color }} title={d.nameTh} />}
              <span className={`min-w-0 flex-1 truncate ${a.doneAt ? 'text-dim' : 'text-parchment-2'}`}>
                {a.failed ? (
                  <span className="text-rug-lite">ไม่สำเร็จ - {a.label}</span>
                ) : a.doneAt ? (
                  <>ตอบแล้ว · {a.label}</>
                ) : (
                  <>กำลัง{a.label}…</>
                )}
              </span>
              {a.model && (
                <span className="hidden max-w-28 shrink-0 truncate text-[10px] text-dim/80 sm:inline" title={a.model}>
                  {a.model}
                </span>
              )}
              <span
                className={`w-16 shrink-0 text-right tabular-nums ${
                  a.failed ? 'text-rug-lite' : a.doneAt ? 'text-carpet-lite' : isSlow ? 'text-brass' : 'text-parchment-2'
                }`}
                title={prev ? `รอบก่อนหน้ารวม ${fmt(prev)}` : undefined}
              >
                {a.doneAt ? <Check className="mr-0.5 inline size-3" /> : null}
                {fmt(elapsed)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
