/**
 * ข้อมูลบริษัท - ชั้น "ข้อเท็จจริง" ที่วางทับ skill (ชั้น "วิธีคิด") ใน system prompt
 *
 * ไฟล์นี้ไม่แตะ Supabase และไม่แตะ LLM - เป็นแค่รูปทรงข้อมูล + ตัวประกอบข้อความ
 * จึง import ได้ทั้งฝั่ง client (ฟอร์มกรอก) และ server (route ที่ประกอบ prompt)
 */

import { DEPT_BY_ID } from './departments';

/* ---------- โปรไฟล์บริษัท ---------- */

export interface ProfileField {
  key: string;
  label: string;
  hint: string;
  /** ช่องยาว (textarea) หรือบรรทัดเดียว */
  long: boolean;
  /** เพดานตัวอักษร - กัน prompt บวม เพราะโปรไฟล์ถูกส่งไปทุกคอล */
  max: number;
  /** ลูกค้า/คนนอกเห็นได้ไหม - ค่าเริ่มต้นคือภายใน (ต้องตั้งใจเปิด) */
  public?: boolean;
}

/**
 * ฟิลด์มีโครง ไม่ใช่ช่องว่างเปล่า - จะได้ไม่ลืมมิติที่แผนกต้องใช้
 * เรียงจากที่ทุกแผนกต้องรู้ ไปหาที่เฉพาะทาง
 */
export const PROFILE_FIELDS: ProfileField[] = [
  { key: 'name', label: 'ชื่อบริษัท', hint: 'ชื่อที่ใช้จริงในเอกสาร', long: false, max: 120, public: true },
  { key: 'what', label: 'ทำอะไร', hint: 'อธิบายในหนึ่งย่อหน้าให้คนไม่รู้จักเข้าใจ - ธุรกิจอะไร ขายอะไร ให้ใคร', long: true, max: 600, public: true },
  { key: 'customers', label: 'ลูกค้าคือใคร', hint: 'กลุ่มลูกค้าหลัก B2B/B2C ขนาด อุตสาหกรรม', long: true, max: 400, public: true },
  { key: 'revenue', label: 'รายได้มาจากไหน', hint: 'โมเดลรายได้ - ขายขาด รายเดือน คอมมิชชัน ฯลฯ และสัดส่วนคร่าว ๆ', long: true, max: 400 },
  { key: 'size', label: 'ขนาดองค์กร', hint: 'พนักงานกี่คน สาขา/สำนักงาน ก่อตั้งปีไหน', long: false, max: 200 },
  { key: 'entity', label: 'รูปแบบนิติบุคคล', hint: 'บจก. / หจก. / บมจ. ทุนจดทะเบียน จด VAT ไหม - ฝ่ายกฎหมายกับการเงินใช้', long: false, max: 200 },
  { key: 'products', label: 'ภาพรวมสินค้า/บริการ', hint: 'สรุปสั้น ๆ ว่าขายอะไรเป็นหลัก - รายการแยกชิ้นพร้อมราคาไปกรอกที่แท็บ "สินค้า"', long: true, max: 500, public: true },
  { key: 'redlines', label: 'เส้นแดง - สิ่งที่บริษัทไม่ทำ', hint: 'ห้ามทำเด็ดขาด เช่น ไม่รับงานภาครัฐ ไม่ให้เครดิต ไม่ทำโฆษณาเปรียบเทียบ - ทุกแผนกจะยึดตามนี้ก่อน', long: true, max: 500 },
  { key: 'goals', label: 'เป้าหมายปีนี้', hint: 'ตัวเลขหรือเหตุการณ์ที่อยากไปให้ถึง', long: true, max: 400 },
  { key: 'problems', label: 'ปัญหาที่กำลังเจอ', hint: 'เรื่องที่กวนใจอยู่ตอนนี้ - agent จะได้ไม่เสนอทางที่ชนกับปัญหาเดิม', long: true, max: 400 },
  { key: 'tone', label: 'โทนการสื่อสาร', hint: 'ทางการ / เป็นกันเอง / ห้าม/ควรใช้คำแบบไหน - ฝ่ายประชาสัมพันธ์ใช้ตรง ๆ', long: false, max: 200, public: true },
  { key: 'contact', label: 'ช่องทางติดต่อ', hint: 'เว็บ อีเมล โทร ที่อยู่ - ประชาสัมพันธ์เอาไว้ตอบคนถาม', long: false, max: 300, public: true },
];

export type ProfileFields = Record<string, string>;

/* ---------- ชั้นข้อมูล: ภายใน vs สาธารณะ ----------
   คนที่คุยกับลูกค้า (PR โหมดบริการลูกค้า) ต้อง "ไม่เห็น" ของภายในตั้งแต่แรก ไม่ใช่เห็นแล้วห้ามพูด
   (prompt injection ดึงของที่โมเดลเห็นออกมาได้เสมอ) - กรองที่ชั้นข้อมูลก่อนประกอบ prompt */

/** โปรไฟล์เฉพาะฟิลด์ที่ตั้งเป็นสาธารณะ */
export function publicProfile(f: ProfileFields | null | undefined): ProfileFields {
  if (!f) return {};
  const keep = new Set(PROFILE_FIELDS.filter((p) => p.public).map((p) => p.key));
  return Object.fromEntries(Object.entries(f).filter(([k]) => keep.has(k)));
}

/** สินค้าเฉพาะส่วนที่ลูกค้าเห็นได้ - หมายเหตุ (ต้นทุน/มาร์จิน/สถานะ) เป็นภายในเสมอ */
export function publicProducts(ps: Product[] | null | undefined): Product[] {
  return (ps ?? []).map((p) => ({ ...p, note: '' }));
}

/** เพดานรวมทั้งโปรไฟล์ - โปรไฟล์ถูกส่งไปทุกคอล ประชุม 12 คน x 2 รอบ = 25 คอล */
export const PROFILE_MAX_TOTAL = 3200;
/** เพดานโน้ตต่อแผนก */
export const DEPT_NOTE_MAX = 1800;

export const profileLength = (f: ProfileFields) =>
  Object.values(f).reduce((n, v) => n + (v ?? '').length, 0);

/** โปรไฟล์ยังว่างอยู่ไหม - เอาไว้เตือนบนแถบบนว่ายังไม่ได้กรอก */
export const profileIsEmpty = (f: ProfileFields | null | undefined) =>
  !f || !PROFILE_FIELDS.some((p) => (f[p.key] ?? '').trim());

/* ---------- รายการสินค้า/บริการ ---------- */

/**
 * สินค้าเก็บเป็นรายการแยกชิ้น ไม่ใช่ย่อหน้าเดียวในโปรไฟล์
 * เพราะ agent ต้องอ้างชื่อกับราคาให้ถูกเป๊ะ (ขาย/การตลาด/การเงินใช้บ่อยสุด)
 * ราคาเป็นข้อความอิสระ - ของจริงมักเป็นช่วงหรือต่อหน่วย ไม่ใช่ตัวเลขเดียว
 */
export interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  note: string;
}

export const PRODUCT_LIMITS = { name: 80, description: 300, price: 80, note: 200 } as const;
export const PRODUCT_LABELS: Record<keyof typeof PRODUCT_LIMITS, string> = {
  name: 'ชื่อ', description: 'รายละเอียด', price: 'ราคา', note: 'หมายเหตุ',
};
/** เพดานจำนวนรายการ - ทุกชิ้นถูกส่งไปทุกคอล */
export const PRODUCT_MAX_COUNT = 30;

export const emptyProduct = (id: string): Product => ({ id, name: '', description: '', price: '', note: '' });

/** รายการที่กรอกไม่ครบหรือยาวเกิน - เอาไว้กันกดบันทึก */
export function productIssue(p: Product): string | null {
  if (!p.name.trim()) return 'ยังไม่ได้ตั้งชื่อ';
  for (const k of Object.keys(PRODUCT_LIMITS) as (keyof typeof PRODUCT_LIMITS)[]) {
    if ((p[k] ?? '').length > PRODUCT_LIMITS[k]) return `${PRODUCT_LABELS[k]}ยาวเกิน ${PRODUCT_LIMITS[k]} ตัวอักษร`;
  }
  return null;
}

/* ---------- หัวข้อแนะนำสำหรับโน้ตแผนก ---------- */

export const DEPT_NOTE_HINTS: Record<string, string> = {
  legal: 'สัญญาแม่แบบที่ใช้อยู่ · ใบอนุญาตที่ถือ · คดี/ข้อพิพาทที่ค้าง · ที่ปรึกษากฎหมายภายนอก · เรื่องที่เคยโดนแล้วไม่อยากซ้ำ',
  finance: 'งบต่อเดือนคร่าว ๆ · รอบบัญชี/ปิดงบเมื่อไร · เงินสดตึงช่วงไหน · นโยบายอนุมัติงบ (ใครเซ็นได้ถึงเท่าไร) · เจ้าหนี้/ลูกหนี้หลัก',
  engineering: 'ระบบที่ใช้อยู่ (stack, hosting) · หนี้เทคนิคที่รู้อยู่ · ทีมมีกี่คน ทำอะไรได้ · สิ่งที่ห้าม deploy ช่วงไหน',
  people: 'จำนวนคนต่อแผนก · โครงสร้างเงินเดือน/สวัสดิการคร่าว ๆ · นโยบายลา/WFH · ปัญหาคนที่เจอบ่อย · วิธีรับคนเข้าที่ผ่านมา',
  marketing: 'ช่องทางที่ใช้และได้ผล · งบต่อเดือน · แคมเปญที่เคยพัง · คู่แข่งหลัก · กลุ่มเป้าหมายที่ตอบสนองดี',
  pr: 'จุดยืนแบรนด์ในหนึ่งประโยค · ใครเป็นโฆษก · ช่องทางทางการ · เรื่องที่เคยเป็นข่าว/ดราม่า · คำที่ห้ามใช้ · คำถามที่คนถามบ่อยและคำตอบมาตรฐาน',
};

/* ---------- ประกอบเป็นข้อความสำหรับ prompt ---------- */

export interface CompanyContext {
  profile: ProfileFields;
  /** รายการสินค้า/บริการ - ทุกแผนกเห็นเหมือนกัน */
  products?: Product[];
  /** deptId -> body */
  notes: Record<string, string>;
  /** ชิ้นเอกสารที่ค้นเจอว่าเกี่ยวกับคำถามนี้ (เฟส 3) */
  chunks?: { docName: string; seq: number; content: string }[];
}

/** ส่วนโปรไฟล์ - ทุกแผนกได้เหมือนกัน */
export function profileBlock(profile: ProfileFields | null | undefined): string {
  if (!profile) return '';
  const rows = PROFILE_FIELDS
    .map((f) => ({ f, v: (profile[f.key] ?? '').trim() }))
    .filter(({ v }) => v);
  if (!rows.length) return '';
  return `## ข้อมูลบริษัท (ข้อเท็จจริง - ยึดตามนี้ก่อนความรู้ทั่วไป)

${rows.map(({ f, v }) => `**${f.label}:** ${v}`).join('\n')}`;
}

/** ส่วนรายการสินค้า - ทุกแผนกได้เหมือนกัน เรียงตามที่ผู้ใช้จัดไว้ */
export function productsBlock(products: Product[] | null | undefined): string {
  const rows = (products ?? []).filter((p) => p.name.trim());
  if (!rows.length) return '';
  const line = (p: Product) => {
    const parts = [`**${p.name.trim()}**`];
    if (p.price.trim()) parts.push(`ราคา ${p.price.trim()}`);
    if (p.description.trim()) parts.push(p.description.trim());
    if (p.note.trim()) parts.push(`(${p.note.trim()})`);
    return `- ${parts.join(' - ')}`;
  };
  return `## สินค้า/บริการของบริษัท (${rows.length} รายการ - อ้างชื่อและราคาตามนี้ ห้ามแต่งเพิ่ม)

${rows.map(line).join('\n')}`;
}

/** ส่วนโน้ตแผนก - เฉพาะแผนกตัวเอง */
export function deptNoteBlock(deptId: string, notes: Record<string, string> | null | undefined): string {
  const body = (notes?.[deptId] ?? '').trim();
  if (!body) return '';
  const d = DEPT_BY_ID.get(deptId);
  return `## ข้อมูลภายในของ${d?.nameTh ?? deptId} (เฉพาะแผนกคุณ)

${body}`;
}

/** ส่วนเอกสารอ้างอิง - ชิ้นที่ค้นเจอ พร้อมบอกที่มาให้ agent cite ได้ */
export function chunksBlock(chunks: CompanyContext['chunks']): string {
  if (!chunks?.length) return '';
  return `## เอกสารอ้างอิงที่เกี่ยวกับคำถามนี้ (ค้นจากคลังเอกสารบริษัท)

${chunks.map((c, i) => `[อ้างอิง ${i + 1}] จาก "${c.docName}" ส่วนที่ ${c.seq + 1}\n${c.content.trim()}`).join('\n\n')}

ถ้าใช้ข้อมูลจากเอกสาร ให้ระบุ [อ้างอิง N] กำกับ ถ้าเอกสารขัดกับความรู้ทั่วไป ให้ถือเอกสารเป็นหลักแต่บอกด้วยว่าขัดกัน`;
}

/**
 * รวมทุกชั้นสำหรับ agent หนึ่งตัว
 * เรียงลำดับ: โปรไฟล์ (ทุกคนเห็น) -> สินค้า (ทุกคนเห็น) -> โน้ตแผนก (เฉพาะแผนก) -> เอกสาร (เฉพาะที่ค้นเจอ)
 * คืนสตริงว่างถ้าไม่มีอะไรเลย - route จะได้ข้ามได้โดยไม่ต้องเช็คซ้ำ
 */
export function companyBlock(ctx: CompanyContext | null | undefined, deptId: string): string {
  if (!ctx) return '';
  return [profileBlock(ctx.profile), productsBlock(ctx.products), deptNoteBlock(deptId, ctx.notes), chunksBlock(ctx.chunks)]
    .filter(Boolean)
    .join('\n\n');
}

/** ตัวเลขไว้โชว์ใน proof ว่า agent ได้ข้อมูลบริษัทไปเท่าไร */
export function companyStats(ctx: CompanyContext | null | undefined, deptId: string) {
  return {
    profileChars: profileBlock(ctx?.profile).length,
    productCount: (ctx?.products ?? []).filter((p) => p.name.trim()).length,
    noteChars: deptNoteBlock(deptId, ctx?.notes).length,
    chunkCount: ctx?.chunks?.length ?? 0,
  };
}
