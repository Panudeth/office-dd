import 'server-only';
import { buildAgenda } from '@/lib/agenda';
import { ESCALATE_MARK, customerRewrite, normalizeMode, runMeetingEngine, skillTextOf } from '@/lib/engine';
import { embedTexts } from '@/lib/embed';
import { DEPARTMENTS, DEPT_BY_ID, ROLE_ORDER, type AgentRole } from '@/lib/departments';
import { deptHeadIds } from '@/lib/heads';
import { resolveCreds, type Creds } from '@/lib/llm';
import { persistMeeting } from '@/lib/meeting-store';
import { sbAdmin } from '@/lib/supabase-admin';
import { publicProducts, publicProfile, type CompanyContext, type Product } from '@/lib/company';
import type {
  AskAgent, AskEvent, MeetingAttendeeLite, MeetingAudience, MeetingMode, MeetingSource, Opinion,
} from '@/lib/protocol';
import type { Palette } from '@/game/types';

/* ============================================================
   ประชุมแบบไม่มีเบราว์เซอร์ - MCP / LINE / API เรียกเข้ามา
   เซิร์ฟเวอร์โหลดพนักงาน + ข้อมูลบริษัทเอง (service key) รัน engine เขียน event ลง DB
   จอที่เปิดอยู่จะเห็นคนลุกไปประชุมผ่าน Realtime ส่วนคนเรียกได้คำตอบกลับเป็น JSON
   ============================================================ */

export interface HeadlessInput {
  officeId: string;
  question: string;
  source: MeetingSource;
  /** ไม่ระบุ = ให้เลขาฯ เลือกแผนกจากคำถาม (เหมือนหน้าวาระ) */
  deptIds?: string[];
  mode?: MeetingMode;
  /**
   * คนนอกถาม (LINE) - ให้เห็นเฉพาะข้อมูลที่เปิดเผยได้: โปรไฟล์ + สินค้า + โน้ต/เอกสารของแผนกที่ตอบเท่านั้น
   * ไม่เห็นโน้ตแผนกอื่นและเอกสารที่ไม่ได้ผูกแผนก
   */
  publicOnly?: boolean;
  /** ใครถาม - customer = ลูกค้า: PR ตอบเอง/escalate แล้วกรองคำตอบให้ (แทน publicOnly) */
  audience?: MeetingAudience;
  /** ชุดคีย์ - ไม่ส่งมาใช้ของ .env (LLM_PROVIDER ฯลฯ) */
  creds?: Creds | null;
  /** ใครถาม (ข้อความอิสระ เช่น LINE user id) - แนบไปในคำถามให้ agent รู้บริบท */
  askedByLabel?: string;
}

export interface HeadlessResult {
  meetingId: string | null;
  /** คำตอบภายใน (สรุปของประธาน/PR) */
  answer: string;
  /** คำตอบที่ PR กรองแล้วสำหรับลูกค้า - ว่างถ้าคนถามเป็นภายใน */
  customerReply: string;
  minutes: string;
  transcript: Opinion[];
  chair: { id: string; name: string; deptId: string } | null;
  deptIds: string[];
  mode: MeetingMode;
  model: string | null;
  error: string | null;
  /** ลูกค้าถามแล้ว PR ต้องปรึกษาทีมก่อน */
  escalated: boolean;
}

interface EmployeeRowLite {
  id: string; name: string; title: string; dept_id: string; role: string; palette: Palette;
}

/** พนักงานของออฟฟิศเรียงตามลำดับจ้าง - ลำดับสำคัญเพราะคนแรกของแผนกคือหัวหน้า */
export async function loadOfficeStaff(officeId: string): Promise<EmployeeRowLite[]> {
  const c = sbAdmin();
  if (!c) return [];
  const { data, error } = await c
    .from('employee')
    .select('id,name,title,dept_id,role,palette')
    .eq('office_id', officeId)
    .order('hired_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeRowLite[];
}

/** แผนกที่มีคนอยู่ + หัวหน้า - ให้ MCP list ได้ */
export async function listOfficeDepartments(officeId: string) {
  const staff = await loadOfficeStaff(officeId);
  const heads = deptHeadIds(staff.map((s) => ({ id: s.id, deptId: s.dept_id })));
  return DEPARTMENTS
    .map((d) => {
      const team = staff.filter((s) => s.dept_id === d.id);
      const head = team.find((s) => s.id === heads.get(d.id));
      return {
        id: d.id, name: d.nameTh, short: d.shortTh, headcount: team.length,
        head: head ? { id: head.id, name: head.name, title: head.title } : null,
        members: team.map((s) => ({ id: s.id, name: s.name, title: s.title, role: s.role })),
      };
    })
    .filter((d) => d.headcount > 0);
}

/** ข้อมูลบริษัทฝั่งเซิร์ฟเวอร์ - โปรไฟล์/สินค้า/โน้ตแผนก + ค้นเอกสารด้วยคีย์ที่มี */
async function loadCompany(
  officeId: string, question: string, deptIds: string[], creds: Creds | null, publicOnly: boolean,
): Promise<CompanyContext> {
  const c = sbAdmin()!;
  const [{ data: prof }, { data: prods }, { data: notes }] = await Promise.all([
    c.from('office_profile').select('fields').eq('office_id', officeId).maybeSingle(),
    c.from('office_product').select('id,name,description,price,note').eq('office_id', officeId).order('sort_order'),
    c.from('office_dept_note').select('dept_id,body').eq('office_id', officeId).in('dept_id', deptIds),
  ]);
  const rawProfile = (prof as { fields?: Record<string, string> } | null)?.fields ?? {};
  const rawProducts = (prods ?? []) as Product[];
  // ชั้นข้อมูล: ลูกค้าเห็นเฉพาะฟิลด์โปรไฟล์ที่ตั้งเป็นสาธารณะ และสินค้าโดยไม่มีหมายเหตุภายใน
  const ctx: CompanyContext = {
    profile: publicOnly ? publicProfile(rawProfile) : rawProfile,
    products: publicOnly ? publicProducts(rawProducts) : rawProducts,
    notes: Object.fromEntries(((notes ?? []) as { dept_id: string; body: string }[]).map((n) => [n.dept_id, n.body])),
  };
  if (!creds) return ctx;
  try {
    const { vectors, model } = await embedTexts([question], creds);
    // คนนอกเห็นเฉพาะเอกสารที่ผูกกับแผนกที่ตอบ (dept_filter) - เอกสาร "ทุกแผนก" ถือว่าภายใน
    const { data: hits } = await c.rpc('match_doc_chunks', {
      oid: officeId, query_embedding: vectors[0], model, dept_filter: deptIds, match_count: 8,
    });
    const rows = ((hits ?? []) as { doc_id: string; doc_name: string; seq: number; content: string; similarity: number }[])
      .filter((h) => h.similarity > 0.45);
    let allowed = rows;
    if (publicOnly && rows.length) {
      // ลูกค้าเห็นเฉพาะเอกสารที่ติดป้าย public ตอนอัปโหลด - ฐานเก่าที่ยังไม่มีคอลัมน์นี้ = ไม่มีอะไรสาธารณะ
      const { data: docs, error: dErr } = await c.from('office_doc').select('id,visibility').in('id', [...new Set(rows.map((r) => r.doc_id))]);
      const ok = new Set(dErr ? [] : ((docs ?? []) as { id: string; visibility?: string }[]).filter((d) => d.visibility === 'public').map((d) => d.id));
      allowed = rows.filter((r) => ok.has(r.doc_id));
    }
    ctx.chunks = allowed.map((h) => ({ docName: h.doc_name, seq: h.seq, content: h.content }));
  } catch {
    // ค้นเอกสารไม่ได้ (คีย์ทำ embedding ไม่ได้ / ยังไม่มีเอกสาร) - ตอบจากส่วนที่เหลือ
  }
  return ctx;
}

/** เตรียมทีมสำหรับโหมด/แผนกที่ให้ - ใช้ทั้งประชุมภายในและตอน PR escalate */
function pickTeam(staff: EmployeeRowLite[], deptIds: string[], ownerDeptId: string, mode: MeetingMode) {
  const heads = deptHeadIds(staff.map((s) => ({ id: s.id, deptId: s.dept_id })));
  const byRole = (a: EmployeeRowLite, b: EmployeeRowLite) =>
    ROLE_ORDER.indexOf(a.role as AgentRole) - ROLE_ORDER.indexOf(b.role as AgentRole);
  let picked: EmployeeRowLite[] = [];
  if (mode === 'direct') {
    const h = staff.find((s) => s.id === heads.get(ownerDeptId));
    picked = h ? [h] : [];
  } else {
    for (const d of [ownerDeptId, ...deptIds.filter((x) => x !== ownerDeptId)]) {
      picked.push(...staff.filter((s) => s.dept_id === d).sort(byRole));
    }
    picked = picked.slice(0, 12);
  }
  const agents: AskAgent[] = picked.map((s) => {
    const d = DEPT_BY_ID.get(s.dept_id);
    const role = s.role as AgentRole;
    return {
      id: s.id, name: s.name, role, deptId: s.dept_id,
      deptName: d?.nameTh ?? s.dept_id, lens: d?.lenses[role] ?? '',
      isHead: heads.get(s.dept_id) === s.id,
    };
  });
  const attendees: MeetingAttendeeLite[] = picked.map((s) => ({
    id: s.id, name: s.name, title: s.title, deptId: s.dept_id, palette: s.palette,
  }));
  const chair = agents.find((a) => a.deptId === ownerDeptId && a.isHead) ?? agents[0];
  return { agents, attendees, chair };
}

export async function runHeadless(input: HeadlessInput): Promise<HeadlessResult> {
  const c = sbAdmin();
  const question = input.question.trim();
  const audience: MeetingAudience = input.audience ?? (input.publicOnly ? 'customer' : 'internal');
  const customer = audience === 'customer';
  // ลูกค้าถามได้ทางเดียว: ตอบตรงกับแผนกที่รับลูกค้า (PR) - escalate เป็นประชุมภายในเกิดข้างในเอง
  const mode = customer ? 'direct' : normalizeMode(input.mode ?? 'roundtable');
  const creds = input.creds === undefined ? resolveCreds({}) : input.creds;
  const empty = (error: string): HeadlessResult => ({
    meetingId: null, answer: '', customerReply: '', minutes: '', transcript: [], chair: null, deptIds: [], mode,
    model: null, error, escalated: false,
  });
  if (!c) return empty('เซิร์ฟเวอร์ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY - เรียกประชุมจากภายนอกไม่ได้');
  if (!question) return empty('ไม่มีคำถาม');

  const staff = await loadOfficeStaff(input.officeId);
  if (!staff.length) return empty('ออฟฟิศนี้ยังไม่มีพนักงาน - จ้างก่อน');
  const hiredDeptIds = [...new Set(staff.map((s) => s.dept_id))];

  // เลือกแผนก: ระบุมาก็ใช้ (เฉพาะที่มีคน) ไม่ระบุให้เลขาฯ อ่านคำถาม / ลูกค้า = แผนกรับลูกค้าเสมอ
  let deptIds = (input.deptIds ?? []).filter((d) => hiredDeptIds.includes(d));
  let ownerDeptId = deptIds[0];
  if (customer) {
    const front = deptIds[0] ?? 'pr';
    if (!hiredDeptIds.includes(front)) return empty(`ยังไม่มีพนักงานแผนกรับลูกค้า (${front}) - จ้างก่อน`);
    deptIds = [front];
    ownerDeptId = front;
  } else if (!deptIds.length) {
    const agenda = await buildAgenda(question, hiredDeptIds, creds);
    deptIds = agenda.items.map((i) => i.deptId).filter((d) => hiredDeptIds.includes(d));
    if (!deptIds.length) deptIds = [hiredDeptIds[0]];
    ownerDeptId = hiredDeptIds.includes(agenda.ownerDeptId) ? agenda.ownerDeptId : deptIds[0];
  }

  const team = pickTeam(staff, deptIds, ownerDeptId, mode);
  if (!team.agents.length) return empty('ไม่มีใครในแผนกที่เลือก');
  const front = team.chair;

  const company = await loadCompany(input.officeId, question, deptIds, creds, customer);
  const askText = input.askedByLabel ? `${question}\n\n(ผู้ถาม: ${input.askedByLabel})` : question;

  const store = await persistMeeting({
    officeId: input.officeId, trusted: true, source: input.source, audience,
    question, mode, ownerDeptId, chairId: front.id, agents: team.agents, attendees: team.attendees,
  });

  const transcript: Opinion[] = [];
  let answer = '';
  let customerReply = '';
  let minutes = '';
  let model: string | null = null;
  let error: string | null = null;
  let escalated = false;
  let finalDeptIds = deptIds;

  /** ส่งต่อไป DB + เก็บผล - 'done' ของ engine ถูกกลืน เพราะ flow ลูกค้ามีขั้นต่อจากนั้น เราส่ง done เองตอนจบ */
  const send = (ev: AskEvent) => {
    if (ev.type === 'done') return;
    store?.push(ev);
    if (ev.type === 'opinion') {
      transcript.push({
        agentId: ev.agentId, agentName: ev.agentName, agentRole: ev.agentRole, deptId: ev.deptId,
        round: ev.round, step: ev.step, askedBy: ev.askedBy, text: ev.text, model: ev.model,
      });
    } else if (ev.type === 'final') {
      answer = ev.text; model = ev.model ?? null;
    } else if (ev.type === 'minutes' && ev.text) {
      minutes = ev.text;
    } else if (ev.type === 'error') {
      error = ev.message;
    }
  };
  const finish = async () => { store?.push({ type: 'done' }); await store?.flush(); };

  if (store) send(store.openEvent());
  try {
    if (!customer) {
      await runMeetingEngine({
        question: askText, mode, ownerDeptId, chairId: front.id, agents: team.agents, company, creds, assign: undefined,
      }, send);
      await finish();
      return {
        meetingId: store?.meetingId ?? null, answer, customerReply: '', minutes, transcript,
        chair: { id: front.id, name: front.name, deptId: front.deptId }, deptIds, mode, model, error, escalated: false,
      };
    }

    /* ---------- ลูกค้า: PR ตอบเอง หรือ escalate ไปปรึกษาทีม ---------- */
    let firstFinal = '';
    await runMeetingEngine({
      question: askText, mode: 'direct', ownerDeptId, chairId: front.id, agents: team.agents, company, creds, customer: true,
    }, (ev) => {
      // final ของรอบแรกอาจเป็น ESCALATE - ห้ามลง DB เป็น summary/เล่นบนจอ ตัดสินก่อน
      if (ev.type === 'final') { firstFinal = ev.text; model = ev.model ?? null; return; }
      send(ev);
    });

    // marker อาจโผล่กลางข้อความ (โมเดลเล็กไม่ทำตามรูปแบบเป๊ะ) - เจอที่ไหนก็ถือว่า escalate
    const esc = firstFinal.includes(ESCALATE_MARK);
    if (!esc || !creds) {
      // ตอบได้เลย - คำตอบนี้คือสิ่งที่ลูกค้าเห็น (PR ใช้แต่ข้อมูลสาธารณะและกติกาบริการลูกค้า)
      // กัน marker หลุด (กรณีไม่มี creds จริง ๆ)
      answer = firstFinal.replace(ESCALATE_MARK, '').trim();
      customerReply = answer;
      send({ type: 'final', text: answer, leadAgentId: front.id, leadAgentName: front.name, model: model ?? undefined });
      send({ type: 'customer_reply', agentId: front.id, agentName: front.name, text: customerReply, model: model ?? undefined });
      await finish();
      return {
        meetingId: store?.meetingId ?? null, answer, customerReply, minutes: '', transcript,
        chair: { id: front.id, name: front.name, deptId: front.deptId }, deptIds, mode, model, error, escalated: false,
      };
    }

    // ---- escalate: ข้อความหลัง marker (บรรทัดเดียวกัน) = คำถามที่จะไปถามทีม ----
    // ข้อความบอกลูกค้าให้รอ: หยิบบรรทัดสั้น ๆ ที่ไม่มี marker/คำอธิบาย ถ้าไม่มีใช้ข้อความมาตรฐาน
    // marker หรือ "สามารถใช้ข้อความดังนี้:" ต้องไม่หลุดถึงลูกค้าเด็ดขาด
    escalated = true;
    const at = firstFinal.indexOf(ESCALATE_MARK);
    const afterMark = firstFinal.slice(at + ESCALATE_MARK.length).split('\n')[0].trim();
    const internalQuestion = afterMark.replace(/^[\s:：-]+/, '') || question;
    const candidates = firstFinal
      .split('\n')
      .map((l) => l.replace(/\*\*/g, '').trim())
      .filter((l) => l && !l.includes(ESCALATE_MARK) && !/^-{3,}$/.test(l) && l.length <= 220
        && !/สามารถใช้ข้อความ|ดังนี้|ตัวอย่าง|ต่อไปนี้/.test(l));
    const holding = candidates.find((l) => /(สักครู่|รอ|เช็ค|ตรวจสอบ|ติดต่อกลับ)/.test(l))
      ?? 'ขอเช็คกับทีมสักครู่นะคะ เดี๋ยวตอบกลับค่ะ';

    // ทีมที่จะปรึกษา: เลขาฯ เลือกจากคำถามภายใน (ไม่นับแผนกรับลูกค้าเอง) + PR ถือคำถามไปถามแบบสายพาน
    const others = hiredDeptIds.filter((d) => d !== ownerDeptId);
    const agenda = await buildAgenda(internalQuestion, others, creds);
    let consult = agenda.items.map((i) => i.deptId).filter((d) => others.includes(d));
    if (!consult.length) consult = others.slice(0, 2);
    finalDeptIds = [ownerDeptId, ...consult];
    const meetTeam = pickTeam(staff, finalDeptIds, ownerDeptId, 'relay');
    // ทีมประชุมต้องมี PR เป็นเจ้าของเรื่อง (คนถือคำถาม) - pickTeam จัดให้อยู่แล้วเพราะ owner = แผนก PR
    send({
      type: 'escalate', agentId: front.id, agentName: front.name, text: holding, internalQuestion,
      agents: meetTeam.agents, attendees: meetTeam.attendees, chairId: front.id,
    });

    // ประชุมภายในแบบสายพาน: PR เดินไปถามทีละแผนก แล้วสรุปเอง (บทถกอยู่ในสมุด ลูกค้าไม่เห็น)
    const internalCompany = await loadCompany(input.officeId, internalQuestion, finalDeptIds, creds, false);
    await runMeetingEngine({
      question: `${internalQuestion}\n\n(บริบท: ลูกค้าถามเข้ามาว่า "${question}" - ${front.name} จาก${front.deptName}รับเรื่องมาปรึกษา)`,
      mode: 'relay', ownerDeptId, chairId: front.id, agents: meetTeam.agents, company: internalCompany, creds,
    }, send);

    // PR กรองผลประชุมเป็นคำตอบสำหรับลูกค้า
    if (answer) {
      store?.push({ type: 'working', agentId: front.id, agentName: front.name, task: 'answer', label: 'เรียบเรียงคำตอบให้ลูกค้า', model: model ?? undefined });
      try {
        customerReply = await customerRewrite(await skillTextOf(front.deptId), front, question, answer, creds, company);
      } catch (e) {
        customerReply = 'ขออภัยค่ะ ตอนนี้ยังสรุปคำตอบให้ไม่ได้ ทีมงานจะติดต่อกลับโดยเร็วนะคะ';
        error = e instanceof Error ? e.message : String(e);
      }
    } else {
      customerReply = 'ขออภัยค่ะ ทีมยังไม่สามารถให้คำตอบได้ในตอนนี้ เดี๋ยวติดต่อกลับนะคะ';
    }
    send({ type: 'customer_reply', agentId: front.id, agentName: front.name, text: customerReply, model: model ?? undefined });
    await finish();
    return {
      meetingId: store?.meetingId ?? null, answer, customerReply, minutes, transcript,
      chair: { id: front.id, name: front.name, deptId: front.deptId }, deptIds: finalDeptIds,
      mode: 'relay', model, error, escalated,
    };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    store?.push({ type: 'error', message: error });
    await store?.flush();
    return { ...empty(error), meetingId: store?.meetingId ?? null, escalated };
  }
}
