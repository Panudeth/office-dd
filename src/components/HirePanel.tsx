'use client';

import { AlertTriangle, Minus, UserPlus, Users } from 'lucide-react';
import { DEPARTMENTS } from '@/lib/departments';
import type { EmployeeSnapshot } from '@/game/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';

interface Props {
  roster: EmployeeSnapshot[];
  seatsLeft: number;
  onHire: (deptId: string, count: number) => void;
  onFire: (deptId: string) => void;
  onFocus: (id: string | null) => void;
  disabled: boolean;
}

export default function HirePanel({
  roster, seatsLeft, onHire, onFire, onFocus, disabled,
}: Props) {
  return (
    <Panel>
      <PanelHeader icon={<Users />} title="จ้างพนักงาน">
        <Badge variant={seatsLeft > 0 ? 'default' : 'bad'}>โต๊ะว่าง {seatsLeft}</Badge>
      </PanelHeader>

      <PanelBody>
        <Hint>
          จ้าง 1 คนคือสร้าง agent 1 ตัว พร้อมบทบาทตามลำดับ ผู้เสนอ ผู้ค้าน ผู้ตรวจสอบ
          แต่ละบทบาทถูกประเมินคนละเกณฑ์ จึงเถียงกันจริง ต้องครบ 3 คนถึงได้การถกเต็มรูปแบบ
          <br />
          ไฟล์สกิลถูกอ่าน<b className="text-parchment">ตอนถามคำถาม</b> ไม่ใช่ตอนกดจ้าง
          ทุกคนในแผนกใช้ไฟล์เดียวกัน กางดูหลักฐานได้ใต้คำตอบ
        </Hint>

        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
          {DEPARTMENTS.map((d) => {
            const team = roster.filter((r) => r.deptId === d.id);
            return (
              <div
                key={d.id}
                className="rounded-box border-2 border-ink-600 border-l-4 bg-ink-700 p-2"
                style={{ borderLeftColor: d.color }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-parchment">{d.nameTh}</span>
                  <span
                    className="ml-auto min-w-5 rounded-box px-1.5 text-center text-[11px] font-bold text-ink-900"
                    style={{ background: team.length ? d.color : 'var(--color-ink-500)' }}
                  >
                    {team.length}
                  </span>
                </div>

                <p className="mb-1.5 mt-0.5 text-[11px] text-dim">
                  ใช้สกิล <code>skills/{d.skill}.md</code>
                </p>

                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => onHire(d.id, 1)}
                    disabled={disabled || seatsLeft < 1}
                  >
                    <UserPlus /> จ้าง
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => onHire(d.id, 3)}
                    disabled={disabled || seatsLeft < 3}
                  >
                    <Users /> ทีม 3 คน
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onFire(d.id)}
                    disabled={disabled || team.length === 0}
                    title="เลิกจ้างคนล่าสุดของแผนกนี้"
                  >
                    <Minus />
                    <span className="sr-only">เลิกจ้าง</span>
                  </Button>
                </div>

                {team.length === 1 && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-box border border-wood-dark bg-wood-deep/50 px-1.5 py-1 text-[11px] text-brass-lite">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" />
                    มีคนเดียว ยังไม่มีใครค้าน จ้างเพิ่มอีก 2 คนถึงจะถกกันได้
                  </p>
                )}

                {team.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {team.map((m) => (
                      <li key={m.id}>
                        <button
                          onClick={() => onFocus(m.id)}
                          title={`เลื่อนกล้องไปหา ${m.name}`}
                          className="flex items-center gap-1.5 rounded-box border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-[11px] hover:border-brass"
                        >
                          <i
                            className="size-2.5 rounded-[2px]"
                            style={{ background: m.color }}
                          />
                          <b className="font-semibold text-parchment">{m.name}</b>
                          <span className="text-dim">{m.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}
