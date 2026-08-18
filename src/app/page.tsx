'use client';

import {
  BookOpen, Building2, KeyRound, LogIn, Maximize2, PanelRightClose, PanelRightOpen, Pause, Play, Wrench,
  BellRing, LoaderCircle, MessagesSquare, Plug, UserRound, Video, ZoomIn, ZoomOut,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import AgendaPanel, { type AgendaPick } from '@/components/AgendaPanel';
import Portrait from '@/components/Portrait';
import SecretaryTab from '@/components/SecretaryTab';
import CompanyPanel from '@/components/CompanyPanel';
import ChatPanel from '@/components/ChatPanel';
import MeetingStatus, { type Activity } from '@/components/MeetingStatus';
import MeetingRoomPanel from '@/components/MeetingRoomPanel';
import IntegrationsPanel from '@/components/IntegrationsPanel';
import OperatorPanel from '@/components/OperatorPanel';
import HirePanel from '@/components/HirePanel';
import KeyPanel, {
  activeOf, authHeaders, connSubtitle, llmAssignment, loadStore, pruneStore, saveStore,
  type LlmRoles, type LlmStore,
} from '@/components/KeyPanel';
import OfficePanel from '@/components/OfficePanel';
import {
  accountAvatar, accountName, deleteEmployee, deleteMeeting, listMeetings, listOffices,
  listProducts, loadDeptNotes, loadEmployees, loadProfile, matchChunks, readOAuthReturn, rememberOffice,
  rememberedOfficeId, sb, saveEmployee, saveMeeting, sbError, supabaseConfigured, updateMeetingMinutes,
  accessToken, loadLayout, saveLayout, updateEmployeeSeat,
  type MeetingRow, type OAuthReturn, type Office, type User,
} from '@/lib/supabase';
import { profileIsEmpty, type CompanyContext, type Product } from '@/lib/company';
import { syncOfficeLlm } from '@/lib/office-llm-client';
import type { EmployeeSnapshot } from '@/game/types';
import type { EditSnapshot, World } from '@/game/world';
import { defaultLayout, parseLayout, type OfficeLayout } from '@/game/furniture';
import LayoutPanel, { type LayoutSaveState } from '@/components/LayoutPanel';
import { MAX_STAFF, SECRETARY_NAME, SECRETARY_PAL } from '@/game/map';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';
import { deptHeadIds } from '@/lib/heads';
import type {
  Agenda, AskAgent, AskEvent, ChatMessage, Consult, MeetingAttendeeLite, MeetingMode, Opinion,
} from '@/lib/protocol';

const GameCanvas = dynamic(() => import('@/components/GameCanvas'), { ssr: false });
/** ผังเฟอร์นิเจอร์ตอนไม่มี Supabase (โหมดในเครื่อง) */
const LAYOUT_KEY = 'visual-company.layout';

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
  /* ---- จัดออฟฟิศ (ผังเฟอร์นิเจอร์) ---- */
  const [editSnap, setEditSnap] = useState<EditSnapshot>({ on: false, selected: null, placing: null, painting: null, tool: 'select', logo: null, logoFit: 'contain', message: null, itemCount: 0 });
  const [layoutSave, setLayoutSave] = useState<LayoutSaveState>('idle');
  const [layoutErr, setLayoutErr] = useState<string | null>(null);
  /** rev ล่าสุดที่เครื่องนี้เป็นคนเขียน - realtime เด้งกลับมาก็ไม่ต้องเอาไปทับ (กันกระตุกระหว่างลาก) */
  const layoutRevRef = useRef<string>('');
  const layoutSaveTimer = useRef<number | null>(null);
  const officeRef = useRef<Office | null>(null);
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
  const [products, setProducts] = useState<Product[]>([]);
  const [deptNotes, setDeptNotes] = useState<Record<string, string>>({});
  const [companyOpen, setCompanyOpen] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  /** สถานะสดของการประชุม - ใครกำลังคิดอะไร นานแค่ไหน (แผง MeetingStatus เหนือแชท) */
  const [meetingStart, setMeetingStart] = useState<number | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  /** ข้อความแชทของการประชุมล่าสุด - หน้าต่าง "ห้องประชุม" อ่าน transcript สดจากตัวนี้ */
  const [liveMsgId, setLiveMsgId] = useState<string | null>(null);
  const [liveQuestion, setLiveQuestion] = useState('');
  const [roomOpen, setRoomOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
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
  /** ตั้งโมเดลรายคนจากแผงพนักงาน - เก็บในที่เดียวกับคีย์ (localStorage) เพราะ id ของชุดคีย์เป็นของเบราว์เซอร์นี้ */
  const setEmployeeLlm = useCallback((employeeId: string, connId: string | null) => {
    setLlmStore((s) => {
      const byEmployee = { ...s.byEmployee };
      if (connId) byEmployee[employeeId] = connId; else delete byEmployee[employeeId];
      const next = pruneStore({ ...s, byEmployee });
      saveStore(next);
      return next;
    });
  }, []);
  /** ตั้งโมเดลของตำแหน่งพิเศษ (ประธาน/ลูกทีม/เลขาฯ) จากแผงพนักงาน - ค่าเดียวกับใน "คีย์ของฉัน" */
  const setRoleLlm = useCallback((k: keyof LlmRoles, connId: string | null) => {
    setLlmStore((s) => {
      const roles = { ...s.roles };
      if (connId) roles[k] = connId; else delete roles[k];
      const next = pruneStore({ ...s, roles });
      saveStore(next);
      return next;
    });
  }, []);
  /**
   * sync ชุดคีย์/โมเดลขึ้นเซิร์ฟเวอร์ต่อออฟฟิศ (เข้ารหัสฝั่งเซิร์ฟเวอร์) - MCP/LINE/API จะได้ใช้โมเดลรายคนเหมือนหน้าเว็บ
   * หน่วงไว้หน่อยเพราะการตั้งค่าเปลี่ยนถี่ (เลือกโมเดลรายคนทีละคน) ไม่ต้องยิงทุกคลิก
   * เฉพาะเจ้าของ/exec ที่เซิร์ฟเวอร์รับ - คนอื่นถูกปฏิเสธเงียบ ๆ (ไม่ใช่ error ที่เขาต้องเห็น)
   */
  useEffect(() => {
    if (!office?.id || !llmStore.items.length) return;
    const officeId = office.id;
    const t = window.setTimeout(() => { void syncOfficeLlm(officeId, llmStore).catch(() => undefined); }, 800);
    return () => window.clearTimeout(t);
  }, [office?.id, llmStore]);
  /** ป้ายสำหรับแผงพนักงาน - บอกว่า "ค่าเริ่มต้น" ของลูกทีมตอนนี้คือชุดไหน */
  const memberDefault = llmStore.items.find((c) => c.id === llmStore.roles?.member) ?? llm;
  const llmDefaultLabel = memberDefault ? memberDefault.label : 'คีย์ของเซิร์ฟเวอร์';
  const headDefault = llmStore.items.find((c) => c.id === llmStore.roles?.chair) ?? memberDefault;
  const llmHeadLabel = headDefault ? headDefault.label : 'คีย์ของเซิร์ฟเวอร์';
  const llmOptions = llmStore.items.map((c) => ({ id: c.id, label: `${c.label} · ${connSubtitle(c)}` }));

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
    if (!officeId) { setProfile({}); setProducts([]); setDeptNotes({}); return; }
    // โหลดแยกกัน - ส่วนไหนพัง (เช่นยังไม่ได้รัน schema ตารางใหม่) ให้ว่างเฉพาะส่วนนั้น
    // ห้ามลากโปรไฟล์กับโน้ตแผนกที่โหลดได้ปกติล้มไปด้วย ไม่งั้นผู้ใช้เห็นฟอร์มว่างแล้วคิดว่าข้อมูลหาย
    const fail = (e: unknown) => { setSaveErr(sbError(e)); };
    loadProfile(officeId).then(setProfile).catch(fail);
    loadDeptNotes(officeId).then(setDeptNotes).catch(fail);
    listProducts(officeId).then(setProducts).catch((e) => { setProducts([]); fail(e); });
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
    return { profile, products, notes, chunks };
  }, [officeId, profile, products, deptNotes, llm]);

  const secBlocked = !supabaseConfigured
    ? 'โหมดในเครื่องยังไม่มีที่เก็บบันทึก - ตั้งค่า Supabase ก่อนถึงจะจดประวัติได้'
    : !user
      ? 'เข้าสู่ระบบก่อน แล้วเลขาฯ จะเปิดสมุดบันทึกของออฟฟิศให้'
      : !office
        ? 'เลือกออฟฟิศก่อน บันทึกการประชุมผูกอยู่กับออฟฟิศ'
        : null;

  /**
   * ลายเซ็นของสถานะล่าสุดที่ส่งเข้า React - poll ทุก 400 ms แต่ setState เฉพาะตอนมีอะไรเปลี่ยนจริง
   * เดิมสร้าง array/object ใหม่ทุกครั้ง = ทั้งหน้า (และลูกทุกตัว: แชท สมุด แผงจ้าง) re-render 2.5 ครั้ง/วิ ตลอดกาล
   * แม้ทุกคนนั่งทำงานเฉย ๆ และยิ่งแชทสะสมมากยิ่งแพงขึ้นเรื่อย ๆ
   */
  const rosterSigRef = useRef('');
  const syncRoster = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const roster = w.roster();
    const seats = w.seatsLeft();
    const rooms = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, w.seatsLeftFor(d.id)]));
    // ฟิลด์ที่ UI ใช้จริง - palette เป็น object เดิมตลอดชีวิตพนักงาน ไม่ต้องเทียบ
    const sig = `${seats}|${DEPARTMENTS.map((d) => rooms[d.id]).join(',')}|` +
      roster.map((r) => `${r.id}:${r.state}:${r.name}:${r.title}:${r.deptId}:${r.role}:${r.color}`).join(';');
    if (sig === rosterSigRef.current) return;
    rosterSigRef.current = sig;
    setRoster(roster);
    setSeatsLeft(seats);
    setRoomLeft(rooms);
  }, []);

  // เปลี่ยนออฟฟิศ = โหลดพนักงานของออฟฟิศนั้นมาแทนที่ทั้งชุด
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !ready) return;
    // โหมดในเครื่องไม่มีออฟฟิศให้โหลด - ห้ามล้าง ไม่งั้นทับพนักงานที่จ้างไว้ตอน mount
    if (!supabaseConfigured) return;
    if (!office) { w.setLayout(defaultLayout(), 'sync'); w.restore([]); syncRoster(); return; }
    // ผังก่อน แล้วค่อยพนักงาน - restore() เอาที่นั่งจากผัง (โต๊ะที่ owner เป็นเขา)
    let cancelled = false;
    (async () => {
      let layout: OfficeLayout | null = null;
      try { layout = parseLayout(await loadLayout(office.id)); } catch (e) { setLayoutErr(sbError(e)); }
      if (cancelled) return;
      const l = layout ?? defaultLayout();
      layoutRevRef.current = l.rev;
      w.setLayout(l, 'sync');
      const rows = await loadEmployees(office.id);
      if (cancelled) return;
      w.restore(rows.map((r) => ({
        id: r.id, name: r.name, title: r.title, deptId: r.dept_id,
        role: r.role as EmployeeSnapshot['role'], palette: r.palette, seat: r.seat,
      })));
      syncRoster();
    })().catch((e) => setSaveErr(sbError(e)));
    return () => { cancelled = true; };
  }, [office, ready, syncRoster]);
  useEffect(() => { officeRef.current = office; }, [office]);

  /** ผังเปลี่ยนโดยเครื่องนี้ (ลาก/หมุน/จ้าง/ไล่ออก) - บันทึกแบบหน่วง; โหมดในเครื่องลง localStorage */
  const persistLayout = useCallback((l: OfficeLayout) => {
    layoutRevRef.current = l.rev;
    if (layoutSaveTimer.current) window.clearTimeout(layoutSaveTimer.current);
    setLayoutSave('saving');
    layoutSaveTimer.current = window.setTimeout(() => {
      const office = officeRef.current;
      if (!supabaseConfigured || !office) {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); setLayoutSave('saved'); } catch { setLayoutSave('error'); }
        return;
      }
      saveLayout(office.id, l)
        .then(() => { setLayoutSave('saved'); setLayoutErr(null); })
        .catch((e) => { setLayoutSave('error'); setLayoutErr(sbError(e)); });
    }, 600);
  }, []);

  // แท็บ "จัดออฟฟิศ" = โหมดจัดบนแผนที่: เปิดแท็บ -> เข้าโหมด, ออกจากแท็บ/ปิดโหมด -> อีกฝั่งตามกัน
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !ready) return;
    // ยังไม่ล็อกอิน (ทั้งแผงถูก inert อยู่แล้ว) ก็ไม่เข้าโหมดจัด
    const canEdit = !supabaseConfigured || (authReady && !!user);
    if (sideTab === 'layout') {
      if (canEdit) w.setEditMode(true);
      // แท็บนี้มีแคตตาล็อกรูปของ - ขยายแผงบนให้พอเห็น (ผู้ใช้ย่อกลับได้ด้วยที่จับ)
      setHireH((h) => { const nh = Math.max(h, 560); if (nh !== h) saveSide(sideW, true, nh); return nh; });
    } else if (w.isEditMode()) w.setEditMode(false);
  }, [sideTab, ready, authReady, user]); // eslint-disable-line react-hooks/exhaustive-deps -- sideW/saveSide ใช้ค่าล่าสุดพอ
  useEffect(() => {
    if (!editSnap.on && sideTab === 'layout' && ready) setSideTab('staff');
    if (editSnap.on && sideTab !== 'layout') setSideTab('layout');
  }, [editSnap.on]); // eslint-disable-line react-hooks/exhaustive-deps -- ตอบสนองเฉพาะตอนโหมดเปลี่ยน

  // realtime: จออื่นแก้ผัง -> เอามาใช้ (ข้าม rev ที่เราเป็นคนเขียนเอง)
  useEffect(() => {
    const c = sb();
    if (!c || !officeId || !ready) return;
    const ch = c
      .channel(`office_layout:${officeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'office_layout', filter: `office_id=eq.${officeId}` }, (payload) => {
        const row = payload.new as { data?: unknown } | null;
        const l = row?.data ? parseLayout(row.data) : null;
        if (!l || l.rev === layoutRevRef.current) return;
        layoutRevRef.current = l.rev;
        worldRef.current?.setLayout(l, 'sync');
        syncRoster();
      })
      .subscribe();
    return () => { void c.removeChannel(ch); };
  }, [officeId, ready, syncRoster]);

  const onReady = useCallback(
    (w: World) => {
      worldRef.current = w;
      setReady(true);
      w.onEditChange(setEditSnap);
      w.onLayoutChange((l, cause) => { if (cause !== 'sync') persistLayout(l); });
      // ที่นั่งเปลี่ยน (ย้ายโต๊ะ/สลับ/จัดใหม่) - เก็บสำเนาในแถวพนักงานด้วย
      w.onSeatChange((id, seat) => {
        if (!officeRef.current) return;
        updateEmployeeSeat(id, seat).catch((e) => setSaveErr(sbError(e)));
      });
      // โหมดในเครื่อง: ผังจาก localStorage แล้วจ้างทีมกฎหมายให้ 3 คนเลย จะได้ลองถามได้ทันที
      // ถ้าต่อ Supabase อยู่ ห้ามจ้างเอง เดี๋ยวไปทับกับพนักงานที่โหลดมาจากออฟฟิศ
      if (!supabaseConfigured) {
        let l: OfficeLayout | null = null;
        try { l = parseLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')); } catch { /* ไม่มี/พัง = ค่าเริ่มต้น */ }
        if (l) { layoutRevRef.current = l.rev; w.setLayout(l, 'sync'); }
        if (w.roster().length === 0) {
          const legal = DEPT_BY_ID.get('legal')!;
          for (let i = 0; i < 3; i++) w.hire(legal);
        }
      }
      syncRoster();
    },
    [syncRoster, persistLayout],
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

  /**
   * ทั้งหน้าถูกล็อกจนกว่าจะเข้าสู่ระบบ - ยังวาดทุกอย่างให้เห็นเหมือนเดิม แต่กดอะไรไม่ได้
   * ระหว่างรอ session (authReady = false) ก็ล็อกไว้ก่อน จะได้ไม่กระพริบเปิด-ปิด
   * โหมดในเครื่อง (ไม่มี Supabase) ไม่มีอะไรให้ล็อกอินจึงปล่อยใช้ได้ตามปกติ
   */
  const locked = supabaseConfigured && (!authReady || !user);

  const hire = (deptId: string, count: number) => {
    const w = worldRef.current;
    const dept = DEPT_BY_ID.get(deptId);
    if (!w || !dept || lock || locked) return;
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
  async function proposeAgenda(question: string, directDept?: string) {
    const w = worldRef.current;
    if (!w || busy || locked) return;

    const hiredDeptIds = [...new Set(w.roster().map((r) => r.deptId))];
    setMessages((ms) => [...ms, { id: newId(), role: 'user', text: question }]);

    // ถามแผนกโดยตรง - ข้ามหน้าวาระ ให้หัวหน้าแผนกนั้นตอบคนเดียว (คำขอ LLM ครั้งเดียว เร็ว)
    if (directDept && hiredDeptIds.includes(directDept)) {
      const snap = w.roster();
      const headId = deptHeadIds(snap).get(directDept);
      if (headId) {
        void runMeeting(question, { agentIds: [headId], mode: 'direct', ownerDeptId: directDept, chairId: headId });
        return;
      }
    }

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

  /* ============================================================
     การประชุมหนึ่งครั้ง = session เดียว ไม่ว่าจะเริ่มจากจอนี้ (SSE) หรือจากที่อื่น (Realtime)
     session ถือ state ทั้งหมด (ข้อความในแชท, animation, บันทึก) แล้วรับ event ทีละตัวผ่าน handle()
     ตัวยิง event เป็นใครก็ได้ - นี่คือสิ่งที่ทำให้ MCP/LINE เรียกประชุมแล้วทุกจอเห็นเหมือนกัน
     ============================================================ */

  interface SessionInit {
    question: string;
    mode: MeetingMode;
    team: AskAgent[];
    /** ประธาน/เจ้าของเรื่อง */
    owner: AskAgent;
    attendees: MeetingAttendeeLite[];
    /** จอนี้เป็นคนเริ่มไหม - remote คือคนอื่น/ระบบอื่นเริ่ม จอนี้แค่ดู */
    source: 'local' | 'remote';
    /** id ในสมุด ถ้าเซิร์ฟเวอร์บันทึกให้ - remote มีเสมอ, local มีเมื่อได้ event 'meeting' */
    serverMeetingId?: string | null;
    /**
     * คำถามจากคนนอก (LINE/MCP/API) ที่ถามแผนกตรง ๆ - ไม่ใช่ประชุม
     * ให้ "แขก" เดินเข้ามาหาคนตอบ คุยกันหน้าเคาน์เตอร์ แล้วเดินออก
     */
    visitor?: { name: string };
  }

  interface Session {
    handle: (ev: AskEvent) => void;
    /** ปิดฉาก - errorText มีค่า = พัง */
    end: (errorText?: string) => Promise<void>;
    /** จัดตัวละครเข้าที่ก่อนเริ่ม (เดินเข้าห้อง / เดินไปหาบอส) */
    stage: () => Promise<void>;
    readonly id: string;
  }

  function openSession(init: SessionInit): Session {
    const w = worldRef.current!;
    const { question, owner, attendees } = init;
    let mode = init.mode;
    // ทีมเปลี่ยนได้กลางทาง: ลูกค้าถาม PR แล้ว PR ต้องพาทีมเข้าประชุม (event escalate)
    let team = init.team;
    let ids = team.map((t) => t.id);
    let names = team.map((t) => t.name);
    const snap = w.roster();
    let deptIds = [...new Set(team.map((t) => t.deptId))];
    let relay = mode === 'relay';
    const direct = mode === 'direct';
    let serverMeetingId = init.serverMeetingId ?? null;
    /** แขกที่เดินเข้ามาถาม (เฉพาะ init.visitor) - id ตัวละครชั่วคราวใน world */
    let visitorId: string | null = null;
    /** PR พาทีมไปประชุมก่อนตอบลูกค้า - แขกนั่งรอ */
    let escalated = false;
    /** คำตอบที่กรองแล้วสำหรับลูกค้า - สิ่งเดียวที่แขกได้ยิน */
    let customerReply = '';

    const pendingId = newId();
    setLiveMsgId(pendingId);
    setLiveQuestion(question);
    setMessages((ms) => [
      ...ms,
      // remote: โชว์คำถามด้วย เพราะจอนี้ไม่ได้พิมพ์เอง จะได้รู้ว่าประชุมเรื่องอะไร
      ...(init.source === 'remote'
        ? [{ id: newId(), role: 'user' as const, text: `[ถามผ่านระบบภายนอก] ${question}` }]
        : []),
      {
        id: pendingId, role: 'agent', text: '', pending: true,
        departmentId: owner.deptId, authorName: owner.name,
        mode, deptIds, transcript: [], consults: [],
      },
    ]);

    setBusy(true);
    busyRef.current = true;
    setPhase('เรียกทีมเข้าห้องประชุม...');
    setMeetingStart(Date.now());
    setActivities([]);

    /** ใครเริ่มคิด - ถ้าคนเดิมเพิ่งทำงานก่อนหน้าเสร็จ เก็บเวลาไว้ใน history แล้วเริ่มนับใหม่ */
    const startWork = (ev: { agentId: string; agentName: string; task: Activity['task']; label: string; model?: string }) => {
      const r = snap.find((x) => x.id === ev.agentId);
      const isSec = ev.agentId === 'secretary';
      setActivities((xs) => {
        const cur = xs.find((a) => a.agentId === ev.agentId);
        const history = cur ? [...cur.history, ...(cur.doneAt ? [{ task: cur.task, ms: cur.doneAt - cur.startedAt }] : [])] : [];
        const next: Activity = {
          agentId: ev.agentId, name: ev.agentName, deptId: r?.deptId,
          palette: r?.palette ?? (isSec ? SECRETARY_PAL : undefined),
          model: ev.model, task: ev.task, label: ev.label, startedAt: Date.now(), history,
        };
        return cur ? xs.map((a) => (a.agentId === ev.agentId ? next : a)) : [...xs, next];
      });
    };
    const doneWork = (agentId: string, failed = false) =>
      setActivities((xs) => xs.map((a) => (a.agentId === agentId && !a.doneAt ? { ...a, doneAt: Date.now(), failed } : a)));
    /** ประชุมหยุดกลางทาง - ทุกคนที่ยังคิดอยู่ถือว่าถูกตัด จะได้ไม่มีนาฬิกาเดินค้างทั้งที่ห้องว่างแล้ว */
    const abortWork = (why: string) =>
      setActivities((xs) => xs.map((a) => (a.doneAt ? a : { ...a, doneAt: Date.now(), failed: true, label: `${a.label} (${why})` })));

    const transcript: Opinion[] = [];
    const consults: Consult[] = [];
    let finalText = '';
    let leadId = owner.id;
    let leadName = owner.name;
    let finalModel: string | undefined;
    let minutesText = '';

    /**
     * ปิดฉากการประชุม: ให้ประธานพูดสรุป โชว์คำตอบ แล้วบันทึกลงสมุด
     * เรียกทันทีที่ได้ final - ไม่รอเลขาฯ ที่ยังเขียนรายงานอยู่ (โมเดลเล็กใช้เวลาเป็นนาที)
     * ถ้าเซิร์ฟเวอร์บันทึกให้แล้ว (serverMeetingId) จอนี้ไม่บันทึกซ้ำ แค่โหลดสมุดใหม่
     */
    let finishP: Promise<void> | null = null;
    let savedRowP: Promise<{ id: string } | null> | null = null;
    const finish = () => {
      if (finishP) return finishP;
      finishP = (async () => {
        if (visitorId) {
          // ตอบแขก - เฉพาะข้อความที่กรองแล้ว (customerReply) ไม่ใช่สรุปภายใน
          setPhase(`${owner.name} กำลังตอบ${init.visitor?.name ?? 'ลูกค้า'}...`);
          await w.waitForSpeech();
          if (escalated) {
            // เลิกประชุม ทีมกลับที่ แล้ว PR เดินไปหาแขกที่นั่งรออยู่
            w.disperse(ids.filter((id) => id !== owner.id));
            w.focus(owner.id);
            await w.visitorReturn(owner.id, visitorId);
          }
          w.bubble(owner.id, 'talk', 1);
          const spoken = (customerReply || finalText).replace(/\*\*/g, '').trim();
          w.say(owner.id, spoken.length > 700 ? `${spoken.slice(0, 700)}...` : spoken || 'ขออภัยค่ะ ตอนนี้ยังตอบไม่ได้', 4, () => {
            w.faceToward(owner.id, visitorId!);
          });
          w.say(visitorId, 'ขอบคุณมากค่ะ', 2, () => { w.react(owner.id, 'idea', 2); });
          await w.waitForSpeech();
        } else {
          setPhase('รอทีมถกให้จบ...');
          await w.waitForSpeech();

          setPhase('สรุปให้ผู้บริหาร...');
          w.faceToward(leadId, w.bossId);
          if (finalText) w.sayNow(leadId, summaryLine(finalText), 5);
          await new Promise((r) => setTimeout(r, 1800));
          w.react(w.bossId, 'idea', 3);
          await new Promise((r) => setTimeout(r, 900));
        }

        patch(pendingId, {
          pending: false,
          text: finalText || '(ไม่ได้รับคำตอบ)',
          authorName: leadName,
          model: finalModel,
          transcript: [...transcript],
          consults: [...consults],
        });

        if (serverMeetingId) {
          // เซิร์ฟเวอร์เขียนแถวไว้แล้วตั้งแต่เริ่ม - แค่ดึงสมุดใหม่ให้เห็นแถวนั้น
          refreshMeetings();
        } else if (office && init.source === 'local') {
          savedRowP = saveMeeting({
            office_id: office.id,
            asked_by: user?.id ?? null,
            question,
            mode,
            owner_dept: owner.deptId,
            dept_ids: deptIds,
            attendees,
            summary: finalText,
            minutes: minutesText,
            transcript,
            consults,
          })
            .then((row) => {
              if (row) setMeetings((ms) => [row, ...ms]);
              return row;
            })
            .catch((e) => { setSaveErr(sbError(e)); return null; });
        }
      })();
      return finishP;
    };

    /** รายงานเลขาฯ มาทีหลัง - เติมลงแถวที่จอนี้บันทึกไว้ (เซิร์ฟเวอร์บันทึกให้อยู่แล้วก็แค่โหลดสมุดใหม่) */
    const attachMinutes = (text: string) => {
      if (serverMeetingId) { refreshMeetings(); return; }
      if (!savedRowP) return;
      void savedRowP.then((row) => {
        if (!row) return;
        updateMeetingMinutes(row.id, text)
          .then(() => setMeetings((ms) => ms.map((m) => (m.id === row.id ? { ...m, minutes: text } : m))))
          .catch((e) => setSaveErr(sbError(e)));
      });
    };

    const handle = (ev: AskEvent) => {
      if (ev.type === 'meeting') {
        serverMeetingId = ev.id;
      } else if (ev.type === 'skill') {
        patch(pendingId, { proof: ev.proof });
      } else if (ev.type === 'phase') {
        setPhase(ev.label);
        if (!visitorId || escalated) ids.forEach((id) => w.bubble(id, ev.phase === 'synthesis' ? 'board' : 'talk', 2));
      } else if (ev.type === 'working') {
        startWork(ev);
      } else if (ev.type === 'consult') {
        doneWork(ev.fromAgentId);
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
        doneWork(ev.agentId);
        const op: Opinion = {
          agentId: ev.agentId, agentName: ev.agentName, agentRole: ev.agentRole,
          deptId: ev.deptId, round: ev.round, step: ev.step, askedBy: ev.askedBy,
          text: ev.text, model: ev.model,
        };
        transcript.push(op);
        patch(pendingId, { transcript: [...transcript] });

        if (relay) {
          w.say(ev.agentId, excerpt(ev.text, 1), undefined, () => {
            w.faceToward(ev.agentId, owner.id);
            w.react(owner.id, 'idea', 2.4);
          });
        } else {
          const targetName = op.round === 2 ? objectionTarget(op.text, names) : null;
          const target = team.find((t) => t.name === targetName && t.id !== op.agentId);
          w.say(op.agentId, excerpt(op.text, op.round), undefined, () => {
            if (!target) return;
            w.faceToward(op.agentId, target.id);
            w.react(target.id, 'question', 2.6);
          });
        }
      } else if (ev.type === 'final') {
        doneWork(ev.leadAgentId);
        finalText = ev.text;
        leadId = ev.leadAgentId;
        leadName = ev.leadAgentName;
        finalModel = ev.model;
        // แขก: รอ customer_reply (ข้อความที่กรองแล้ว) ก่อนค่อยปิดฉาก - สรุปภายในโชว์ในแชท/สมุดเท่านั้น
        if (!visitorId) void finish();
        else patch(pendingId, { text: finalText, transcript: [...transcript], consults: [...consults] });
      } else if (ev.type === 'escalate') {
        // PR ตอบเองไม่ได้ - บอกแขกให้รอ พาทีมเข้าห้องประชุม (สายพาน: PR ถือคำถามไปถามทีละแผนก)
        escalated = true;
        mode = 'relay'; relay = true;
        team = ev.agents;
        ids = team.map((t) => t.id);
        names = team.map((t) => t.name);
        deptIds = [...new Set(team.map((t) => t.deptId))];
        patch(pendingId, { mode: 'relay', deptIds });
        setMessages((ms) => [...ms, { id: newId(), role: 'system', text: `${ev.agentName} ขอปรึกษาทีมก่อนตอบลูกค้า: "${ev.internalQuestion}"` }]);
        if (visitorId) {
          const vid = visitorId;
          w.say(ev.agentId, ev.text, 3, () => w.faceToward(ev.agentId, vid));
          void (async () => {
            await w.waitForSpeech();
            setPhase(`${init.visitor?.name ?? 'ลูกค้า'} นั่งรอ - ${ev.agentName} ไปปรึกษาทีม...`);
            await w.visitorWait(vid);
            w.focusRect(w.meetingRect());
            await w.gather(ids);
            w.setDeliberating(ids);
          })();
        }
      } else if (ev.type === 'customer_reply') {
        customerReply = ev.text;
        patch(pendingId, { customerReply: ev.text });
        if (visitorId) void finish();
      } else if (ev.type === 'minutes') {
        doneWork('secretary', !!ev.error);
        if (ev.error) {
          setMessages((ms) => [...ms, { id: newId(), role: 'system', text: `เลขาฯ จดรายงานการประชุมไม่สำเร็จ: ${ev.error}` }]);
        } else if (ev.text) {
          minutesText = ev.text;
          w.say(w.secretaryId, 'จดรายงานการประชุมเรียบร้อยค่ะ', 3);
          attachMinutes(ev.text);
          patch(pendingId, { minutes: ev.text });
        }
      }
      // 'error' / 'done' ให้คนขับ (SSE loop หรือ Realtime) เรียก end() เอง เพราะต้องปิดแหล่ง event ด้วย
    };

    const stage = async () => {
      w.saveView();
      if (init.visitor && direct) {
        // แขกโผล่ที่ประตูสวน เดินมาหาคนตอบ (PR = หน้าเคาน์เตอร์ / แผนกอื่น = หน้าประตูห้อง)
        setPhase(`${init.visitor.name} กำลังเดินเข้ามา...`);
        visitorId = w.spawnVisitor(init.visitor.name);
        w.focus(visitorId);
        await w.visitorApproach(visitorId, owner.id);
        w.focus(owner.id);
        w.say(visitorId, question, 3, () => { w.faceToward(owner.id, visitorId!); });
        w.visitorHostThinking(owner.id);
        setPhase(`${owner.name} กำลังหาคำตอบให้${init.visitor.name}...`);
        return;
      }
      if (direct) {
        setPhase(`${owner.name} กำลังเดินไปหาคุณ...`);
        w.focusRect(w.bossRect());
        await w.report(owner.id);
        w.say(w.bossId, question, 3);
      } else {
        w.focusRect(w.meetingRect());
        await w.gather(ids);
        w.setDeliberating(ids);
        w.say(w.bossId, `วาระวันนี้: ${question}`, 3);
      }
      setPhase(direct ? `${owner.name} กำลังตอบ...` : relay ? `${owner.name} รับเรื่องไปเดินสาย...` : 'ทีมกำลังถกกัน...');
    };

    let ended = false;
    const end = async (errorText?: string) => {
      if (ended) return;
      ended = true;
      try {
        if (errorText) {
          abortWork('ประชุมหยุดเพราะ error');
          setPhase(`ประชุมหยุด: ${errorText.slice(0, 80)}`);
          w.clearSay(ids);
          patch(pendingId, {
            pending: false,
            role: 'system',
            text: `เกิดข้อผิดพลาด: ${errorText}`,
            transcript: transcript.length ? [...transcript] : undefined,
          });
          return;
        }
        if (!finalText) abortWork('การเชื่อมต่อถูกตัดก่อนตอบ');
        else abortWork('ไม่ได้ผลลัพธ์');
        await finish();
      } finally {
        if (visitorId) {
          // แขกเดินออก คนตอบกลับที่ - กล้องตามแขกจนพ้นจอ แล้วค่อยคืนมุมกล้องเดิม
          w.clearSay();
          w.focus(visitorId);
          void w.visitorLeave(visitorId, owner.id).then(() => { w.focus(null); w.restoreView(); });
        } else {
          w.disperse(ids);
          w.restoreView();
        }
        setPhase(null);
        setBusy(false);
        busyRef.current = false;
      }
    };

    return { handle, end, stage, id: pendingId };
  }

  /** แปลง roster เป็น AskAgent (พร้อมป้ายหัวหน้าแผนก) - ใช้ทั้งเริ่มเองและเวลาต้องส่งไป headless */
  function toAgents(snap: EmployeeSnapshot[], agentIds: string[]): AskAgent[] {
    const heads = deptHeadIds(snap);
    return agentIds
      .map((id) => snap.find((r) => r.id === id))
      .filter((r): r is EmployeeSnapshot => !!r)
      .map((r) => {
        const d = DEPT_BY_ID.get(r.deptId);
        return {
          id: r.id, name: r.name, role: r.role, deptId: r.deptId,
          deptName: d?.nameTh ?? r.deptId, lens: d?.lenses[r.role] ?? '',
          isHead: heads.get(r.deptId) === r.id,
        };
      });
  }

  const toAttendees = (snap: EmployeeSnapshot[], agentIds: string[]): MeetingAttendeeLite[] =>
    agentIds
      .map((id) => snap.find((r) => r.id === id))
      .filter((r): r is EmployeeSnapshot => !!r)
      .map((r) => ({ id: r.id, name: r.name, title: r.title, deptId: r.deptId, palette: r.palette }));

  /** ขั้นที่ 2 - ประชุมจริงตามรายชื่อที่ผู้ใช้ยืนยันแล้ว (จอนี้เป็นคนขับ รับ event ทาง SSE) */
  async function runMeeting(question: string, pick: AgendaPick) {
    const w = worldRef.current;
    if (!w || busyRef.current) return;

    const snap = w.roster();
    const team = toAgents(snap, pick.agentIds);
    if (!team.length) return;
    const attendees = toAttendees(snap, pick.agentIds);
    const owner = team.find((t) => t.id === pick.chairId)
      ?? team.find((t) => t.deptId === pick.ownerDeptId && t.isHead)
      ?? team.find((t) => t.deptId === pick.ownerDeptId)
      ?? team[0];
    const ids = team.map((t) => t.id);
    const deptIds = [...new Set(team.map((t) => t.deptId))];

    const s = openSession({ question, mode: pick.mode, team, owner, attendees, source: 'local' });
    // จอนี้เป็นคนเริ่ม - event ที่ Realtime ส่งย้อนกลับมาของประชุมนี้ต้องไม่ถูกเล่นซ้ำ
    let errorText = '';
    try {
      // ประกอบข้อมูลบริษัทระหว่างที่คนกำลังเดิน - ไม่ให้ผู้ใช้รอสองต่อ
      const companyPromise = buildCompanyContext(question, deptIds);
      await s.stage();
      const company = await companyPromise;
      const token = await accessToken();
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(llm),
          ...(token ? { 'x-sb-token': token } : {}),
        },
        body: JSON.stringify({
          question,
          mode: pick.mode,
          ownerDeptId: owner.deptId,
          chairId: owner.id,
          agents: team,
          attendees,
          officeId: office?.id,
          company,
          llm: llmAssignment(llmStore, ids),
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
          if (ev.type === 'meeting') localMeetingIds.current.add(ev.id);
          if (ev.type === 'error') { errorText = ev.message; streaming = false; break; }
          if (ev.type === 'done') { streaming = false; break; }
          s.handle(ev);
        }
      }
      await s.end(errorText || undefined);
    } catch (err) {
      await s.end(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * ประชุมที่เริ่มจากที่อื่น (จออื่น / API / MCP / LINE) - เซิร์ฟเวอร์เขียน event ลง DB
   * จอนี้ subscribe แล้วเล่น animation ตามเหมือนนั่งอยู่ในห้อง
   * ประชุมนี้จอนี้ไม่ได้ขับ ไม่ต้องยิง API ไม่ต้องบันทึก แค่ดู
   */
  const openSessionRef = useRef(openSession);
  openSessionRef.current = openSession;
  const remoteSessions = useRef<Map<string, Session>>(new Map());
  const localMeetingIds = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);
  const onRemoteEvent = useCallback((meetingId: string, ev: AskEvent) => {
    if (localMeetingIds.current.has(meetingId)) return; // ของจอนี้เอง ได้ทาง SSE ไปแล้ว
    const w = worldRef.current;
    if (!w) return;
    let s = remoteSessions.current.get(meetingId);
    if (ev.type === 'meeting') {
      if (s || busyRef.current) return; // มีประชุมอยู่แล้ว - จอเดียวเล่นได้ทีละเรื่อง
      const snap = w.roster();
      // ผู้เข้าประชุมต้องอยู่ในออฟฟิศนี้จริง (roster โหลดจาก DB เดียวกัน) - ไม่เจอเลยก็ดูไม่ได้ ข้าม
      const team = ev.agents.filter((a) => snap.some((r) => r.id === a.id));
      if (!team.length) return;
      const owner = team.find((a) => a.id === ev.chairId) ?? team.find((a) => a.deptId === ev.ownerDeptId) ?? team[0];
      // คำถามตรงจากคนนอก = แขกเดินเข้ามา ไม่ใช่ประชุม (ประชุมข้ามแผนกยังเข้าห้องประชุมตามเดิม)
      // ลูกค้า (audience customer) = "ลูกค้า (ช่องทาง)"  agent ภายในที่ถามผ่าน MCP/API = "Agent (ช่องทาง)"
      const via = ev.source === 'line' ? 'LINE' : ev.source === 'mcp' ? 'MCP' : ev.source === 'api' ? 'API' : null;
      // มีชื่อจริงจากช่องทาง (เช่นชื่อโปรไฟล์ LINE) ให้ตัวละครใช้ชื่อนั้น - ไม่มีค่อยเป็น "ลูกค้า (LINE)"
      const visitorName = !via ? null
        : ev.askedBy?.trim() ? ev.askedBy.trim()
        : ev.audience === 'customer' ? `ลูกค้า (${via})` : `Agent (${via})`;
      s = openSessionRef.current({
        question: ev.question, mode: ev.mode, team, owner,
        attendees: ev.attendees, source: 'remote', serverMeetingId: meetingId,
        visitor: ev.mode === 'direct' && visitorName ? { name: visitorName } : undefined,
      });
      remoteSessions.current.set(meetingId, s);
      void s.stage();
      return;
    }
    if (!s) return;
    if (ev.type === 'error') { remoteSessions.current.delete(meetingId); void s.end(ev.message); return; }
    if (ev.type === 'done') { remoteSessions.current.delete(meetingId); void s.end(); return; }
    s.handle(ev);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // subscribe event ของออฟฟิศนี้ - เปิดไว้ตลอดที่ล็อกอินและเลือกออฟฟิศอยู่
  useEffect(() => {
    const c = sb();
    if (!c || !officeId || !ready) return;
    const ch = c
      .channel(`meeting_event:${officeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'meeting_event', filter: `office_id=eq.${officeId}` },
        (payload) => {
          const row = payload.new as { meeting_id: string; payload: AskEvent };
          if (row?.meeting_id && row.payload) onRemoteEvent(row.meeting_id, row.payload);
        },
      )
      .subscribe();
    return () => { void c.removeChannel(ch); };
  }, [officeId, ready, onRemoteEvent]);

  const hiredDeptIds = [...new Set(roster.map((r) => r.deptId))];
  /**
   * สมุดเลขาฯ = เรื่องภายในล้วน (การประชุมของคนใน)
   * ทุกอย่างที่ลูกค้าติดต่อเข้ามา - รวมที่ต้องปรึกษาทีม - อยู่สมุดประชาสัมพันธ์ที่เดียว (กางดูสรุป/รายงานภายในได้ตรงนั้น)
   * แถวเก่าที่ยังไม่มีคอลัมน์ audience ถือเป็นภายใน
   */
  const secretaryMeetings = meetings.filter((m) => m.audience !== 'customer');
  const busyAgents = roster.filter((r) => ['meet', 'think', 'report'].includes(r.state)).length;

  return (
    <main className="flex h-screen flex-col gap-2.5 p-2.5 max-[1080px]:h-auto">
      {/* แถบบนเป็นแผ่นไม้ ให้รู้สึกเหมือนป้ายหน้าออฟฟิศ ไม่ใช่ nav ของเว็บแอป */}
      <header className="bevel flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border-2 border-wood-deep bg-wood-mid px-3 py-2">
        <h1 className="flex items-center gap-2 text-[15px] text-parchment">
          {editSnap.logo && <img src={editSnap.logo} alt="" className="h-6 max-w-[96px] rounded-sm" />}
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

          {/* เชื่อมต่อ MCP/API/LINE - แยกจากปุ่มออฟฟิศ เพราะเป็นเรื่องระบบภายนอก ไม่ใช่การเลือกออฟฟิศ */}
          {supabaseConfigured && user && office && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIntegrationsOpen(true)}
              title="token สำหรับ MCP / API / LINE - ให้ agent ข้างนอกหรือลูกค้าถามออฟฟิศนี้ได้"
              className="border-wood-deep text-parchment-2 hover:bg-wood-dark"
            >
              <Plug /> เชื่อมต่อ
            </Button>
          )}

          {/* ทุกปุ่มที่เหลือใช้ไม่ได้จนกว่าจะเข้าสู่ระบบ - inert กันทั้งคลิกและคีย์บอร์ด */}
          <div
            inert={locked || undefined}
            aria-disabled={locked || undefined}
            className={cn('flex flex-wrap items-center gap-1.5', locked && 'opacity-40')}
          >
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

          {/* ห้องประชุม - โผล่เฉพาะตอนมีประชุม (หรือเพิ่งจบ) เปิดดูเต็ม ๆ ว่าใครทำอะไร คุยอะไรไปแล้ว */}
          {meetingStart !== null && (
            <Button
              variant={busy ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setRoomOpen(true)}
              title="ดูสถานะรายคนและบทสนทนาสดของการประชุม"
              className={busy ? undefined : 'border-brass text-brass hover:bg-wood-dark'}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <MessagesSquare />}
              การประชุม
              {(() => {
                const n = messages.find((m) => m.id === liveMsgId)?.transcript?.length ?? 0;
                return n > 0 ? (
                  <span className="rounded-box bg-brass px-1 text-[10px] font-bold text-ink-900">{n}</span>
                ) : null;
              })()}
            </Button>
          )}

          {/* ประชาสัมพันธ์ (operator) - ลูกค้าติดต่ออะไรเข้ามาบ้าง คู่กับสมุดเลขาฯ ที่เป็นเรื่องภายใน */}
          {(() => {
            const customers = meetings.filter((m) => m.audience === 'customer');
            const today = new Date().toDateString();
            const todayCount = customers.filter((m) => new Date(m.created_at).toDateString() === today).length;
            const running = customers.some((m) => m.status === 'running');
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOperatorOpen(true)}
                title="สมุดประชาสัมพันธ์ - ลูกค้าติดต่ออะไรเข้ามา ตอบไปว่าอะไร"
                className={`gap-1 ${running ? 'border-brass text-brass' : 'border-wood-deep text-parchment-2'} hover:bg-wood-dark`}
              >
                {running ? <LoaderCircle className="animate-spin" /> : <BellRing />}
                ลูกค้า
                {todayCount > 0 && (
                  <span className="rounded-box bg-brass px-1 text-[10px] font-bold text-ink-900" title="วันนี้">{todayCount}</span>
                )}
              </Button>
            );
          })()}

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
            {secretaryMeetings.length > 0 && (
              <span className="rounded-box bg-brass px-1 text-[10px] font-bold text-ink-900">
                {secretaryMeetings.length}
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
            variant={editSnap.on ? 'primary' : 'outline'}
            size="sm"
            disabled={!ready || locked}
            title="จัดโต๊ะ เก้าอี้ ของตกแต่ง - ลากย้าย หมุน เลือกคนนั่ง"
            className={editSnap.on ? undefined : 'border-wood-deep text-parchment-2 hover:bg-wood-dark'}
            onClick={() => {
              if (editSnap.on) { worldRef.current?.setEditMode(false); return; }
              setSideOpen(true); saveSide(sideW, true, hireH); setSideTab('layout');
            }}
          >
            <Wrench /> จัดออฟฟิศ
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
        </div>
      </header>

      {/* ความกว้างมาทาง CSS variable ไม่ใช่ inline grid-template
          เพราะ inline style จะชนะ media query แล้วจอแคบจะไม่ยอมตกลงมาเป็นคอลัมน์เดียว */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {/* ยังไม่เข้าสู่ระบบ = เห็นออฟฟิศเหมือนเดิมแต่จับต้องไม่ได้ ทั้งแผนที่ แผงจ้าง และช่องแชท */}
      {locked && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="bevel pointer-events-auto flex flex-col items-center gap-2 rounded-box border-2 border-wood-deep bg-wood-mid px-5 py-4 text-center shadow-lg">
            <span className="text-[13px] font-semibold text-parchment">
              {authReady ? 'เข้าสู่ระบบเพื่อใช้งานพนักงาน' : 'กำลังตรวจสอบสถานะการเข้าสู่ระบบ'}
            </span>
            <span className="text-[11px] text-parchment-2/80">
              จ้างพนักงาน ประชุม และบันทึกทั้งหมด ผูกอยู่กับบัญชีของคุณ
            </span>
            {authReady && (
              <Button variant="primary" size="sm" onClick={() => setOfficeOpen(true)}>
                <LogIn /> เข้าสู่ระบบ
              </Button>
            )}
          </div>
        </div>
      )}
      <div
        inert={locked || undefined}
        aria-disabled={locked || undefined}
        className={cn(
          'grid min-h-0 flex-1 gap-2.5 [grid-template-columns:var(--cols)] max-[1080px]:grid-cols-1',
          locked && 'opacity-50 saturate-50',
        )}
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
            className="flex min-h-0 shrink-0 flex-col overflow-hidden [&>section]:min-h-0 [&>section]:flex-1"
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
              layoutPanel={<LayoutPanel world={worldRef.current} snap={editSnap} roster={roster} save={layoutSave} saveErr={layoutErr} />}
              meetingCount={secretaryMeetings.length}
              llmOptions={llmOptions}
              llmOf={(id) => llmStore.byEmployee?.[id]}
              llmDefaultLabel={llmDefaultLabel}
              onLlm={setEmployeeLlm}
              roleLlm={llmStore.roles}
              onRoleLlm={setRoleLlm}
              llmActiveLabel={llm ? llm.label : 'คีย์ของเซิร์ฟเวอร์'}
              llmHeadLabel={llmHeadLabel}
              secretary={
                <SecretaryTab
                  meetings={secretaryMeetings}
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

          <MeetingStatus
            startedAt={meetingStart}
            phase={phase}
            activities={activities}
            onClose={() => { setMeetingStart(null); setActivities([]); }}
          />
          <ChatPanel
            messages={messages}
            busy={busy || agendaOpen}
            phase={phase}
            onSend={proposeAgenda}
            hiredDeptIds={hiredDeptIds}
          />
        </aside>
        )}
      </div>
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
        products={products}
        deptNotes={deptNotes}
        onChanged={refreshCompany}
        llmHeaders={authHeaders(llm)}
        llmLabel={llm?.label ?? 'คีย์ของเซิร์ฟเวอร์'}
        blocked={secBlocked}
      />

      <IntegrationsPanel open={integrationsOpen} onClose={() => setIntegrationsOpen(false)} office={office} />
      <OperatorPanel
        open={operatorOpen}
        onClose={() => setOperatorOpen(false)}
        meetings={meetings}
        loading={meetingsLoading}
        onRefresh={refreshMeetings}
      />
      <MeetingRoomPanel
        open={roomOpen}
        onClose={() => setRoomOpen(false)}
        message={messages.find((m) => m.id === liveMsgId) ?? null}
        question={liveQuestion}
        startedAt={meetingStart}
        phase={phase}
        activities={activities}
      />
      <KeyPanel
        open={keyOpen}
        store={llmStore}
        onClose={() => setKeyOpen(false)}
        onChange={setLlmStoreSaved}
        roster={roster}
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
