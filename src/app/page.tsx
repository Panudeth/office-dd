'use client';

import {
  BookOpen, Building2, KeyRound, LogIn, Maximize2, PanelRightClose, PanelRightOpen, Pause, Play,
  UserRound, Video, ZoomIn, ZoomOut,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import AgendaPanel, { type AgendaPick } from '@/components/AgendaPanel';
import Portrait from '@/components/Portrait';
import SecretaryTab from '@/components/SecretaryTab';
import CompanyPanel from '@/components/CompanyPanel';
import ChatPanel from '@/components/ChatPanel';
import HirePanel from '@/components/HirePanel';
import KeyPanel, {
  activeOf, authHeaders, loadStore, saveStore, type LlmStore,
} from '@/components/KeyPanel';
import OfficePanel from '@/components/OfficePanel';
import {
  accountAvatar, accountName, deleteEmployee, deleteMeeting, listMeetings, listOffices,
  loadDeptNotes, loadEmployees, loadProfile, matchChunks, readOAuthReturn, rememberOffice,
  rememberedOfficeId, sb, saveEmployee, saveMeeting, sbError, supabaseConfigured,
  type MeetingRow, type OAuthReturn, type Office, type User,
} from '@/lib/supabase';
import { profileIsEmpty, type CompanyContext } from '@/lib/company';
import type { EmployeeSnapshot } from '@/game/types';
import type { World } from '@/game/world';
import { BOSS_RECT, MAX_STAFF, MEETING_RECT, SECRETARY_NAME, SECRETARY_PAL } from '@/game/map';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';
import type { Agenda, AskEvent, ChatMessage, Consult, Opinion } from '@/lib/protocol';

const GameCanvas = dynamic(() => import('@/components/GameCanvas'), { ssr: false });

/* ---- ความกว้างแผงขวา ---- */
const SIDE_KEY = 'visual-company.side';
const SIDE_MIN = 300;
const SIDE_MAX = 760;
const SIDE_DEFAULT = 400;
const clampSide = (n: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(n)));

/** ความสูงแผงจ้างพนักงาน - ที่เหลือในคอลัมน์เป็นของแผงแชททั้งหมด */
const HIRE_MIN = 92;
const HIRE_DEFAULT = 320;

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
  return s.length > 320 ? `${s.slice(0, 320)}...` : s;
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
  return s.length > 320 ? `${s.slice(0, 320)}...` : s;
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
  const [seatsLeft, setSeatsLeft] = useState(MAX_STAFF);
  /** ที่ว่างในห้องของแต่ละแผนก - แต่ละแผนกมีห้องตัวเอง จ้างเกินห้องไม่ได้ */
  const [roomLeft, setRoomLeft] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // คำถามที่ถามมาแล้วแต่ยังไม่เริ่มประชุม - ค้างอยู่ระหว่างที่ผู้ใช้ตรวจระเบียบวาระ
  const [pendingQ, setPendingQ] = useState('');
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaErr, setAgendaErr] = useState<string | null>(null);
  const [autoCam, setAutoCam] = useState(true);
  const [llmStore, setLlmStore] = useState<LlmStore>({ active: null, items: [] });
  const [keyOpen, setKeyOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  // โหมดในเครื่องไม่มี session ให้รอ ถือว่ารู้คำตอบตั้งแต่แรก
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [office, setOffice] = useState<Office | null>(null);
  const [officeOpen, setOfficeOpen] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [oauth, setOauth] = useState<OAuthReturn>({ returning: false, error: null, origin: '' });
  const [sideW, setSideW] = useState(SIDE_DEFAULT);
  const [sideOpen, setSideOpen] = useState(true);
  const [hireH, setHireH] = useState(HIRE_DEFAULT);
  /** แท็บของแผงขวาบน - ปุ่มเลขาฯ บนแถบบนสั่งเปิดแท็บสมุดได้ */
  const [sideTab, setSideTab] = useState('staff');
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  /** ข้อมูลบริษัท - โหลดจาก Supabase ตอนเลือกออฟฟิศ ส่งไปกับทุกคำถาม */
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [deptNotes, setDeptNotes] = useState<Record<string, string>>({});
  const [companyOpen, setCompanyOpen] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsErr, setMeetingsErr] = useState<string | null>(null);
  const dragging = useRef(false);
  const vDragging = useRef(false);
  const asideRef = useRef<HTMLElement>(null);

  // localStorage อ่านได้เฉพาะฝั่ง client - โหลดหลัง mount ไม่งั้น SSR กับ client ไม่ตรงกัน
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { w?: number; open?: boolean; h?: number };
      if (typeof p.w === 'number') setSideW(clampSide(p.w));
      if (typeof p.open === 'boolean') setSideOpen(p.open);
      if (typeof p.h === 'number') setHireH(Math.max(HIRE_MIN, Math.round(p.h)));
    } catch {
      /* พังก็ใช้ค่าเริ่มต้น */
    }
  }, []);

  const saveSide = useCallback((w: number, open: boolean, h: number) => {
    try {
      localStorage.setItem(SIDE_KEY, JSON.stringify({ w, open, h }));
    } catch {
      /* โหมดส่วนตัวเขียนไม่ได้ */
    }
  }, []);

  // localStorage อ่านได้เฉพาะฝั่ง client - โหลดหลัง mount
  useEffect(() => { setLlmStore(loadStore()); }, []);

  /** ชุดที่กำลังใช้ - null คือยังไม่ได้เลือก แปลว่าใช้คีย์ของเซิร์ฟเวอร์ */
  const llm = activeOf(llmStore);
  const setLlmStoreSaved = useCallback((s: LlmStore) => { setLlmStore(s); saveStore(s); }, []);

  /**
   * ต้องอยู่เหนือ effect ที่เรียก sb() เพราะ effect รันตามลำดับที่ประกาศ
   * และ sb() จะลบ code ทิ้งจาก URL ทันทีที่แลก session สำเร็จ
   */
  useEffect(() => { setOauth(readOAuthReturn()); }, []);
  useEffect(() => {
    // ได้ session แล้วก็ไม่ต้องเตือนอะไรอีก และกันไม่ให้ข้อความค้างหลังกดออกจากระบบ
    if (user) setOauth({ returning: false, error: null, origin: '' });
  }, [user]);

  /**
   * แหล่งความจริงเดียวของสถานะล็อกอินทั้งแอป - ห้ามมีใครไป setUser เองที่อื่น
   * supabase-js v2 ยิง INITIAL_SESSION ให้ทันทีที่ subscribe ทั้งกรณีมี session และไม่มี
   * จึงไม่ต้องเรียก getUser() ซ้อนอีกรอบ (ซึ่งเป็น network call และทำให้ UI แว้บเป็น
   * "ยังไม่ล็อกอิน" ระหว่างรอ จนกดปุ่มเข้าสู่ระบบซ้ำได้ทั้งที่เข้าอยู่แล้ว)
   */
  useEffect(() => {
    const c = sb();
    if (!c) return;
    const { data: sub } = c.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const chooseOffice = useCallback((o: Office | null) => {
    setOffice(o);
    rememberOffice(o?.id ?? null);
  }, []);

  /**
   * ผูกออฟฟิศไว้กับบัญชี: ออกจากระบบหรือสลับบัญชี = ล้างทิ้งเสมอ
   * เข้าระบบ = กู้ออฟฟิศล่าสุดกลับมา เพราะขากลับจาก Google หน้าถูกโหลดใหม่ทั้งหน้า
   * ถ้าไม่มีให้กู้ ก็เปิดแผงให้เลือกเลย จะได้ไม่จ้างพนักงานทิ้งไปโดยไม่ถูกบันทึก
   */
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!supabaseConfigured || !authReady) return;
    if (!userId) { setOffice(null); return; }

    const want = rememberedOfficeId();
    if (!want) { setOffice(null); setOfficeOpen(true); return; }

    let alive = true;
    listOffices()
      .then((rows) => {
        if (!alive) return;
        // ออฟฟิศอาจถูกลบไปแล้ว หรือเป็นของบัญชีอื่นซึ่ง RLS ไม่คืนมาให้
        const found = rows.find((o) => o.id === want) ?? null;
        setOffice(found);
        if (!found) { rememberOffice(null); setOfficeOpen(true); }
      })
      .catch((e) => {
        if (alive) setSaveErr(sbError(e));
      });
    return () => { alive = false; };
  }, [userId, authReady]);

  /**
   * สมุดบันทึกของเลขาฯ - ผูกกับออฟฟิศ ไม่ใช่กับเครื่อง
   * สลับออฟฟิศแล้วต้องเห็นบันทึกของออฟฟิศนั้น ไม่ใช่ของเดิมค้างอยู่
   */
  const officeId = office?.id ?? null;
  const refreshMeetings = useCallback(() => {
    if (!officeId) { setMeetings([]); return; }
    setMeetingsLoading(true);
    setMeetingsErr(null);
    listMeetings(officeId)
      .then(setMeetings)
      .catch((e) => setMeetingsErr(sbError(e)))
      .finally(() => setMeetingsLoading(false));
  }, [officeId]);

  useEffect(() => { refreshMeetings(); }, [refreshMeetings]);

  // ข้อมูลบริษัทผูกกับออฟฟิศ - สลับออฟฟิศต้องโหลดใหม่ ไม่งั้นเอาโปรไฟล์บริษัท A ไปตอบเรื่องบริษัท B
  const refreshCompany = useCallback(() => {
    if (!officeId) { setProfile({}); setDeptNotes({}); return; }
    Promise.all([loadProfile(officeId), loadDeptNotes(officeId)])
      .then(([p, n]) => { setProfile(p); setDeptNotes(n); })
      .catch((e) => setSaveErr(sbError(e)));
  }, [officeId]);
  useEffect(() => { refreshCompany(); }, [refreshCompany]);

  /**
   * ประกอบข้อมูลบริษัทสำหรับคำถามนี้ - โปรไฟล์ + โน้ตแผนกที่เข้าประชุม + ชิ้นเอกสารที่ค้นเจอ
   * ค้นเอกสารต้อง embed คำถามก่อน (ต้องใช้คีย์ LLM) แล้วยิง RPC ผ่าน RLS
   * ค้นไม่ได้ (ไม่มีเอกสาร / provider ทำ embedding ไม่ได้) = ข้ามเงียบ ๆ ประชุมยังเดินต่อ
   */
  const buildCompanyContext = useCallback(async (question: string, deptIds: string[]): Promise<CompanyContext | undefined> => {
    if (!officeId) return undefined;
    const notes: Record<string, string> = {};
    for (const id of deptIds) if (deptNotes[id]) notes[id] = deptNotes[id];
    let chunks: CompanyContext['chunks'];
    try {
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(llm) },
        body: JSON.stringify({ texts: [question] }),
      });
      if (res.ok) {
        const data = (await res.json()) as { vectors: number[][]; model: string };
        const hits = await matchChunks(officeId, data.vectors[0], data.model, deptIds, 8);
        // ตัดที่คล้ายน้อยทิ้ง - ชิ้นที่ similarity ต่ำมีแต่จะพา agent ออกนอกเรื่อง
        chunks = hits.filter((h) => h.similarity > 0.45).map((h) => ({ docName: h.doc_name, seq: h.seq, content: h.content }));
      }
    } catch {
      chunks = undefined;
    }
    return { profile, notes, chunks };
  }, [officeId, profile, deptNotes, llm]);

  const secBlocked = !supabaseConfigured
    ? 'โหมดในเครื่องยังไม่มีที่เก็บบันทึก - ตั้งค่า Supabase ก่อนถึงจะจดประวัติได้'
    : !user
      ? 'เข้าสู่ระบบก่อน แล้วเลขาฯ จะเปิดสมุดบันทึกของออฟฟิศให้'
      : !office
        ? 'เลือกออฟฟิศก่อน บันทึกการประชุมผูกอยู่กับออฟฟิศ'
        : null;

  const syncRoster = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    setRoster(w.roster());
    setSeatsLeft(w.seatsLeft());
    setRoomLeft(Object.fromEntries(DEPARTMENTS.map((d) => [d.id, w.seatsLeftFor(d.id)])));
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
      .catch((e) => setSaveErr(sbError(e)));
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

  /**
   * ล็อกอินล้มเหลวต้องไม่เงียบ - ถ้ากลับมาจาก Google แล้วยังไม่มี session
   * แปลว่าการแลก code พัง ซึ่งเกือบทุกครั้งคือ origin นี้ไม่อยู่ใน Redirect URLs
   * ของ Supabase เลยถูกเด้งไปที่ Site URL แทน คนละ origin กับตอนกดเข้าสู่ระบบ
   * ตัวยืนยัน PKCE ถูกเก็บแยกตาม origin จึงหาไม่เจอ
   */
  const authNote =
    !supabaseConfigured || !authReady || user || !oauth.returning
      ? null
      : oauth.error
        ? `Google หรือ Supabase ปฏิเสธคำขอ: ${oauth.error}`
        : `กลับมาจาก Google แล้วแต่ไม่ได้ session - เอา ${oauth.origin} ไปใส่ใน Supabase ` +
          'ที่ Authentication แล้วดู URL Configuration ช่อง Redirect URLs ' +
          '(ใส่เป็น http://localhost:*/** ครอบทุกพอร์ตได้เลย) แล้วลองใหม่';

  /**
   * เงื่อนไขที่ต้องครบก่อนถึงจะแตะทะเบียนพนักงานได้
   * โหมดในเครื่อง (ไม่ได้ตั้งค่า Supabase) ปล่อยผ่าน - บอกไว้แล้วว่ารีเฟรชแล้วหาย
   * แต่ถ้าต่อ Supabase อยู่ ต้องมีทั้งบัญชีและออฟฟิศ ไม่งั้นจ้างไปก็ตกน้ำเงียบ ๆ
   * นี่เป็นแค่เรื่อง UX ของจริงคือ RLS ใน schema.sql ที่ปฏิเสธคำสั่งให้เองอยู่แล้ว
   */
  const lock = !supabaseConfigured
    ? null
    : !authReady
      ? { text: 'กำลังตรวจสอบสถานะการเข้าสู่ระบบ', action: null }
      : !user
        ? { text: 'เข้าสู่ระบบก่อน พนักงานที่จ้างถึงจะถูกบันทึกไว้', action: 'เข้าสู่ระบบ' }
        : !office
          ? { text: 'เลือกออฟฟิศก่อน พนักงานจะได้ถูกบันทึกลงออฟฟิศนั้น', action: 'เลือกออฟฟิศ' }
          : null;

  const hire = (deptId: string, count: number) => {
    const w = worldRef.current;
    const dept = DEPT_BY_ID.get(deptId);
    if (!w || !dept || lock) return;
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
        }).catch((err) => setSaveErr(sbError(err)));
      }
    }
    syncRoster();
  };

  const fire = (deptId: string) => {
    const w = worldRef.current;
    if (!w || lock) return;
    const victim = [...w.roster()].reverse().find((r) => r.deptId === deptId);
    if (!w.fire(deptId)) return;
    if (office && victim) {
      deleteEmployee(victim.id).catch((err) =>
        setSaveErr(sbError(err)));
    }
    syncRoster();
  };

  const patch = (id: string, next: Partial<ChatMessage>) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...next } : m)));

  /**
   * ขั้นที่ 1 - เลขาฯ อ่านคำถามแล้วเสนอว่าควรเรียกแผนกไหนเข้าประชุม
   * ยังไม่ยิงประชุมจริง เพราะผู้ใช้ต้องได้ตรวจและแก้รายชื่อก่อน
   */
  async function proposeAgenda(question: string) {
    const w = worldRef.current;
    if (!w || busy) return;

    const hiredDeptIds = [...new Set(w.roster().map((r) => r.deptId))];
    setMessages((ms) => [...ms, { id: newId(), role: 'user', text: question }]);

    if (!hiredDeptIds.length) {
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'system', text: 'ยังไม่มีพนักงานในบริษัท - จ้างอย่างน้อย 1 แผนกก่อนถามครับ' },
      ]);
      return;
    }

    setPendingQ(question);
    setAgenda(null);
    setAgendaErr(null);
    setAgendaOpen(true);
    setAgendaLoading(true);
    try {
      const res = await fetch('/api/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(llm) },
        body: JSON.stringify({ question, hiredDeptIds, profile }),
      });
      const data = (await res.json()) as Agenda & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setAgenda(data);
    } catch (err) {
      setAgendaErr(err instanceof Error ? err.message : String(err));
      // เลขาฯ ล้มต้องไม่ทำให้ถามไม่ได้ - ให้วาระเปล่าไปแทน ผู้ใช้เลือกเองได้
      setAgenda({
        mode: 'roundtable', ownerDeptId: hiredDeptIds[0], items: [], note: '', fallback: true,
      });
    } finally {
      setAgendaLoading(false);
    }
  }

  /** ขั้นที่ 2 - ประชุมจริงตามรายชื่อที่ผู้ใช้ยืนยันแล้ว */
  async function runMeeting(question: string, pick: AgendaPick) {
    const w = worldRef.current;
    if (!w || busy) return;

    const snap = w.roster();
    const team = pick.agentIds
      .map((id) => snap.find((r) => r.id === id))
      .filter((r): r is EmployeeSnapshot => !!r)
      .map((r) => {
        const d = DEPT_BY_ID.get(r.deptId);
        return {
          id: r.id, name: r.name, role: r.role, deptId: r.deptId,
          deptName: d?.nameTh ?? r.deptId, lens: d?.lenses[r.role] ?? '',
        };
      });
    if (!team.length) return;

    // สำเนาผู้เข้าประชุม เก็บลงบันทึกด้วย เพราะคนอาจถูกเลิกจ้างไปแล้ว
    // แต่บันทึกการประชุมต้องยังบอกได้ว่าตอนนั้นใครนั่งอยู่ในห้อง
    const attendees = pick.agentIds
      .map((id) => snap.find((r) => r.id === id))
      .filter((r): r is EmployeeSnapshot => !!r)
      .map((r) => ({
        id: r.id, name: r.name, title: r.title, deptId: r.deptId, palette: r.palette,
      }));

    const deptIds = [...new Set(team.map((t) => t.deptId))];
    const ids = team.map((t) => t.id);
    const relay = pick.mode === 'relay';
    const direct = pick.mode === 'direct';
    const owner = team.find((t) => t.deptId === pick.ownerDeptId) ?? team[0];

    const pendingId = newId();
    setMessages((ms) => [
      ...ms,
      {
        id: pendingId, role: 'agent', text: '', pending: true,
        departmentId: owner.deptId, authorName: owner.name,
        mode: pick.mode, deptIds, transcript: [], consults: [],
      },
    ]);

    setBusy(true);
    setPhase('เรียกทีมเข้าห้องประชุม...');
    const transcript: Opinion[] = [];
    const consults: Consult[] = [];
    const names = team.map((t) => t.name);
    let finalText = '';
    let errorText = '';
    let leadId = owner.id;
    let leadName = owner.name;

    try {
      // ประกอบข้อมูลบริษัทระหว่างที่คนกำลังเดิน - ไม่ให้ผู้ใช้รอสองต่อ
      const companyPromise = buildCompanyContext(question, deptIds);

      w.saveView();
      if (direct) {
        // ตอบตรง: คนเดียวเดินไปหาบอสที่ห้อง ไม่เข้าห้องประชุม
        setPhase(`${owner.name} กำลังเดินไปหาคุณ...`);
        w.focusRect(BOSS_RECT);
        await w.report(owner.id);
        w.say(w.bossId, question, 3);
      } else {
        w.focusRect(MEETING_RECT);
        await w.gather(ids);
        w.setDeliberating(ids);
        // ผู้บริหาร (ตัวผู้ใช้) เปิดประชุมด้วยคำถามของตัวเอง
        // ผูก animation เข้ากับคำถามจริง และไม่ให้จอว่างระหว่างรอ LLM รอบแรก
        w.say(w.bossId, `วาระวันนี้: ${question}`, 3);
      }
      setPhase(direct ? `${owner.name} กำลังตอบ...` : relay ? `${owner.name} รับเรื่องไปเดินสาย...` : 'ทีมกำลังถกกัน...');

      const company = await companyPromise;
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(llm) },
        body: JSON.stringify({
          question,
          mode: pick.mode,
          ownerDeptId: owner.deptId,
          agents: team,
          company,
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
          } else if (ev.type === 'consult') {
            // สายพาน: เจ้าของเรื่องหันไปถามอีกแผนกต่อหน้าทุกคน
            const c: Consult = {
              step: ev.step, fromName: ev.fromName, toName: ev.toName,
              toDeptId: ev.toDeptId, text: ev.text,
            };
            consults.push(c);
            patch(pendingId, { consults: [...consults] });
            w.say(ev.fromAgentId, `ถาม${ev.toName}: ${excerpt(ev.text, 1)}`, undefined, () => {
              w.faceToward(ev.fromAgentId, ev.toAgentId);
              w.react(ev.toAgentId, 'question', 2.6);
            });
          } else if (ev.type === 'opinion') {
            const op: Opinion = {
              agentId: ev.agentId, agentName: ev.agentName, agentRole: ev.agentRole,
              deptId: ev.deptId, round: ev.round, step: ev.step, askedBy: ev.askedBy,
              text: ev.text,
            };
            transcript.push(op);
            patch(pendingId, { transcript: [...transcript] });

            if (relay) {
              // สายพานมาทีละคนตามลำดับอยู่แล้ว ต่อคิวพูดได้เลย ไม่ต้องพักรอ
              w.say(ev.agentId, excerpt(ev.text, 1), undefined, () => {
                w.faceToward(ev.agentId, owner.id);
                w.react(owner.id, 'idea', 2.4);
              });
            } else {
              // พูดทันทีที่ความเห็นมาถึง - คิวคำพูดใน world เรียงให้ทีละคนอยู่แล้ว
              // เดิมพักไว้จนครบทั้งรอบเพื่อเรียงตามบทบาท แต่ประชุม 12 คนแปลว่าเงียบเป็นนาที
              // ก่อนใครจะพูด - ดูเหมือนค้าง แลกลำดับบทบาทกับความสดแล้วสดชนะ
              const targetName = op.round === 2 ? objectionTarget(op.text, names) : null;
              const target = team.find((t) => t.name === targetName && t.id !== op.agentId);
              w.say(op.agentId, excerpt(op.text, op.round), undefined, () => {
                if (!target) return;
                w.faceToward(op.agentId, target.id);
                w.react(target.id, 'question', 2.6);
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
      if (finalText) w.sayNow(leadId, summaryLine(finalText), 5);
      await new Promise((r) => setTimeout(r, 1800));
      w.react(w.bossId, 'idea', 3);
      await new Promise((r) => setTimeout(r, 900));

      patch(pendingId, {
        pending: false,
        text: finalText || '(ไม่ได้รับคำตอบ)',
        authorName: leadName,
        transcript: [...transcript],
        consults: [...consults],
      });

      // เลขาฯ จดบันทึกให้เอง - เก็บที่ Supabase ผูกกับออฟฟิศ ไม่ใช่กับเครื่อง
      // ยิงแบบไม่รอ ผู้ใช้ได้อ่านคำตอบไปก่อนแล้ว บันทึกพลาดก็แค่แจ้งในแถบสถานะ
      if (office) {
        saveMeeting({
          office_id: office.id,
          asked_by: user?.id ?? null,
          question,
          mode: pick.mode,
          owner_dept: owner.deptId,
          dept_ids: deptIds,
          attendees,
          summary: finalText,
          transcript,
          consults,
        })
          .then((row) => { if (row) setMeetings((ms) => [row, ...ms]); })
          .catch((e) => setSaveErr(sbError(e)));
      }
    } catch (err) {
      patch(pendingId, {
        pending: false,
        text: `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`,
        transcript: [...transcript],
        consults: [...consults],
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
          {/* ยังไม่ล็อกอิน = มีปุ่มเดียวให้กด ไม่ต้องเดาว่าออฟฟิศอยู่ตรงไหน
              ล็อกอินแล้ว = ปุ่มบัญชีบอกว่าเป็นใคร คู่กับปุ่มออฟฟิศที่กำลังใช้ */}
          {!supabaseConfigured ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOfficeOpen(true)}
              title="ยังไม่ได้ตั้งค่า Supabase - จ้างพนักงานแล้วรีเฟรชจะหาย"
              className="border-wood-deep text-parchment-2 hover:bg-wood-dark"
            >
              <Building2 /> ในเครื่อง
            </Button>
          ) : !user ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!authReady}
              onClick={() => setOfficeOpen(true)}
              title="เข้าสู่ระบบเพื่อเก็บพนักงานไว้ในออฟฟิศของคุณ"
            >
              <LogIn /> {authReady ? 'เข้าสู่ระบบ' : 'กำลังตรวจสอบ'}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOfficeOpen(true)}
                title={`${accountName(user)}${user.email ? ` (${user.email})` : ''} - กดเพื่อจัดการบัญชี`}
                className="max-w-44 border-wood-deep text-parchment-2 hover:bg-wood-dark"
              >
                {accountAvatar(user) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={accountAvatar(user)!}
                    alt=""
                    className="size-4 shrink-0 rounded-box border border-ink-500"
                  />
                ) : (
                  <UserRound />
                )}
                <span className="truncate">{accountName(user)}</span>
              </Button>

              <Button
                variant={office ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setOfficeOpen(true)}
                title={office ? `กำลังใช้ออฟฟิศ ${office.name}` : 'ยังไม่ได้เลือกออฟฟิศ'}
                className={
                  office ? 'max-w-44' : 'max-w-44 border-brass text-brass hover:bg-wood-dark'
                }
              >
                <Building2 />
                <span className="truncate">{office ? office.name : 'เลือกออฟฟิศ'}</span>
              </Button>
            </>
          )}

          <Button
            variant={llm ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setKeyOpen(true)}
            title="ใส่ API key ของคุณเอง"
            className={llm ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
          >
            <KeyRound />
            {llm ? llm.label : 'คีย์ของฉัน'}
          </Button>

          {/* เลขาฯ - รูปเดียวกับตัวที่ยืนหน้าห้องประชุม กดแล้วเปิดสมุดบันทึกการประชุม */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSideOpen(true); saveSide(sideW, true, hireH); setSideTab('notes'); }}
            title={`${SECRETARY_NAME} - ประวัติการประชุมทั้งหมด`}
            className="gap-1 border-wood-deep pl-1 text-parchment-2 hover:bg-wood-dark"
          >
            <Portrait palette={SECRETARY_PAL} size={1} className="block shrink-0" />
            เลขาฯ
            {meetings.length > 0 && (
              <span className="rounded-box bg-brass px-1 text-[10px] font-bold text-ink-900">
                {meetings.length}
              </span>
            )}
          </Button>

          {/* ข้อมูลบริษัท - ยังไม่ได้กรอกจะขึ้นเตือน เพราะไม่กรอก agent จะตอบแบบไม่รู้ว่าเราเป็นใคร */}
          <Button
            variant={profileIsEmpty(profile) && office ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setCompanyOpen(true)}
            title="ข้อมูลบริษัท - โปรไฟล์ โน้ตแผนก เอกสาร ที่ agent ทุกตัวจะอ่านก่อนตอบ"
            className={profileIsEmpty(profile) && office ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
          >
            <BookOpen /> ข้อมูลบริษัท
            {profileIsEmpty(profile) && office && (
              <span className="rounded-box bg-brass px-1 text-[10px] font-bold text-ink-900">ยังไม่กรอก</span>
            )}
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

          <Button
            variant="outline"
            size="icon"
            title={sideOpen ? 'ย่อแผงขวา ให้แผนที่เต็มจอ' : 'กางแผงขวากลับมา'}
            className="size-7 border-wood-deep text-parchment-2 hover:bg-wood-dark"
            onClick={() => {
              const next = !sideOpen;
              setSideOpen(next);
              saveSide(sideW, next, hireH);
            }}
          >
            {sideOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </header>

      {/* ความกว้างมาทาง CSS variable ไม่ใช่ inline grid-template
          เพราะ inline style จะชนะ media query แล้วจอแคบจะไม่ยอมตกลงมาเป็นคอลัมน์เดียว */}
      <div
        className="grid min-h-0 flex-1 gap-2.5 [grid-template-columns:var(--cols)] max-[1080px]:grid-cols-1"
        style={
          {
            '--cols': sideOpen ? `minmax(0,1fr) 6px ${sideW}px` : 'minmax(0,1fr)',
          } as CSSProperties
        }
      >
        {/* เดิมเป็น self-start กล่องจึงสูงเท่าเนื้อหา พอจอกว้างเลยเหลือแถบว่างข้างล่าง
            ตอนนี้ยืดเต็มแถว แล้วให้ canvas กินพื้นที่ที่เหลือทั้งหมด */}
        <div className="flex min-h-0 min-w-0 flex-col rounded-box border-2 border-ink-500 bg-[#0d1119] p-1.5 max-[1080px]:h-[70vh]">
          <div className="min-h-0 min-w-0 flex-1">
            <GameCanvas onReady={onReady} />
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-0.5 pt-2 text-[11px] text-dim">
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

        {/* ที่จับสำหรับลากย่อขยาย - ซ่อนบนจอแคบเพราะตรงนั้นเป็นคอลัมน์เดียวอยู่แล้ว */}
        {sideOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="ลากเพื่อปรับความกว้างแผงขวา"
            title="ลากเพื่อปรับความกว้าง / ดับเบิลคลิกเพื่อคืนค่าเริ่มต้น"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              // วัดจากขอบขวาของหน้าต่าง: padding ของ main 10px + ครึ่งหนึ่งของที่จับ
              setSideW(clampSide(window.innerWidth - e.clientX - 13));
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              dragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
              saveSide(sideW, sideOpen, hireH);
            }}
            onDoubleClick={() => {
              setSideW(SIDE_DEFAULT);
              saveSide(SIDE_DEFAULT, sideOpen, hireH);
            }}
            className="group relative cursor-col-resize touch-none max-[1080px]:hidden"
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-ink-500 group-hover:bg-brass" />
          </div>
        )}

        {sideOpen && (
        <aside ref={asideRef} className="flex min-h-0 flex-col">
          {/* ความสูงมาจากผู้ใช้ลากเอง - [&>section] คือตัว Panel ข้างใน ต้องยืดเต็มกรอบ
              ไม่งั้นมันจะสูงตามเนื้อหาแล้วการลากไม่มีผลอะไรเลย */}
          <div
            className="flex min-h-0 shrink-0 flex-col [&>section]:min-h-0 [&>section]:flex-1"
            style={{ height: hireH }}
          >
            <HirePanel
              roster={roster}
              seatsLeft={seatsLeft}
              roomLeft={roomLeft}
              onHire={hire}
              onFire={fire}
              onFocus={(id) => worldRef.current?.focus(id)}
              disabled={busy}
              lock={lock}
              onUnlock={() => setOfficeOpen(true)}
              tab={sideTab}
              onTab={setSideTab}
              meetingCount={meetings.length}
              secretary={
                <SecretaryTab
                  meetings={meetings}
                  loading={meetingsLoading}
                  error={meetingsErr}
                  blocked={secBlocked}
                  onRefresh={refreshMeetings}
                  onDelete={(id) => {
                    // ลบออกจากจอก่อน แล้วค่อยยิง ถ้าพังค่อยโหลดกลับมาทั้งชุด
                    setMeetings((ms) => ms.filter((m) => m.id !== id));
                    deleteMeeting(id).catch((e) => {
                      setMeetingsErr(sbError(e));
                      refreshMeetings();
                    });
                  }}
                />
              }
            />
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="ลากเพื่อแบ่งพื้นที่ระหว่างแผงจ้างพนักงานกับแผงแชท"
            title="ลากเพื่อแบ่งพื้นที่ / ดับเบิลคลิกเพื่อคืนค่าเริ่มต้น"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              vDragging.current = true;
            }}
            onPointerMove={(e) => {
              if (!vDragging.current) return;
              const box = asideRef.current?.getBoundingClientRect();
              if (!box) return;
              // เหลือที่ให้แผงแชทอย่างน้อย 160px เสมอ ไม่งั้นลากจนช่องพิมพ์หายไปเลย
              const max = Math.max(HIRE_MIN, box.height - 160);
              setHireH(Math.min(max, Math.max(HIRE_MIN, Math.round(e.clientY - box.top))));
            }}
            onPointerUp={(e) => {
              if (!vDragging.current) return;
              vDragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
              saveSide(sideW, sideOpen, hireH);
            }}
            onDoubleClick={() => {
              setHireH(HIRE_DEFAULT);
              saveSide(sideW, sideOpen, HIRE_DEFAULT);
            }}
            className="group flex h-2.5 shrink-0 cursor-row-resize touch-none items-center justify-center"
          >
            <span className="h-0.5 w-10 rounded-full bg-ink-500 group-hover:bg-brass" />
          </div>

          <ChatPanel
            messages={messages}
            busy={busy || agendaOpen}
            phase={phase}
            onSend={proposeAgenda}
          />
        </aside>
        )}
      </div>

      <AgendaPanel
        open={agendaOpen}
        question={pendingQ}
        agenda={agenda}
        loading={agendaLoading}
        error={agendaErr}
        roster={roster}
        onCancel={() => {
          setAgendaOpen(false);
          setMessages((ms) => [
            ...ms,
            { id: newId(), role: 'system', text: 'ยกเลิกการประชุมแล้ว - ถามใหม่ได้เลย' },
          ]);
        }}
        onStart={(pick) => {
          setAgendaOpen(false);
          void runMeeting(pendingQ, pick);
        }}
      />

      <CompanyPanel
        open={companyOpen}
        onClose={() => setCompanyOpen(false)}
        officeId={officeId}
        userId={user?.id ?? null}
        profile={profile}
        deptNotes={deptNotes}
        onChanged={refreshCompany}
        llmHeaders={authHeaders(llm)}
        llmLabel={llm?.label ?? 'คีย์ของเซิร์ฟเวอร์'}
        blocked={secBlocked}
      />

      <KeyPanel
        open={keyOpen}
        store={llmStore}
        onClose={() => setKeyOpen(false)}
        onChange={setLlmStoreSaved}
      />
      <OfficePanel
        open={officeOpen || !!authNote}
        onClose={() => { setOfficeOpen(false); setOauth({ returning: false, error: null, origin: '' }); }}
        user={user}
        authReady={authReady}
        office={office}
        notice={authNote}
        onOffice={chooseOffice}
      />
    </main>
  );
}
