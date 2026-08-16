'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';
import type { ChatMessage, Opinion } from '@/lib/protocol';

/**
 * นับว่ารอบ 2 มีการค้านจริงกี่ข้อ — ใช้ตรวจว่าทีม "ถกจริง" หรือแค่พยักหน้าตามกัน
 * ถ้าตัวเลขนี้เป็น 0 บ่อย ๆ แปลว่า prompt รอบแย้งยังคุมโมเดลไม่อยู่
 */
function countObjections(t: Opinion[]): number {
  return t.filter((o) => {
    if (o.round !== 2) return false;
    const m = /(?:^|\n)\s*ค้าน\s*[:：]\s*(.+)/.exec(o.text);
    if (!m) return false;
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

/** ตัวจัดรูปแบบเล็ก ๆ: รองรับ **ตัวหนา** และ bullet — ไม่ใช้ innerHTML */
function fmt(text: string): ReactNode {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*[-•]\s+/.test(line);
    const body = bullet ? line.replace(/^\s*[-•]\s+/, '') : line;
    const parts = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    const nodes = parts.map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
    );
    if (!body.trim()) return <div key={i} className="sp" />;
    return bullet ? (
      <div key={i} className="li">
        <span className="dot">•</span>
        <span>{nodes}</span>
      </div>
    ) : (
      <p key={i}>{nodes}</p>
    );
  });
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

  return (
    <section className="panel chat">
      <header className="panel-head">
        <h2>ถามทีม</h2>
        <select value={deptChoice} onChange={(e) => onDeptChoice(e.target.value)} disabled={busy}>
          <option value="auto">เลือกแผนกอัตโนมัติ</option>
          {DEPARTMENTS.filter((d) => hiredDeptIds.includes(d.id)).map((d) => (
            <option key={d.id} value={d.id}>
              {d.emoji} {d.nameTh}
            </option>
          ))}
        </select>
      </header>

      <div className="log">
        {messages.map((m) => {
          const dept = m.departmentId ? DEPT_BY_ID.get(m.departmentId) : undefined;
          return (
            <article key={m.id} className={`msg ${m.role}`}>
              {m.role !== 'user' && (
                <div className="who" style={{ color: dept?.color }}>
                  {dept ? `${dept.emoji} ` : ''}
                  {m.authorName ?? 'ระบบ'}
                  {dept ? ` · ${dept.nameTh}` : ''}
                </div>
              )}
              <div className="body">
                {m.pending ? <span className="typing">{phase ?? 'กำลังเรียกทีมเข้าห้องประชุม…'}</span> : fmt(m.text)}
              </div>

              {m.proof && (
                <div className="transcript">
                  <button className="toggle" onClick={() => setOpen((o) => ({ ...o, [`p${m.id}`]: !o[`p${m.id}`] }))}>
                    {open[`p${m.id}`] ? '▾' : '▸'} 🧾 skill ที่ส่งไปจริง
                    <span className={m.proof.missing ? 'obj none' : 'obj ok'}>
                      {m.proof.missing
                        ? '· ไม่พบไฟล์ ใช้ข้อความสำรอง'
                        : `${m.proof.file} · ${m.proof.bytes.toLocaleString()} bytes`}
                    </span>
                  </button>
                  {open[`p${m.id}`] && (
                    <div className="rounds">
                      <p className="hint" style={{ margin: '4px 0 6px' }}>
                        นี่คือ system prompt ตัวจริงที่ถูกส่งไปที่ <code>{m.proof.provider}</code> /{' '}
                        <code>{m.proof.model}</code> ในนามของ <b>{m.proof.agentName}</b> —
                        ประกอบจากไฟล์ <code>{m.proof.file}</code> + บทบาท + มุมมองของแผนก
                        <br />
                        skill ถูกอ่าน<b>ตอนถามคำถามนี้</b> ไม่ใช่ตอนกดจ้าง
                      </p>
                      <pre className="prompt">{m.proof.systemPrompt}</pre>
                    </div>
                  )}
                </div>
              )}

              {!!m.transcript?.length && (
                <div className="transcript">
                  <button className="toggle" onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}>
                    {open[m.id] ? '▾' : '▸'} บันทึกการถกกัน ({m.transcript.length} ความเห็น)
                    {(() => {
                      const n = countObjections(m.transcript!);
                      return (
                        <span className={n > 0 ? 'obj ok' : 'obj none'}>
                          {n > 0 ? `⚔️ ค้านกัน ${n} ข้อ` : '· ไม่มีใครค้าน'}
                        </span>
                      );
                    })()}
                  </button>
                  {open[m.id] && (
                    <div className="rounds">
                      {[1, 2].map((r) => {
                        const rows = m.transcript!.filter((o) => o.round === r);
                        if (!rows.length) return null;
                        return (
                          <div key={r}>
                            <h4>{r === 1 ? 'รอบ 1 — ต่างคนต่างพูดจากหน้าที่ตัวเอง' : 'รอบ 2 — บังคับให้ค้าน'}</h4>
                            {rows.map((o, i) => (
                              <div key={`${o.agentId}-${i}`} className="op">
                                <b>
                                  {o.agentName} <span className="role">{o.agentRole}</span>
                                </b>
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

      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          placeholder={busy ? 'ทีมกำลังประชุมอยู่…' : 'พิมพ์คำถาม แล้วกด Enter'}
          rows={2}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          {busy ? '…' : 'ถาม'}
        </button>
      </form>
    </section>
  );
}
