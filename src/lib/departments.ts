/* ============================================================
   บทบาทในทีม - นี่คือกลไกที่ทำให้ agent จากโมเดลเดียวกัน "เห็นต่างจริง"
   ไม่ได้ใช้บุคลิก (สไตล์) แต่ใช้ "หน้าที่ที่ขัดกันโดยโครงสร้าง"
   แต่ละบทบาทถูกประเมินคนละเกณฑ์ จึงเดินไปคนละคำตอบตั้งแต่ต้น
   (Opus 5 ไม่รับ temperature/top_p - ความหลากหลายต้องมาจาก prompt ล้วน ๆ)
   ============================================================ */
export type AgentRole = 'proposer' | 'challenger' | 'verifier' | 'pragmatist';

export interface RoleSpec {
  th: string;
  /** หน้าที่ - ใส่ใน system prompt */
  mandate: string;
  /** คำสั่งเฉพาะรอบแรก */
  round1: string;
  /** คำสั่งเฉพาะรอบแย้ง */
  round2: string;
  /** บทบาทที่ต้องขุดลึกกว่าใช้ effort สูงกว่า */
  effort: 'low' | 'medium';
}

export const ROLES: Record<AgentRole, RoleSpec> = {
  proposer: {
    th: 'ผู้เสนอ',
    mandate:
      'หน้าที่ของคุณคือ **หาทางที่เดินหน้าได้** คุณถูกประเมินจากการที่ข้อเสนอของคุณเอาไปทำได้จริง\n' +
      'คุณ **ห้ามตอบว่า "อย่าทำ" หรือ "ควรปรึกษาผู้เชี่ยวชาญ" เป็นข้อสรุป** - ถ้าเรื่องนี้เสี่ยง\n' +
      'หน้าที่คุณคือเสนอวิธีคุมความเสี่ยงให้เดินต่อได้ ไม่ใช่เสนอให้หยุด',
    round1: 'เสนอทางที่ทำได้จริงหนึ่งทาง พร้อมขั้นตอนแรกที่ลงมือได้ภายในสัปดาห์นี้',
    round2:
      'ผู้ค้านจะพยายามยิงข้อเสนอคุณให้ตก - ตอบข้อค้านที่หนักที่สุดตรง ๆ\n' +
      'ถ้าข้อค้านนั้นถูกจริง ให้แก้ข้อเสนอ อย่าปกป้องของเดิมเฉย ๆ',
    effort: 'low',
  },
  challenger: {
    th: 'ผู้ค้าน',
    mandate:
      'หน้าที่ของคุณคือ **หาว่าข้อเสนอจะพังตรงไหน** คุณถูกประเมินจากจำนวนจุดพังที่คนอื่นมองข้าม\n' +
      'ไม่ใช่จากการที่ทีมลงรอยกัน คุณ **ห้ามลงท้ายว่าเห็นด้วยกับทุกคน** - ถ้าคุณหาข้อค้านไม่ได้เลย\n' +
      'แปลว่าคุณยังขุดไม่ลึกพอ ให้กลับไปหาใหม่ในมุมกรณีเลวร้ายที่สุด',
    round1:
      'บอกว่าถ้าทำเรื่องนี้แบบตรงไปตรงมา มันจะพังยังไงได้บ้าง อย่างน้อย 2 ทาง\n' +
      'ระบุด้วยว่าพังแล้วเสียหายแค่ไหน และกู้คืนได้ไหม',
    round2:
      'ยิงข้อเสนอของผู้เสนอให้ตรงจุดที่สุด 1 จุด - จุดที่ถ้าผิดแล้วทั้งแผนพัง\n' +
      'ห้ามยกข้อค้านทั่วไปที่ใช้ได้กับทุกเรื่อง',
    effort: 'medium',
  },
  verifier: {
    th: 'ผู้ตรวจสอบ',
    mandate:
      'หน้าที่ของคุณคือ **แยกข้อเท็จจริงออกจากสมมติฐาน** คุณไม่เข้าข้างใคร\n' +
      'คุณถูกประเมินจากการจับได้ว่าข้ออ้างไหนในห้องนี้ยังไม่มีอะไรรองรับ\n' +
      'รวมถึงข้ออ้างของคุณเองด้วย',
    round1:
      'ระบุว่าคำถามนี้ต้องรู้อะไรก่อนถึงจะตอบได้จริง อะไรที่เรารู้แน่ อะไรที่กำลังเดา\n' +
      'และคำตอบจะพลิกถ้าข้อไหนเปลี่ยน',
    round2:
      'ชี้ข้ออ้างที่ผู้เสนอหรือผู้ค้านพูดออกมาโดยยังไม่มีหลักฐานรองรับ อย่างน้อย 1 ข้อ\n' +
      'แล้วบอกว่าต้องไปหาอะไรมายืนยัน',
    effort: 'low',
  },
  pragmatist: {
    th: 'ผู้ดูความเป็นไปได้',
    mandate:
      'หน้าที่ของคุณคือดูว่า **ทำจริงได้ไหมด้วยคนและเวลาที่มี** คุณถูกประเมินจากการประเมินต้นทุน\n' +
      'ที่แม่นกว่าคนอื่นในห้อง ข้อเสนอที่ถูกต้องแต่ทำไม่ไหว ในมุมคุณคือข้อเสนอที่ใช้ไม่ได้',
    round1: 'ประเมินว่าเรื่องนี้กินเวลา คน และเงินเท่าไร และอะไรจะทำให้บานปลาย',
    round2: 'บอกว่าข้อเสนอที่คุยกันอยู่ ข้อไหนแพงหรือช้าเกินกว่าที่คนเสนอคิด',
    effort: 'low',
  },
};

/** ลำดับการจ้าง: คนที่ 1 เป็นผู้เสนอ คนที่ 2 เป็นผู้ค้าน ฯลฯ */
export const ROLE_ORDER: AgentRole[] = ['proposer', 'challenger', 'verifier', 'pragmatist'];

/** ข้อมูลแผนก - ใช้ร่วมกันทั้งฝั่ง client (สีเสื้อ/ปุ่มจ้าง) และ server (เลือก skill.md) */
export interface Department {
  id: string;
  nameTh: string;
  shortTh: string;
  /** สีประจำแผนก - ใช้เป็นสีเสื้อพนักงานด้วย จะได้แยกออกบนแผนที่ */
  color: string;
  /** ไฟล์ skills/<skill>.md ที่ agent ต้อง "เรียน" ก่อนเริ่มงาน */
  skill: string;
  /** คำที่ใช้ route คำถามอัตโนมัติ */
  keywords: string[];
  /** มุมมองเฉพาะสาขา ผูกกับบทบาทตามลำดับ ROLE_ORDER - ทำให้บทบาทเดียวกันในคนละแผนกไม่พูดเหมือนกัน */
  lenses: Record<AgentRole, string>;
  /** หน้าที่ของแผนก (ภาษาคน) - แผนกที่ผู้ใช้สร้างเอง ใช้เป็นต้นทางให้ AI ร่างสกิล/มุมมอง และให้เลขาฯ route คำถาม */
  description?: string;
  /** สกิลแบบ inline (markdown) - แผนกที่สร้างเอง หรือทับสกิลของ preset; ไม่มี = อ่าน skills/<skill>.md */
  skillText?: string;
  /** สิ่งที่แผนกต้องทำเมื่อมีข้อมูลยิงเข้ามาทาง inbox (webhook) เช่น "จัดระดับความรุนแรง ถ้า high แจ้ง Teams ทันที" */
  playbook?: string;
  /** แถวจากออฟฟิศ (DB/localStorage) - แก้/ลบได้ ต่างจาก preset ที่ฝังในโค้ด */
  custom?: boolean;
}

/**
 * นิยามแผนกที่ส่งข้ามเครือข่ายได้ (เบราว์เซอร์ -> API, DB -> เซิร์ฟเวอร์) - ไม่มีฟิลด์ที่ผูกกับไฟล์ในเครื่อง
 * แผนกที่ผู้ใช้สร้างเองมีหน้าตาแบบนี้ทั้งตัว ส่วน preset ส่งเฉพาะที่ถูกทับ (เช่น skillText)
 */
export interface DepartmentDef {
  id: string;
  nameTh: string;
  shortTh: string;
  color: string;
  description?: string;
  keywords?: string[];
  lenses?: Partial<Record<AgentRole, string>>;
  skillText?: string;
  playbook?: string;
}

/** 6 แผนกมาตรฐานที่ฝังมากับโค้ด - ออฟฟิศเพิ่มแผนกของตัวเองทับ/ต่อจากชุดนี้ได้ (ดู mergeDepartments) */
export const PRESET_DEPARTMENTS: Department[] = [
  {
    id: 'legal',
    nameTh: 'ฝ่ายกฎหมาย',
    shortTh: 'กฎหมาย',
    color: '#9a5fc0',
    skill: 'legal',
    keywords: [
      'กฎหมาย', 'สัญญา', 'ข้อตกลง', 'ฟ้อง', 'คดี', 'ลิขสิทธิ์', 'เครื่องหมายการค้า',
      'pdpa', 'ข้อมูลส่วนบุคคล', 'ใบอนุญาต', 'นิติกรรม', 'ละเมิด', 'ความรับผิด',
      'legal', 'contract', 'license', 'compliance', 'nda',
    ],
    lenses: {
      proposer: 'โครงสร้างสัญญาหรือเงื่อนไขที่ทำให้เรื่องนี้เดินได้ภายใต้กฎหมายไทย',
      challenger: 'ความเสี่ยงถูกฟ้อง ถูกปรับ หรือเสียสิทธิ์ และกรณีเลวร้ายที่สุดที่เกิดขึ้นได้',
      verifier: 'ข้ออ้างทางกฎหมายที่ยังไม่มีฐานรองรับ และข้อเท็จจริงที่ยังขาดในสำนวน',
      pragmatist: 'เวลา เอกสาร และคู่สัญญาที่ต้องประสานจริงก่อนเรื่องจะเดินได้',
    },
  },
  {
    id: 'finance',
    nameTh: 'ฝ่ายการเงิน',
    shortTh: 'การเงิน',
    color: '#3fa06a',
    skill: 'finance',
    keywords: [
      'การเงิน', 'งบ', 'ต้นทุน', 'กำไร', 'ขาดทุน', 'ภาษี', 'กระแสเงินสด', 'ราคา',
      'ลงทุน', 'ระดมทุน', 'บัญชี', 'roi', 'budget', 'finance', 'cost', 'pricing', 'tax',
    ],
    lenses: {
      proposer: 'โครงสร้างต้นทุนหรือราคาที่ทำให้ตัวเลขนี้เวิร์ก',
      challenger: 'จุดที่เงินสดจะขาดมือ และสมมติฐานรายได้ที่มองโลกสวยเกินไป',
      verifier: 'ตัวเลขไหนเป็นข้อมูลจริง ตัวเลขไหนเป็นการประมาณ และช่วงความคลาดเคลื่อน',
      pragmatist: 'ภาระงานบัญชี ภาษี และรอบเวลาปิดงบที่ต้องแบกเพิ่ม',
    },
  },
  {
    id: 'engineering',
    nameTh: 'ฝ่ายวิศวกรรม',
    shortTh: 'วิศวกรรม',
    color: '#4a7fd0',
    skill: 'engineering',
    keywords: [
      'ระบบ', 'โค้ด', 'สถาปัตยกรรม', 'ดาต้าเบส', 'ฐานข้อมูล', 'api', 'deploy', 'บั๊ก',
      'performance', 'สเกล', 'เซิร์ฟเวอร์', 'เทคนิค', 'architecture', 'database',
      'code', 'infra', 'security', 'ความปลอดภัย',
    ],
    lenses: {
      proposer: 'ทางที่ส่งของได้เร็วที่สุดโดยยังไม่ก่อหนี้ทางเทคนิคที่กู้ไม่ไหว',
      challenger: 'failure mode ตอนโหลดสูง ข้อมูลหาย และช่องโหว่ด้านความปลอดภัย',
      verifier: 'สมมติฐานเรื่องปริมาณ ทราฟฟิก และ dependency ที่ยังไม่ได้วัดจริง',
      pragmatist: 'ขนาดงานจริงเป็นสัปดาห์ และสิ่งที่มักทำให้ประมาณการบานปลาย',
    },
  },
  {
    id: 'people',
    nameTh: 'ฝ่ายบุคคล',
    shortTh: 'บุคคล',
    color: '#e0a13f',
    skill: 'people',
    keywords: [
      'พนักงาน', 'ลาออก', 'จ้าง', 'สัมภาษณ์', 'เงินเดือน', 'สวัสดิการ', 'ทีม',
      'วัฒนธรรม', 'ประเมิน', 'ลา', 'hr', 'hiring', 'culture', 'onboarding', 'payroll',
    ],
    lenses: {
      proposer: 'กระบวนการหรือบทสนทนาที่ทำให้เรื่องนี้จบได้โดยคนยังอยู่ต่อ',
      challenger: 'ผลกระทบต่อขวัญกำลังใจของทีมที่เหลือ และความเสี่ยงด้านกฎหมายแรงงาน',
      verifier: 'ข้อกล่าวหาหรือคำบอกเล่าที่ยังฟังความข้างเดียว และหลักฐานที่ยังขาด',
      pragmatist: 'เวลาที่หัวหน้าต้องลงแรงจริง และต้นทุนการหาคนแทน',
    },
  },
  {
    id: 'marketing',
    nameTh: 'ฝ่ายการตลาด',
    shortTh: 'การตลาด',
    color: '#e07aa8',
    skill: 'marketing',
    keywords: [
      'การตลาด', 'ลูกค้า', 'แบรนด์', 'โฆษณา', 'แคมเปญ', 'ยอดขาย', 'คอนเทนต์',
      'โซเชียล', 'ตำแหน่งสินค้า', 'marketing', 'brand', 'campaign', 'growth', 'seo',
    ],
    lenses: {
      proposer: 'ข้อความและช่องทางที่ทดสอบได้เร็วด้วยงบน้อยที่สุด',
      challenger: 'ทางที่แคมเปญนี้จะทำให้แบรนด์เสียหาย หรือเงินหมดไปโดยไม่ได้ลูกค้า',
      verifier: 'ข้ออ้างเรื่องตลาดและพฤติกรรมลูกค้าที่ยังไม่มีข้อมูลรองรับ',
      pragmatist: 'กำลังคนทำคอนเทนต์จริง และเวลาที่กว่าจะเห็นผล',
    },
  },
  {
    // ประชาสัมพันธ์นั่งเคาน์เตอร์กลางล็อบบี้ ไม่มีห้องแถวล่าง - ดู PR_SEATS ใน game/map.ts
    id: 'pr',
    nameTh: 'ฝ่ายประชาสัมพันธ์',
    shortTh: 'ประชาสัมพันธ์',
    color: '#5cbcc8',
    skill: 'pr',
    keywords: [
      'ประชาสัมพันธ์', 'แถลง', 'ประกาศ', 'สื่อ', 'ข่าว', 'ภาพลักษณ์', 'ชื่อเสียง', 'ดราม่า',
      'ร้องเรียน', 'ตอบลูกค้า', 'สื่อสารภายใน', 'บริษัททำอะไร', 'ติดต่อ', 'pr', 'press',
      'statement', 'announcement', 'reputation', 'crisis',
    ],
    lenses: {
      proposer: 'ข้อความที่พูดออกไปแล้วบริษัทดูน่าเชื่อถือขึ้น ไม่ใช่แค่ไม่เสียหาย',
      challenger: 'ประโยคไหนที่คนโกรธที่สุดจะหยิบไปตีความ และข่าวจะพาดหัวว่าอะไร',
      verifier: 'ข้ออ้างในข้อความที่บริษัทยังยืนยันไม่ได้ และตัวเลขที่ต้องให้แผนกอื่นรับรองก่อน',
      pragmatist: 'ใครต้องอนุมัติก่อนปล่อย ช่องทางไหน และปล่อยเมื่อไรถึงจะทันแต่ไม่พลาด',
    },
  },
];

export const PRESET_BY_ID = new Map(PRESET_DEPARTMENTS.map((d) => [d.id, d]));

/* ============================================================
   ทะเบียนแผนก "ที่ใช้อยู่" (ฝั่งเบราว์เซอร์)
   DEPARTMENTS / DEPT_BY_ID เป็น live binding - หน้าเว็บโหลดแผนกของออฟฟิศแล้วเรียก setActiveDepartments()
   ทุก component ที่อ้าง DEPARTMENTS/DEPT_BY_ID จะเห็นชุดใหม่ทันทีโดยไม่ต้องแก้ (array/Map ตัวเดิม เปลี่ยนแค่ข้างใน)
   ฝั่งเซิร์ฟเวอร์ห้ามพึ่งสองตัวนี้ (หลายออฟฟิศพร้อมกัน) - ใช้ deptMap(custom) ต่อคำขอแทน
   ============================================================ */
export const DEPARTMENTS: Department[] = [...PRESET_DEPARTMENTS];
export const DEPT_BY_ID = new Map<string, Department>(PRESET_DEPARTMENTS.map((d) => [d.id, d]));

const LENS_FALLBACK = (d: DepartmentDef): Record<AgentRole, string> => {
  const what = d.description?.trim() || d.nameTh;
  return {
    proposer: `ทางที่ทำให้เรื่องนี้เดินหน้าได้จริงในมุมของ${d.nameTh} (${what})`,
    challenger: `จุดที่เรื่องนี้จะพังหรือย้อนกลับมาทำร้าย${d.nameTh}`,
    verifier: `ข้ออ้างที่ยังไม่มีข้อมูลรองรับในมุมของ${d.nameTh}`,
    pragmatist: `แรง เวลา และต้นทุนที่${d.nameTh}ต้องแบกจริงถ้าทำเรื่องนี้`,
  };
};

/** ประกอบ Department เต็มตัวจากนิยามที่ส่งมา - preset id เดิม = ทับเฉพาะฟิลด์ที่ให้มา, id ใหม่ = แผนกใหม่ */
export function toDepartment(def: DepartmentDef): Department {
  const base = PRESET_BY_ID.get(def.id);
  const lenses = { ...(base?.lenses ?? LENS_FALLBACK(def)), ...(def.lenses ?? {}) } as Record<AgentRole, string>;
  return {
    id: def.id,
    nameTh: def.nameTh || base?.nameTh || def.id,
    shortTh: def.shortTh || base?.shortTh || def.nameTh || def.id,
    color: def.color || base?.color || '#8a8f98',
    skill: base?.skill ?? def.id,
    keywords: def.keywords?.length ? def.keywords : (base?.keywords ?? []),
    lenses,
    ...(def.description ? { description: def.description } : {}),
    ...(def.skillText ? { skillText: def.skillText } : {}),
    ...(def.playbook ? { playbook: def.playbook } : {}),
    custom: true,
  };
}

/** preset ทั้งหมด + แผนกของออฟฟิศ (id ซ้ำ preset = ทับ, id ใหม่ = ต่อท้าย) - ลำดับคงที่ทุกครั้ง */
export function mergeDepartments(custom: DepartmentDef[] = []): Department[] {
  const byId = new Map<string, Department>(PRESET_DEPARTMENTS.map((d) => [d.id, d]));
  const extra: Department[] = [];
  for (const def of custom) {
    if (!def?.id) continue;
    const d = toDepartment(def);
    if (byId.has(def.id)) byId.set(def.id, d); else { byId.set(def.id, d); extra.push(d); }
  }
  return [...PRESET_DEPARTMENTS.map((p) => byId.get(p.id)!), ...extra];
}

/** ต่อคำขอฝั่งเซิร์ฟเวอร์ - แผนที่ id -> แผนก โดยไม่แตะทะเบียนกลาง */
export function deptMap(custom: DepartmentDef[] = []): Map<string, Department> {
  return new Map(mergeDepartments(custom).map((d) => [d.id, d]));
}

/** หน้าเว็บโหลดแผนกของออฟฟิศแล้วเรียก - เปลี่ยนเนื้อใน DEPARTMENTS/DEPT_BY_ID ให้ทุก component เห็นชุดเดียวกัน */
export function setActiveDepartments(custom: DepartmentDef[] = []): Department[] {
  const list = mergeDepartments(custom);
  DEPARTMENTS.splice(0, DEPARTMENTS.length, ...list);
  DEPT_BY_ID.clear();
  for (const d of list) DEPT_BY_ID.set(d.id, d);
  return list;
}

/** ตัด Department เหลือเฉพาะส่วนที่ต้องส่งข้ามเครือข่าย (เฉพาะแผนก custom/ที่ถูกทับ) */
export function customDefs(list: Department[] = DEPARTMENTS): DepartmentDef[] {
  return list.filter((d) => d.custom).map((d) => ({
    id: d.id, nameTh: d.nameTh, shortTh: d.shortTh, color: d.color,
    ...(d.description ? { description: d.description } : {}),
    keywords: d.keywords, lenses: d.lenses,
    ...(d.skillText ? { skillText: d.skillText } : {}),
    ...(d.playbook ? { playbook: d.playbook } : {}),
  }));
}

export const DEPT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
export const MAX_SKILL_CHARS = 20_000;
export const MAX_PLAYBOOK_CHARS = 4_000;
/** ทำชื่อให้เป็น id: อังกฤษ/ตัวเลข/ขีด เท่านั้น - ชื่อไทยล้วนได้ dept-<เลข> ให้ผู้ใช้แก้ */
export function slugifyDeptId(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return DEPT_ID_RE.test(s) ? s : '';
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** ตรวจ/ล้างนิยามแผนกจากข้างนอก (body/DB) - คืน null ถ้าใช้ไม่ได้ */
export function sanitizeDeptDef(raw: unknown): DepartmentDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 32).toLowerCase();
  if (!DEPT_ID_RE.test(id)) return null;
  const nameTh = str(o.nameTh, 60);
  if (!nameTh && !PRESET_BY_ID.has(id)) return null;
  const lensesIn = (o.lenses && typeof o.lenses === 'object' ? o.lenses : {}) as Record<string, unknown>;
  const lenses: Partial<Record<AgentRole, string>> = {};
  for (const r of ROLE_ORDER) { const v = str(lensesIn[r], 300); if (v) lenses[r] = v; }
  const keywords = Array.isArray(o.keywords) ? o.keywords.map((k) => str(k, 40)).filter(Boolean).slice(0, 40) : [];
  const color = /^#[0-9a-f]{6}$/i.test(str(o.color, 7)) ? str(o.color, 7) : '';
  const def: DepartmentDef = { id, nameTh, shortTh: str(o.shortTh, 20) || nameTh, color };
  const description = str(o.description, 1_000);
  const skillText = str(o.skillText, MAX_SKILL_CHARS);
  const playbook = str(o.playbook, MAX_PLAYBOOK_CHARS);
  if (description) def.description = description;
  if (keywords.length) def.keywords = keywords;
  if (Object.keys(lenses).length) def.lenses = lenses;
  if (skillText) def.skillText = skillText;
  if (playbook) def.playbook = playbook;
  return def;
}
export function sanitizeDeptDefs(raw: unknown): DepartmentDef[] {
  return Array.isArray(raw) ? raw.map(sanitizeDeptDef).filter((d): d is DepartmentDef => !!d).slice(0, 40) : [];
}

/** เลือกแผนกจากคำถามแบบง่าย ๆ (นับคำที่ตรง) - ผู้ใช้เลือกเองทับได้ */
export function routeDepartment(question: string, availableIds: string[], depts: Department[] = DEPARTMENTS): string | null {
  const q = question.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const d of depts) {
    if (!availableIds.includes(d.id)) continue;
    let score = 0;
    for (const kw of d.keywords) if (q.includes(kw.toLowerCase())) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { id: d.id, score };
  }
  return best?.id ?? availableIds[0] ?? null;
}
