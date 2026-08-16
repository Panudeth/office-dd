'use client';

import { AlertTriangle, Lock, Minus, NotebookPen, UserPlus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEPARTMENTS } from '@/lib/departments';
import type { AgentState, EmployeeSnapshot } from '@/game/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint, Panel, PanelBody } from '@/components/ui/panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Portrait from '@/components/Portrait';

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
  idle: 'ยืนเล่น',
};

/** สถานะที่แปลว่ากำลังทำงานที่ผู้ใช้สั่ง - เน้นสีให้เห็นว่าใครกำลังยุ่ง */
const BUSY_STATES: AgentState[] = ['meet', 'think', 'report'];

interface Props {
  roster: EmployeeSnapshot[];
  seatsLeft: number;
  /** ที่ว่างในห้องของแต่ละแผนก (deptId -> จำนวน) */
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
  /** เนื้อหาแท็บสมุดเลขาฯ - ประกอบจากข้างนอก (page มีข้อมูล meetings อยู่แล้ว) */
  secretary: ReactNode;
  meetingCount: number;
}

export default function HirePanel({
  roster, seatsLeft, roomLeft, onHire, onFire, onFocus, disabled, lock, onUnlock,
  tab, onTab: setTab, secretary, meetingCount,
}: Props) {
  const off = disabled || !!lock;

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
            <Users /> พนักงาน {roster.length}
          </TabsTrigger>
          <TabsTrigger value="hire">
            <UserPlus /> จ้างเพิ่ม
          </TabsTrigger>
          <TabsTrigger value="notes">
            <NotebookPen /> สมุดเลขาฯ{meetingCount > 0 ? ` ${meetingCount}` : ''}
          </TabsTrigger>
          <Badge
            variant={seatsLeft > 0 ? 'default' : 'bad'}
            className="ml-auto self-center"
          >
            โต๊ะว่าง {seatsLeft}
          </Badge>
        </TabsList>

        {/* ---------- แท็บพนักงานปัจจุบัน ---------- */}
        <TabsContent value="staff" className="min-h-0">
          <PanelBody className="gap-1.5">
            {lockNote}

            {!roster.length ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <Hint>ยังไม่มีพนักงานในบริษัท</Hint>
                <Button size="sm" variant="primary" onClick={() => setTab('hire')}>
                  <UserPlus /> ไปหน้าจ้างพนักงาน
                </Button>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {groups.map(({ dept, team }) => (
                  <div key={dept.id}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <i className="size-2.5 rounded-[2px]" style={{ background: dept.color }} />
                      <span className="text-[11px] font-semibold text-parchment">
                        {dept.nameTh}
                      </span>
                      <span className="text-[11px] text-dim">{team.length} คน</span>
                      {team.length === 1 && (
                        <span
                          className="ml-auto flex items-center gap-1 text-[10px] text-brass-lite"
                          title="มีคนเดียวจะไม่มีใครค้าน ต้องครบ 3 คนถึงถกกันได้"
                        >
                          <AlertTriangle className="size-3" /> ยังไม่มีใครค้าน
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5">
                      {team.map((m) => {
                        const working = BUSY_STATES.includes(m.state);
                        return (
                          <button
                            key={m.id}
                            onClick={() => onFocus(m.id)}
                            title={`เลื่อนกล้องไปหา ${m.name}`}
                            className="flex items-center gap-1.5 rounded-box border-2 border-ink-600 bg-ink-700 p-1 text-left hover:border-brass"
                          >
                            {/* รูปนี้วาดด้วยโค้ดเดียวกับตัวบนแผนที่ สีจึงตรงกันเสมอ */}
                            <span
                              className="shrink-0 rounded-[3px] border border-ink-500"
                              style={{ background: 'rgba(0,0,0,.25)' }}
                            >
                              <Portrait palette={m.palette} size={2} className="block" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-semibold text-parchment">
                                {m.name}
                              </span>
                              <span className="block truncate text-[10px] text-dim">
                                {m.title}
                              </span>
                              <span
                                className={`block truncate text-[10px] ${
                                  working ? 'text-brass' : 'text-carpet-lite'
                                }`}
                              >
                                {STATE_TH[m.state]}
                              </span>
                            </span>
                          </button>
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

            <Hint>
              จ้าง 1 คนคือสร้าง agent 1 ตัว พร้อมบทบาทตามลำดับ ผู้เสนอ ผู้ค้าน ผู้ตรวจสอบ
              แต่ละบทบาทถูกประเมินคนละเกณฑ์ จึงเถียงกันจริง ต้องครบ 3 คนถึงได้การถกเต็มรูปแบบ
              <br />
              ไฟล์สกิลถูกอ่าน<b className="text-parchment">ตอนถามคำถาม</b> ไม่ใช่ตอนกดจ้าง
            </Hint>

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
                        disabled={off || (roomLeft[d.id] ?? 0) < 1}
                        title={lock?.text ?? ((roomLeft[d.id] ?? 0) < 1 ? 'ห้องแผนกนี้เต็มแล้ว' : undefined)}
                                              >
                        <UserPlus /> จ้าง
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => onHire(d.id, 3)}
                        disabled={off || (roomLeft[d.id] ?? 0) < 3}
                        title={lock?.text ?? ((roomLeft[d.id] ?? 0) < 3 ? `ห้องเหลือที่ ${roomLeft[d.id] ?? 0} ที่` : undefined)}
                                              >
                        <Users /> ทีม 3 คน
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onFire(d.id)}
                        disabled={off || team.length === 0}
                        title={lock?.text ?? 'เลิกจ้างคนล่าสุดของแผนกนี้'}
                      >
                        <Minus />
                        <span className="sr-only">เลิกจ้าง</span>
                      </Button>
                    </div>

                    {team.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {team.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => onFocus(m.id)}
                            title={`เลื่อนกล้องไปหา ${m.name}`}
                            className="flex items-center gap-1 rounded-box border border-ink-500 bg-ink-800 py-0.5 pl-0.5 pr-1.5 text-[11px] hover:border-brass"
                          >
                            <Portrait palette={m.palette} size={1} className="block shrink-0" />
                            <b className="font-semibold text-parchment">{m.name}</b>
                            <span className="text-dim">{m.title}</span>
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
        <TabsContent value="notes" className="min-h-0">
          {secretary}
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
