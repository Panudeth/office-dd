'use client';

import {
  ChevronDown, ChevronRight, MessagesSquare, ReceiptText, SendHorizontal, Swords,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';
import type { ChatMessage, Opinion } from '@/lib/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Hint, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

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
  deptChoice: string;
  onDeptChoice: (v: string) => void;
  hiredDeptIds: string[];
  onSend: (q: string) => void;
}

/** ตัวจัดรูปแบบเล็ก ๆ รองรับ **ตัวหนา** และ bullet ไม่ใช้ innerHTML */
function fmt(text: string): ReactNode {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*[-•]\s+/.test(line);
    const body = bullet ? line.replace(/^\s*[-•]\s+/, '') : line;
    const parts = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    const nodes = parts.map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? (
        <strong key={j} className="font-semibold text-white">{p.slice(2, -2)}</strong>
      ) : (
        <span key={j}>{p}</span>
      ),
    );
    if (!body.trim()) return <div key={i} className="h-1.5" />;
    return bullet ? (
      <div key={i} className="flex gap-1.5">
        <span className="text-carpet-lite">-</span>
        <span>{nodes}</span>
      </div>
    ) : (
      <p key={i}>{nodes}</p>
    );
  });
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

export default function ChatPanel({
  messages, busy, phase, deptChoice, onDeptChoice, hiredDeptIds, onSend,
}: Props) {
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
  const hired = DEPARTMENTS.filter((d) => hiredDeptIds.includes(d.id));

  return (
    <Panel className="min-h-80 flex-1">
      <PanelHeader icon={<MessagesSquare />} title="ถามทีม">
        <Select value={deptChoice} onValueChange={onDeptChoice} disabled={busy}>
          <SelectTrigger className="h-6 w-40 border-wood-deep bg-wood-dark text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">เลือกแผนกอัตโนมัติ</SelectItem>
            {hired.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.nameTh}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelHeader>

      <PanelBody>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {messages.map((m) => {
            const dept = m.departmentId ? DEPT_BY_ID.get(m.departmentId) : undefined;
            const objections = m.transcript ? countObjections(m.transcript) : 0;

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
                  <div
                    className="mb-1 text-[11px] font-bold"
                    style={{ color: dept?.color ?? 'var(--color-wall-mid)' }}
                  >
                    {m.authorName ?? 'ระบบ'}
                    {dept && <span className="text-dim"> / {dept.nameTh}</span>}
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
                      label="skill ที่ส่งไปจริง"
                      tail={
                        <Badge variant={m.proof.missing ? 'bad' : 'good'}>
                          {m.proof.missing
                            ? 'ไม่พบไฟล์'
                            : `${m.proof.bytes.toLocaleString()} bytes`}
                        </Badge>
                      }
                    />
                    {open[`p${m.id}`] && (
                      <div className="mt-1">
                        <Hint className="mb-1.5">
                          นี่คือ system prompt ตัวจริงที่ถูกส่งไปที่ <code>{m.proof.provider}</code>{' '}
                          <code>{m.proof.model}</code> ในนามของ{' '}
                          <b className="text-parchment">{m.proof.agentName}</b> ประกอบจากไฟล์{' '}
                          <code>{m.proof.file}</code> บวกบทบาท บวกมุมมองของแผนก
                          <br />
                          skill ถูกอ่าน<b className="text-parchment">ตอนถามคำถามนี้</b> ไม่ใช่ตอนกดจ้าง
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
                      label={`บันทึกการถกกัน (${m.transcript.length} ความเห็น)`}
                      tail={
                        <Badge variant={objections > 0 ? 'brass' : 'default'}>
                          {objections > 0 ? `ค้านกัน ${objections} ข้อ` : 'ไม่มีใครค้าน'}
                        </Badge>
                      }
                    />
                    {open[m.id] && (
                      <div className="mt-1 flex flex-col gap-1.5">
                        {[1, 2].map((r) => {
                          const rows = m.transcript!.filter((o) => o.round === r);
                          if (!rows.length) return null;
                          return (
                            <div key={r}>
                              <h4 className="mb-1 text-[11px] font-semibold uppercase text-brass">
                                {r === 1
                                  ? 'รอบ 1 ต่างคนต่างพูดจากหน้าที่ตัวเอง'
                                  : 'รอบ 2 บังคับให้ค้าน'}
                              </h4>
                              {rows.map((o, i) => (
                                <div
                                  key={`${o.agentId}-${i}`}
                                  className="mb-1 rounded-box border border-ink-600 bg-ink-800 px-2 py-1.5 text-[12px]"
                                >
                                  <div className="mb-0.5 flex items-center gap-1.5">
                                    <b className="text-[11px] font-semibold text-wall-mid">
                                      {o.agentName}
                                    </b>
                                    <Badge>{o.agentRole}</Badge>
                                  </div>
                                  <div>{fmt(o.text)}</div>
                                </div>
                              ))}
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
