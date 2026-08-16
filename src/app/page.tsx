'use client';

import {
  Building2, KeyRound, Maximize2, Pause, Play, Video, ZoomIn, ZoomOut,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ChatPanel from '@/components/ChatPanel';
import HirePanel from '@/components/HirePanel';
import KeyPanel, { authHeaders, loadSettings, type LlmSettings } from '@/components/KeyPanel';
import OfficePanel from '@/components/OfficePanel';
import {
  deleteEmployee, loadEmployees, sb, saveEmployee, supabaseConfigured,
  type Office, type User,
} from '@/lib/supabase';
import type { EmployeeSnapshot } from '@/game/types';
import type { World } from '@/game/world';
import { MEETING_RECT } from '@/game/map';
import { DEPT_BY_ID, ROLE_ORDER, routeDepartment } from '@/lib/departments';
import type { AskEvent, ChatMessage, Opinion } from '@/lib/protocol';

const GameCanvas = dynamic(() => import('@/components/GameCanvas'), { ssr: false });

let msgSeq = 0;
const newId = () => `m${++msgSeq}`;

/**
 * ตัดข้อความยาว ๆ ให้เหลือประโยคเดียวสำหรับฟองคำพูดบนหัว
 * รอบ 2 หยิบบรรทัด "ค้าน:" มาโชว์ เพราะนั่นคือส่วนที่น่าดูที่สุดของการถก
 */
function excerpt(text: string, round: 1 | 2): string {
  let s = text.trim().replace(/\*\*/g, '');
  if (round === 2) {
    const m = /(?:^|\n)\s*ค้าน\s*[:：]\s*(.+)/.exec(s);
    s = m ? `ค้าน: ${m[1].trim()}` : (s.split('\n').find((l) => l.trim()) ?? s);
  } else {
    s = s.split('\n').find((l) => l.trim()) ?? s;
  }
  return s.length > 150 ? `${s.slice(0, 150)}...` : s;
}

/** หาว่ารอบแย้งนี้พุ่งไปที่ใคร - เอาไว้ให้คนถูกพาดพิงมีปฏิกิริยา */
function objectionTarget(text: string, names: string[]): string | null {
  const m = /(?:^|\n)\s*ค้าน\s*[:：]\s*(.+)/.exec(text);
  const line = m ? m[1] : text.split('\n')[0] ?? '';
  return names.find((n) => line.includes(n)) ?? null;
}

/** หยิบเนื้อใต้หัวข้อ "สรุป" มาให้หัวหน้าทีมพูดตอนมารายงาน */
function summaryLine(text: string): string {
  const m = /\*\*\s*สรุป\s*\*\*\s*\n?([\s\S]*?)(?=\n\s*\*\*|$)/.exec(text);
  const s = (m ? m[1] : text).trim().replace(/\*\*/g, '').split('\n').filter(Boolean).join(' ');
  return s.length > 160 ? `${s.slice(0, 160)}...` : s;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'system',
  text:
    'ยินดีต้อนรับสู่บริษัทของคุณ\n' +
    'จ้างพนักงานจากแผงด้านบน (แนะนำแผนกละ 3 คน) แล้วพิมพ์คำถามได้เลย\n' +
    'ทีมที่เกี่ยวข้องจะเดินเข้าห้องประชุม ถกกัน 2 รอบ แล้วเดินมารายงานที่โต๊ะคุณ',
};

export default function Page() {
  const worldRef = useRef<World | null>(null);
  const [ready, setReady] = useState(false);
  const [roster, setRoster] = useState<EmployeeSnapshot[]>([]);
  const [seatsLeft, setSeatsLeft] = useState(12);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [deptChoice, setDeptChoice] = useState('auto');
  const [paused, setPaused] = useState(false);
  const [autoCam, setAutoCam] = useState(true);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [office, setOffice] = useState<Office | null>(null);
  const [officeOpen, setOfficeOpen] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // localStorage อ่านได้เฉพาะฝั่ง client - โหลดหลัง mount
  useEffect(() => { setLlm(loadSettings()); }, []);

  // กู้ session เดิม + ตามการเปลี่ยนสถานะล็อกอิน
  useEffect(() => {
    const c = sb();
    if (!c) return;
    c.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = c.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (!session) setOffice(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const syncRoster = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    setRoster(w.roster());
    setSeatsLeft(w.seatsLeft());
  }, []);

  // เปลี่ยนออฟฟิศ = โหลดพนักงานของออฟฟิศนั้นมาแทนที่ทั้งชุด
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !ready) return;
    // โหมดในเครื่องไม่มีออฟฟิศให้โหลด - ห้ามล้าง ไม่งั้นทับพนักงานที่จ้างไว้ตอน mount
    if (!supabaseConfigured) return;
    if (!office) { w.restore([]); syncRoster(); return; }
    loadEmployees(office.id)
      .then((rows) => {
        w.restore(rows.map((r) => ({
          id: r.id, name: r.name, title: r.title, deptId: r.dept_id,
          role: r.role as EmployeeSnapshot['role'], palette: r.palette, seat: r.seat,
        })));
        syncRoster();
      })
      .catch((e) => setSaveErr(e instanceof Error ? e.message : String(e)));
  }, [office, ready, syncRoster]);

  const onReady = useCallback(
    (w: World) => {
      worldRef.current = w;
      setReady(true);
      // โหมดในเครื่อง: จ้างทีมกฎหมายให้ 3 คนเลย จะได้ลองถามได้ทันที
      // ถ้าต่อ Supabase อยู่ ห้ามจ้างเอง เดี๋ยวไปทับกับพนักงานที่โหลดมาจากออฟฟิศ
      if (!supabaseConfigured && w.roster().length === 0) {
        const legal = DEPT_BY_ID.get('legal')!;
        for (let i = 0; i < 3; i++) w.hire(legal);
      }
      syncRoster();
    },
    [syncRoster],
  );

  // สถานะพนักงานเปลี่ยนตลอดเวลาใน game loop - poll เบา ๆ มาแสดงผล
  useEffect(() => {
    const t = window.setInterval(syncRoster, 400);
    return () => window.clearInterval(t);
  }, [syncRoster]);

  const hire = (deptId: string, count: number) => {
    const w = worldRef.current;
    const dept = DEPT_BY_ID.get(deptId);
    if (!w || !dept) return;
    setSaveErr(null);
    for (let i = 0; i < count; i++) {
      const e = w.hire(dept);
      if (!e) break;
      // วาดทันที แล้วค่อยบันทึก - ไม่ให้ผู้ใช้รอ network
      if (office) {
        const p = w.persistable(e);
        saveEmployee({
          id: p.id, office_id: office.id, name: p.name, title: p.title,
          dept_id: p.deptId, role: p.role, palette: p.palette, seat: p.seat,
        }).catch((err) => setSaveErr(err instanceof Error ? err.message : String(err)));
      }
    }
    syncRoster();
  };

  const fire = (deptId: string) => {
    const w = worldRef.current;
    if (!w) return;
    const victim = [...w.roster()].reverse().find((r) => r.deptId === deptId);
    if (!w.fire(deptId)) return;
    if (office && victim) {
      deleteEmployee(victim.id).catch((err) =>
        setSaveErr(err instanceof Error ? err.message : String(err)));
    }
    syncRoster();
  };

  const patch = (id: string, next: Partial<ChatMessage>) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...next } : m)));

  async function ask(question: string) {
    const w = worldRef.current;
    if (!w || busy) return;

    const hiredIds = [...new Set(w.roster().map((r) => r.deptId))];
    const deptId = deptChoice === 'auto' ? routeDepartment(question, hiredIds) : deptChoice;
    const dept = deptId ? DEPT_BY_ID.get(deptId) : undefined;

    setMessages((ms) => [...ms, { id: newId(), role: 'user', text: question }]);

    if (!dept) {
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'system', text: 'ยังไม่มีพนักงานในบริษัท - จ้างอย่างน้อย 1 แผนกก่อนถามครับ' },
      ]);
      return;
    }

    const team = w.byDept(dept.id).slice(0, 3);
    if (!team.length) {
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'system', text: `ยังไม่มีพนักงาน${dept.nameTh} - จ้างก่อนแล้วถามใหม่` },
      ]);
      return;
    }

    const ids = team.map((t) => t.id);
    const pendingId = newId();
    setMessages((ms) => [
      ...ms,
      {
        id: pendingId, role: 'agent', text: '', pending: true,
        departmentId: dept.id, authorName: team[0].name, transcript: [],
      },
    ]);

    setBusy(true);
    setPhase('เรียกทีมเข้าห้องประชุม...');
    const transcript: Opinion[] = [];
    const buffer: Opinion[] = [];
    const names = team.map((t) => t.name);
    const roleRank = (agentId: string) => {
      const r = team.find((t) => t.id === agentId)?.role;
      return r ? ROLE_ORDER.indexOf(r) : 99;
    };
    let finalText = '';
    let errorText = '';
    let leadId = team[0].id;
    let leadName = team[0].name;

    try {
      w.saveView();
      w.focusRect(MEETING_RECT);
      await w.gather(ids);
      w.setDeliberating(ids);
      // ผู้บริหาร (ตัวผู้ใช้) เปิดประชุมด้วยคำถามของตัวเอง
      // ผูก animation เข้ากับคำถามจริง และไม่ให้จอว่างระหว่างรอ LLM รอบแรก
      w.say(w.bossId, `วาระวันนี้: ${question}`, 7);
      setPhase('ทีมกำลังถกกัน...');

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(llm) },
        body: JSON.stringify({
          question,
          departmentId: dept.id,
          agents: team.map((t) => ({ id: t.id, name: t.name, role: t.role, lens: t.lens })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`เรียก API ไม่สำเร็จ (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streaming = true;

      while (streaming) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6)) as AskEvent;

          if (ev.type === 'skill') {
            patch(pendingId, { proof: ev.proof });
          } else if (ev.type === 'phase') {
            setPhase(ev.label);
            ids.forEach((id) => w.bubble(id, ev.phase === 'synthesis' ? 'board' : 'talk', 2));
          } else if (ev.type === 'opinion') {
            const op: Opinion = {
              agentId: ev.agentId, agentName: ev.agentName, agentRole: ev.agentRole,
              round: ev.round, text: ev.text,
            };
            transcript.push(op);
            patch(pendingId, { transcript: [...transcript] });

            // คอล LLM เสร็จไม่เรียงลำดับ - พักไว้จนครบรอบ แล้วค่อยให้พูด
            // ตามลำดับบทบาท (ผู้เสนอ -> ผู้ค้าน -> ผู้ตรวจสอบ) จะได้เป็นบทสนทนา
            buffer.push(op);
            if (buffer.length >= team.length) {
              const ordered = [...buffer].sort(
                (a, b) => roleRank(a.agentId) - roleRank(b.agentId),
              );
              buffer.length = 0;
              ordered.forEach((o) => {
                // ค้านใคร -> พอถึงคิวพูด ให้หันไปหาคนนั้น และคนนั้นมีปฏิกิริยาตอบ
                const targetName = o.round === 2 ? objectionTarget(o.text, names) : null;
                const target = team.find((t) => t.name === targetName && t.id !== o.agentId);
                w.say(o.agentId, excerpt(o.text, o.round), undefined, () => {
                  if (!target) return;
                  w.faceToward(o.agentId, target.id);
                  w.react(target.id, 'question', 2.6);
                });
              });
            }
          } else if (ev.type === 'final') {
            finalText = ev.text;
            leadId = ev.leadAgentId;
            leadName = ev.leadAgentName;
          } else if (ev.type === 'error') {
            // error ไม่ควรกลายเป็นฟองคำพูดของ agent - ส่งเข้าแชทอย่างเดียว
            errorText = ev.message;
            streaming = false;
          } else if (ev.type === 'done') {
            streaming = false;
          }
        }
      }

      // ถ้าพัง ไม่ต้องให้ใครเดินมารายงาน - เลิกประชุมแล้วบอกในแชทตรง ๆ
      if (errorText) {
        w.clearSay(ids);
        patch(pendingId, {
          pending: false,
          role: 'system',
          text: `เกิดข้อผิดพลาด: ${errorText}`,
          transcript: transcript.length ? [...transcript] : undefined,
        });
        return;
      }

      // รอให้ถกกันจบก่อน ไม่งั้นบทสรุปจะทับบทสนทนาที่ยังพูดไม่หมด
      setPhase('รอทีมถกให้จบ...');
      await w.waitForSpeech();

      // สรุปให้ผู้บริหารฟังคาโต๊ะประชุม ไม่ต้องเดินไปไหน
      setPhase('สรุปให้ผู้บริหาร...');
      w.faceToward(leadId, w.bossId);
      if (finalText) w.sayNow(leadId, summaryLine(finalText), 11);
      await new Promise((r) => setTimeout(r, 1800));
      w.react(w.bossId, 'idea', 3);
      await new Promise((r) => setTimeout(r, 900));

      patch(pendingId, {
        pending: false,
        text: finalText || '(ไม่ได้รับคำตอบ)',
        authorName: leadName,
        transcript: [...transcript],
      });
    } catch (err) {
      patch(pendingId, {
        pending: false,
        text: `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`,
        transcript: [...transcript],
      });
    } finally {
      w.disperse(ids);
      w.restoreView(); // คืนมุมกล้องเดิมที่ผู้ใช้ตั้งไว้ก่อนเริ่มประชุม
      setPhase(null);
      setBusy(false);
    }
  }

  const hiredDeptIds = [...new Set(roster.map((r) => r.deptId))];
  const busyAgents = roster.filter((r) => ['meet', 'think', 'report'].includes(r.state)).length;

  return (
    <main className="flex h-screen flex-col gap-2.5 p-2.5 max-[1080px]:h-auto">
      {/* แถบบนเป็นแผ่นไม้ ให้รู้สึกเหมือนป้ายหน้าออฟฟิศ ไม่ใช่ nav ของเว็บแอป */}
      <header className="bevel flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border-2 border-wood-deep bg-wood-mid px-3 py-2">
        <h1 className="text-[15px] text-parchment">
          VISUAL COMPANY
          <span className="ml-2 text-[11px] font-normal tracking-normal text-parchment-2/80">
            บริษัทที่พนักงานเป็น AI agent
          </span>
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant={office ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setOfficeOpen(true)}
            title={supabaseConfigured ? 'เข้าสู่ระบบ และเลือกออฟฟิศ' : 'ยังไม่ได้ตั้งค่า Supabase'}
            className={office ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
          >
            <Building2 />
            {office ? office.name : supabaseConfigured ? 'ออฟฟิศของฉัน' : 'ในเครื่อง'}
          </Button>

          <Button
            variant={llm ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setKeyOpen(true)}
            title="ใส่ API key ของคุณเอง"
            className={llm ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
          >
            <KeyRound />
            {llm ? (llm.provider === 'gemini' ? 'Gemini' : 'Claude') : 'คีย์ของฉัน'}
          </Button>

          <div className="mx-0.5 h-5 w-px bg-wood-deep" />

          <Button
            variant="outline" size="icon" disabled={!ready} title="ซูมออก"
            className="size-7 border-wood-deep text-parchment-2 hover:bg-wood-dark"
            onClick={() => worldRef.current?.zoomCenter(1 / 1.35)}
          >
            <ZoomOut />
          </Button>
          <Button
            variant="outline" size="icon" disabled={!ready} title="ซูมเข้า"
            className="size-7 border-wood-deep text-parchment-2 hover:bg-wood-dark"
            onClick={() => worldRef.current?.zoomCenter(1.35)}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="outline" size="sm" disabled={!ready}
            className="border-wood-deep text-parchment-2 hover:bg-wood-dark"
            onClick={() => worldRef.current?.resetView()}
          >
            <Maximize2 /> พอดีจอ
          </Button>

          <Button
            variant={autoCam ? 'primary' : 'outline'}
            size="sm"
            disabled={!ready}
            title="ซูมตามทีมเข้าห้องประชุมเองตอนถาม"
            className={autoCam ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
            onClick={() => {
              const w = worldRef.current;
              if (!w) return;
              w.setAutoCam(!w.autoCam);
              setAutoCam(w.autoCam);
            }}
          >
            <Video /> กล้องอัตโนมัติ
          </Button>

          <Button
            variant={paused ? 'primary' : 'outline'}
            size="sm"
            disabled={!ready}
            className={paused ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
            onClick={() => {
              const w = worldRef.current;
              if (!w) return;
              w.setPaused(!w.isPaused());
              setPaused(w.isPaused());
            }}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? 'เล่นต่อ' : 'หยุด'}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-2.5 [grid-template-columns:minmax(0,1fr)_400px] max-[1080px]:grid-cols-1">
        <div className="min-w-0 self-start rounded-box border-2 border-ink-500 bg-[#0d1119] p-1.5">
          <GameCanvas onReady={onReady} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-0.5 pt-2 text-[11px] text-dim">
            <span>
              พนักงาน <b className="text-parchment">{roster.length}</b> คน
            </span>
            <span>
              ในห้องประชุม <b className="text-parchment">{busyAgents}</b>
            </span>
            <span className={`ml-auto ${saveErr ? 'text-rug-lite' : 'text-brass'}`}>
              {saveErr ? `บันทึกไม่สำเร็จ: ${saveErr}` : (phase ?? 'พร้อมรับงาน')}
            </span>
            <span>ลากเพื่อเลื่อน / ล้อเลื่อนเพื่อซูม</span>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-2.5">
          <HirePanel
            roster={roster}
            seatsLeft={seatsLeft}
            onHire={hire}
            onFire={fire}
            onFocus={(id) => worldRef.current?.focus(id)}
            disabled={busy}
          />
          <ChatPanel
            messages={messages}
            busy={busy}
            phase={phase}
            deptChoice={deptChoice}
            onDeptChoice={setDeptChoice}
            hiredDeptIds={hiredDeptIds}
            onSend={ask}
          />
        </aside>
      </div>

      <KeyPanel open={keyOpen} settings={llm} onClose={() => setKeyOpen(false)} onSave={setLlm} />
      <OfficePanel
        open={officeOpen}
        onClose={() => setOfficeOpen(false)}
        user={user}
        office={office}
        onUser={setUser}
        onOffice={setOffice}
      />
    </main>
  );
}
