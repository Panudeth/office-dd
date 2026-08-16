'use client';

import { DEPARTMENTS } from '@/lib/departments';
import type { EmployeeSnapshot } from '@/game/types';

interface Props {
  roster: EmployeeSnapshot[];
  seatsLeft: number;
  onHire: (deptId: string, count: number) => void;
  onFire: (deptId: string) => void;
  onFocus: (id: string | null) => void;
  disabled: boolean;
}

export default function HirePanel({ roster, seatsLeft, onHire, onFire, onFocus, disabled }: Props) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>จ้างพนักงาน</h2>
        <span className="muted">โต๊ะว่าง {seatsLeft}</span>
      </header>

      <p className="hint">
        จ้าง = สร้าง agent พร้อม <b>บทบาทตามลำดับ</b> 🎯 ผู้เสนอ → ⚔️ ผู้ค้าน → 🔍 ผู้ตรวจสอบ<br />
        แต่ละบทบาทถูกประเมินคนละเกณฑ์ จึงเถียงกันจริง — จ้างครบ 3 คนถึงได้การถกเต็มรูปแบบ<br />
        <b>ไฟล์สกิลถูกอ่านตอนถามคำถาม</b> ไม่ใช่ตอนกดจ้าง ทุกคนในแผนกใช้ไฟล์เดียวกัน
        กางดู &ldquo;🧾 skill ที่ส่งไปจริง&rdquo; ใต้คำตอบเพื่อตรวจได้
      </p>

      <div className="dept-list">
        {DEPARTMENTS.map((d) => {
          const team = roster.filter((r) => r.deptId === d.id);
          return (
            <div key={d.id} className="dept" style={{ borderLeftColor: d.color }}>
              <div className="dept-top">
                <span className="dept-name">
                  {d.emoji} {d.nameTh}
                </span>
                <span className="count" style={{ background: d.color }}>
                  {team.length}
                </span>
              </div>
              <div className="dept-skill">
                ใช้สกิล <code>skills/{d.skill}.md</code>
              </div>
              <div className="dept-actions">
                <button
                  onClick={() => onHire(d.id, 1)}
                  disabled={disabled || seatsLeft < 1}
                  title="จ้างเพิ่ม 1 คน"
                >
                  + จ้าง
                </button>
                <button
                  onClick={() => onHire(d.id, 3)}
                  disabled={disabled || seatsLeft < 3}
                  title="จ้างทีมครบ 3 คน"
                >
                  + ทีม 3 คน
                </button>
                <button
                  onClick={() => onFire(d.id)}
                  disabled={disabled || team.length === 0}
                  className="ghost"
                  title="เลิกจ้างคนล่าสุดของแผนกนี้"
                >
                  −
                </button>
              </div>
              {team.length === 1 && (
                <div className="warn">มีคนเดียว — ยังไม่มีใครค้าน จ้างเพิ่มอีก 2 คนถึงจะถกกันได้</div>
              )}
              {team.length > 0 && (
                <ul className="team">
                  {team.map((m) => (
                    <li key={m.id}>
                      <button className="member" onClick={() => onFocus(m.id)}>
                        <i className="sw" style={{ background: m.color }} />
                        <b>{m.name}</b>
                        <em>{m.title}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
