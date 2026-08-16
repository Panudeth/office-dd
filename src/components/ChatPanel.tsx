'use client';

import {
  ChevronDown, ChevronRight, MessagesSquare, ReceiptText, SendHorizontal, Swords,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEPT_BY_ID } from '@/lib/departments';
import { MEETING_MODES, type ChatMessage, type Opinion } from '@/lib/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Hint, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { fmt } from '@/components/ui/rich-text';

/**
 * นับว่ารอบ 2 มีการค้านจริงกี่ข้อ ใช้ตรวจว่าทีมถกจริงหรือแค่พยักหน้าตามกัน
 * ถ้าตัวเลขนี้เป็น 0 บ่อย ๆ แปลว่า prompt รอบแย้งยังคุมโมเดลไม่อยู่
 */
function countObjections(t: Opinion[]): number {
  return t.filter((o) => {
    if (o.round !== 2) return false;
    const m = /(?:^|\n)\s*ค้าน\s*[:：]\s*(.+)/.exec(o.text);
    if (!m) return false;
    // ตัวที่สองในวงเล็บคือขีดยาว โมเดลชอบตอบมาแบบนั้นแทนขีดสั้น เลยรับทั้งคู่
    return !/^(ไม่มี|ไม่พบ|-|—|เห็นด้วย)/.test(m[1].trim());
  }).length;
}

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  phase: string | null;
  onSend: (q: string) => void;
}

/** ปุ่มพับ/กางที่ใช้ซ้ำสองที่ ให้หน้าตาเหมือนกันเป๊ะ */
function Disclosure({
  open, onToggle, icon, label, tail,
}: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
  tail?: ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-1.5 py-0.5 text-left text-[11px] text-dim hover:text-parchment"
    >
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      <span className="[&_svg]:size-3.5">{icon}</span>
      {label}
      {tail && <span className="ml-auto">{tail}</span>}
    </button>
  );
}

export default function ChatPanel({ messages, busy, phase, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, phase]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    onSend(q);
  };

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <Panel className="min-h-0 flex-1">
      {/* ไม่มีตัวเลือกแผนกตรงนี้แล้ว - เลขาฯ เสนอให้ในระเบียบวาระ แล้วแก้ได้ทีเดียวตรงนั้น */}
      <PanelHeader icon={<MessagesSquare />} title="ถามทีม" />

      <PanelBody>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {messages.map((m) => {
            const dept = m.departmentId ? DEPT_BY_ID.get(m.departmentId) : undefined;
            const objections = m.transcript ? countObjections(m.transcript) : 0;
            const relay = m.mode === 'relay';

            return (
              <article
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'max-w-[88%] self-end rounded-box border-2 border-wood-deep bg-wood-mid px-2.5 py-1.5 text-[13px] leading-relaxed'
                    : m.role === 'system'
                      ? 'rounded-box border border-dashed border-ink-500 px-2.5 py-1.5 text-[12px] leading-relaxed text-dim'
                      : 'rounded-box border-2 border-ink-600 bg-ink-700 px-2.5 py-1.5 text-[13px] leading-relaxed'
                }
              >
                {m.role !== 'user' && (
                  <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: dept?.color ?? 'var(--color-wall-mid)' }}
                    >
                      {m.authorName ?? 'ระบบ'}
                      {dept && <span className="text-dim"> / {dept.nameTh}</span>}
                    </span>
                    {m.mode && (
                      <Badge variant="brass">
                        {MEETING_MODES.find((x) => x.id === m.mode)?.th}
                      </Badge>
                    )}
                    {/* แผนกที่เข้าประชุมจริง - จุดสีเดียวกับเสื้อพนักงานบนแผนที่ */}
                    {m.deptIds?.map((id) => {
                      const d = DEPT_BY_ID.get(id);
                      if (!d) return null;
                      return (
                        <span
                          key={id}
                          className="flex items-center gap-1 text-[10px] text-dim"
                          title={d.nameTh}
                        >
                          <i className="size-2 rounded-[2px]" style={{ background: d.color }} />
                          {d.shortTh}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div>
                  {m.pending ? (
                    <span className="caret text-brass">
                      {phase ?? 'กำลังเรียกทีมเข้าห้องประชุม'}
                    </span>
                  ) : (
                    fmt(m.text)
                  )}
                </div>

                {m.proof && (
                  <div className="mt-1.5 border-t border-ink-600 pt-1">
                    <Disclosure
                      open={!!open[`p${m.id}`]}
                      onToggle={() => toggle(`p${m.id}`)}
                      icon={<ReceiptText />}
                      label={`skill ที่ส่งไปจริง (${m.proof.files.length} ไฟล์)`}
                      tail={
                        <Badge variant={m.proof.files.some((f) => f.missing) ? 'bad' : 'good'}>
                          {m.proof.files.some((f) => f.missing)
                            ? 'มีไฟล์ที่หาไม่เจอ'
                            : `${m.proof.files
                                .reduce((n, f) => n + f.bytes, 0)
                                .toLocaleString()} bytes`}
                        </Badge>
                      }
                    />
                    {open[`p${m.id}`] && (
                      <div className="mt-1">
                        <Hint className="mb-1.5">
                          ประชุมนี้อ่านสกิลของแต่ละแผนกแยกไฟล์กัน คนของแผนกไหนอ่านของแผนกนั้น
                          <br />
                          {m.proof.files.map((f) => (
                            <span key={f.deptId} className="mt-0.5 block">
                              {f.deptName}: <code>{f.file}</code>{' '}
                              {f.missing ? (
                                <b className="text-brass">ไม่พบไฟล์ ใช้ข้อความสำรอง</b>
                              ) : (
                                `${f.bytes.toLocaleString()} bytes`
                              )}
                            </span>
                          ))}
                        </Hint>
                        <Hint className="mb-1.5">
                          ด้านล่างคือ system prompt ตัวจริงที่ถูกส่งไปที่{' '}
                          <code>{m.proof.provider}</code> <code>{m.proof.model}</code> ในนามของ{' '}
                          <b className="text-parchment">{m.proof.agentName}</b> ประกอบจากสกิลของแผนกเขา
                          บวกบทบาท บวกมุมมองของแผนก
                          <br />
                          skill ถูกอ่าน<b className="text-parchment">ตอนถามคำถามนี้</b> ไม่ใช่ตอนกดจ้าง
                          {m.proof.company && (
                            <>
                              <br />
                              ข้อมูลบริษัทที่แนบไป:{' '}
                              {m.proof.company.profileChars > 0 ? `โปรไฟล์ ${m.proof.company.profileChars.toLocaleString()} ตัวอักษร` : 'ไม่มีโปรไฟล์'}
                              {m.proof.company.noteChars > 0 && ` · โน้ตแผนก ${m.proof.company.noteChars.toLocaleString()} ตัวอักษร`}
                              {m.proof.company.chunkCount > 0 && ` · เอกสาร ${m.proof.company.chunkCount} ชิ้น`}
                              {m.proof.company.profileChars === 0 && (
                                <b className="text-brass"> - กรอกที่ปุ่มข้อมูลบริษัทแล้ว agent จะรู้ว่าเราเป็นใคร</b>
                              )}
                            </>
                          )}
                        </Hint>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-box border border-ink-600 bg-ink-900 p-2 font-mono text-[11px] leading-relaxed text-wall-top">
                          {m.proof.systemPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {!!m.transcript?.length && (
                  <div className="mt-1.5 border-t border-ink-600 pt-1">
                    <Disclosure
                      open={!!open[m.id]}
                      onToggle={() => toggle(m.id)}
                      icon={<Swords />}
                      label={
                        relay
                          ? `บันทึกการเดินสาย (${m.transcript.length} แผนก)`
                          : `บันทึกการถกกัน (${m.transcript.length} ความเห็น)`
                      }
                      tail={
                        relay ? (
                          <Badge variant="brass">ส่งต่อ {m.transcript.length} ทอด</Badge>
                        ) : (
                          <Badge variant={objections > 0 ? 'brass' : 'default'}>
                            {objections > 0 ? `ค้านกัน ${objections} ข้อ` : 'ไม่มีใครค้าน'}
                          </Badge>
                        )
                      }
                    />
                    {open[m.id] && (
                      <div className="mt-1 flex flex-col gap-1.5">
                        {relay
                          ? /* สายพาน: จับคู่คำถามที่ส่งต่อกับคำตอบของทอดนั้น จะได้เห็นที่มา */
                            m.transcript!.map((o, i) => {
                              const c = m.consults?.find((x) => x.step === o.step);
                              const od = o.deptId ? DEPT_BY_ID.get(o.deptId) : undefined;
                              return (
                                <div key={`${o.agentId}-${i}`}>
                                  <h4 className="mb-1 text-[11px] font-semibold uppercase text-brass">
                                    ทอดที่ {o.step ?? i + 1}
                                    {od && ` - ${od.nameTh}`}
                                  </h4>
                                  {c && (
                                    <div className="mb-1 rounded-box border border-dashed border-wood-dark bg-wood-deep/40 px-2 py-1.5 text-[12px] text-parchment-2">
                                      <div className="mb-0.5 text-[11px] font-semibold text-brass-lite">
                                        {c.fromName} เดินไปถาม {c.toName}
                                      </div>
                                      <div>{fmt(c.text)}</div>
                                    </div>
                                  )}
                                  <div className="mb-1 rounded-box border border-ink-600 bg-ink-800 px-2 py-1.5 text-[12px]">
                                    <div className="mb-0.5 flex items-center gap-1.5">
                                      <b className="text-[11px] font-semibold text-wall-mid">
                                        {o.agentName}
                                      </b>
                                      <Badge>{o.agentRole}</Badge>
                                      {od && (
                                        <span className="text-[10px] text-dim">{od.shortTh}</span>
                                      )}
                                    </div>
                                    <div>{fmt(o.text)}</div>
                                  </div>
                                </div>
                              );
                            })
                          : [1, 2].map((r) => {
                              const rows = m.transcript!.filter((o) => o.round === r);
                              if (!rows.length) return null;
                              return (
                                <div key={r}>
                                  <h4 className="mb-1 text-[11px] font-semibold uppercase text-brass">
                                    {r === 1
                                      ? 'รอบ 1 ต่างคนต่างพูดจากหน้าที่ตัวเอง'
                                      : 'รอบ 2 บังคับให้ค้าน'}
                                  </h4>
                                  {rows.map((o, i) => {
                                    const od = o.deptId ? DEPT_BY_ID.get(o.deptId) : undefined;
                                    return (
                                      <div
                                        key={`${o.agentId}-${i}`}
                                        className="mb-1 rounded-box border border-ink-600 bg-ink-800 px-2 py-1.5 text-[12px]"
                                      >
                                        <div className="mb-0.5 flex items-center gap-1.5">
                                          <b className="text-[11px] font-semibold text-wall-mid">
                                            {o.agentName}
                                          </b>
                                          <Badge>{o.agentRole}</Badge>
                                          {od && (
                                            <span
                                              className="flex items-center gap-1 text-[10px] text-dim"
                                            >
                                              <i
                                                className="size-2 rounded-[2px]"
                                                style={{ background: od.color }}
                                              />
                                              {od.shortTh}
                                            </span>
                                          )}
                                        </div>
                                        <div>{fmt(o.text)}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          <div ref={endRef} />
        </div>

        <form className="flex items-end gap-1.5" onSubmit={submit}>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            placeholder={busy ? 'ทีมกำลังประชุมอยู่' : 'พิมพ์คำถาม แล้วกด Enter'}
            rows={2}
            disabled={busy}
            className="h-auto"
          />
          <Button type="submit" variant="primary" size="lg" disabled={busy || !draft.trim()}>
            <SendHorizontal /> ถาม
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}
