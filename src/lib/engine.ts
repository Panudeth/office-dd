import { ROLES, deptMap, type DepartmentDef } from '@/lib/departments';
import { SECRETARY_NAME } from '@/game/map';
import { ask, byokCreds, effectiveModel, type Creds } from '@/lib/llm';
import { loadSkillFor, type LoadedSkill } from '@/lib/skills';
import { companyBlock, companyStats, type CompanyContext } from '@/lib/company';
import {
  MAX_ATTENDEES, type AskAgent, type AskEvent, type LlmAssignment, type MeetingMode, type SkillFile,
  type WorkTask,
} from '@/lib/protocol';

/* ============================================================
   Engine ของการประชุม - ไม่รู้จัก HTTP ไม่รู้จัก DB
   รับคำถาม + ผู้เข้าประชุม + คีย์ แล้วยิง event ออกทาง send() ตามลำดับที่เกิดจริง
   ใครจะเอา event ไปทำอะไร (SSE ให้เบราว์เซอร์ / เขียนลง DB ให้ทุกจอ / ตอบกลับ LINE) เป็นเรื่องของคนเรียก
   ============================================================ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ความเห็นหนึ่งก้อนที่เอาไปวางใน prompt ของคนถัดไป */
interface Said {
  name: string;
  roleTh: string;
  deptName: string;
  text: string;
}

const asSaid = (a: AskAgent, text: string): Said => ({
  name: a.name,
  roleTh: ROLES[a.role].th,
  deptName: a.deptName,
  text,
});

const dumpSaid = (rows: Said[]) =>
  rows.map((o) => `### ${o.name} (${o.roleTh} - ${o.deptName})\n${o.text}`).join('\n\n');

/**
 * system prompt ของ agent หนึ่งตัว =
 *   skill.md ของ "แผนกตัวเอง"  +  หน้าที่ตามบทบาท  +  มุมมองเฉพาะแผนก
 *
 * ประชุมข้ามแผนกใช้ skill คนละไฟล์กัน คนของกฎหมายอ่าน legal.md คนของบัญชีอ่าน finance.md
 * ถ้าให้ทุกคนอ่านไฟล์เดียวกัน ความต่างระหว่างแผนกจะหายไปทันที
 */
function agentSystem(skill: string, a: AskAgent, roomNote: string, company?: CompanyContext): string {
  const role = ROLES[a.role];
  // ชั้นข้อเท็จจริงของบริษัทวางต่อจาก skill - skill บอกวิธีคิด ข้อมูลบริษัทบอกว่าคิดกับอะไร
  const facts = companyBlock(company, a.deptId, a.deptName);
  return `${skill}
${facts ? `\n---\n\n${facts}\n` : ''}
---

## บทบาทของคุณในห้องประชุมนี้

คุณคือ **${a.name}** ทำหน้าที่ **${role.th}** ของ${a.deptName}

${role.mandate}

มุมที่คุณต้องมองเป็นหลัก: ${a.lens}

## กติกาห้องประชุม

${roomNote}
- พูดจากมุมของ${a.deptName}ให้สุด แม้จะรู้ว่าแผนกอื่นจะไม่ชอบ
- ห้ามพยายามหาข้อสรุปร่วมกันเอง หน้าที่สรุปเป็นของประธาน ไม่ใช่ของคุณ
- คุณ **ไม่ใช่ผู้เชี่ยวชาญของแผนกอื่น** เรื่องที่อยู่นอกความรับผิดชอบของคุณ
  ให้บอกว่าต้องให้แผนกไหนตอบ อย่าเดาแทนเขา`;
}

const ROOM_CROSS =
  '- ในห้องนี้มีคนจาก **หลายแผนก** แต่ละแผนกเรียนคนละสกิลและถูกประเมินคนละเกณฑ์\n' +
  '- ทีมที่เห็นตรงกันหมดตั้งแต่รอบแรก คือทีมที่ยังไม่มีใครทำงาน';

const ROOM_SAME =
  '- คุณกำลังนั่งกับเพื่อนร่วมทีมที่เรียนสกิลเดียวกัน แต่ **ถูกประเมินคนละเกณฑ์กับคุณ**\n' +
  '- ทีมที่เห็นตรงกันหมดตั้งแต่รอบแรก คือทีมที่ยังไม่มีใครทำงาน';

/* ============================================================
   โหมดโต๊ะกลม - ทุกแผนกนั่งพร้อมกัน
   ============================================================ */

function round1(skill: string, a: AskAgent, question: string, room: string, creds: Creds, company?: CompanyContext) {
  const role = ROLES[a.role];
  return ask({
    system: agentSystem(skill, a, room, company),
    user: `หัวหน้าถามเข้ามาว่า:

"""
${question}
"""

รอบแรก - คุณยังไม่เห็นความเห็นของใคร พูดจากหน้าที่ ${role.th} ของ${a.deptName}เท่านั้น

${role.round1}

เขียนไม่เกิน 6 บรรทัด ห้ามเกริ่นนำ ห้ามทวนคำถาม เริ่มที่เนื้อเลย
ห้ามเขียนคำตอบแบบรอบด้านที่ครอบคลุมทุกมุม - นั่นเป็นงานของทั้งห้องรวมกัน ไม่ใช่ของคุณคนเดียว`,
    maxTokens: 6000,
    effort: role.effort,
  }, creds);
}

function round2(
  skill: string, a: AskAgent, question: string, others: Said[], room: string, creds: Creds,
  company?: CompanyContext,
) {
  const role = ROLES[a.role];
  return ask({
    system: agentSystem(skill, a, room, company),
    user: `คำถามเดิม:

"""
${question}
"""

ตอนนี้คุณได้ยินคนอื่นในห้องพูดแล้ว:

${dumpSaid(others)}

รอบสอง - ${role.round2}

ตอบตามรูปแบบนี้เป๊ะ ๆ (3 บรรทัด ขึ้นต้นด้วยคำเหล่านี้):

ค้าน: <ระบุชื่อคนและข้อที่คุณไม่เห็นด้วย พร้อมเหตุผล - บังคับต้องมี อย่างน้อย 1 ข้อ>
ตกหล่น: <สิ่งที่ทั้งห้องยังไม่มีใครพูดถึง>
จุดยืน: <จุดยืนสุดท้ายของคุณหลังฟังทุกคน>

กติกาเข้ม:
- **ห้ามเขียนว่า "เห็นด้วยกับทุกคน" หรือ "ไม่มีข้อค้าน"** ถ้าคุณหาข้อค้านไม่เจอ แปลว่ายังอ่านไม่ละเอียดพอ
- ถ้ามีคนจากแผนกอื่นพูดเรื่องที่ทับกับงานของคุณและพูดผิด **ให้ค้านตรงนั้นก่อน**
- ถ้าคุณจะเปลี่ยนจุดยืนตามคนอื่น ต้องระบุว่า **ข้อเท็จจริงหรือหลักฐานอะไร** ทำให้เปลี่ยน
- ค้านให้ตรงตัวบุคคลและตรงข้อ ห้ามค้านลอย ๆ ที่ใช้ได้กับทุกเรื่อง`,
    maxTokens: 6000,
    effort: role.effort,
  }, creds);
}

/**
 * สรุปโดย "ประธาน" - เป็นบทบาทที่แยกจากผู้ถก
 * ประธานถูกสั่งห้ามเกลี่ยให้ทุกคนถูก เพราะการเกลี่ยคือวิธีที่คำตอบจะกลายเป็นน้ำ
 */
function synthesize(
  skill: string, chair: AskAgent, question: string, deptNames: string[],
  r1: Said[], r2: Said[], creds: Creds, company?: CompanyContext,
) {
  const dump = [
    '## รอบแรก (ต่างคนต่างพูด)', dumpSaid(r1),
    '', '## รอบสอง (หลังได้ยินกัน)', dumpSaid(r2),
  ].join('\n\n');

  return ask({
    system: `${skill}
${companyBlock(company, chair.deptId) ? `\n---\n\n${companyBlock(company, chair.deptId)}\n` : ''}
---

## บทบาทของคุณ

ตอนนี้คุณคือ **ประธานที่ประชุม** - ไม่ใช่ผู้ถก
ในห้องมีคนจาก ${deptNames.join(' / ')} คุณเพิ่งฟังทุกคนเถียงกันสองรอบ
และกำลังจะเดินไปสรุปให้หัวหน้าบริษัทฟัง

หน้าที่ของคุณคือ **ตัดสิน** ไม่ใช่รวบรวม:
- ถ้าสองแผนกขัดกัน ให้บอกว่าฝั่งไหนมีน้ำหนักกว่าและเพราะอะไร
- **ห้ามเกลี่ยให้ทุกแผนกถูก** และห้ามเขียนข้อสรุปแบบกว้าง ๆ ที่ไม่ได้เลือกอะไรเลย
- ถ้าตัดสินไม่ได้จริงเพราะข้อมูลไม่พอ ให้บอกตรง ๆ ว่าต้องรู้อะไรก่อน
- ข้อค้านที่ยังไม่มีใครตอบได้ ต้องขึ้นมาอยู่ในคำตอบ ห้ามกลบ`,
    user: `คำถามของหัวหน้า:

"""
${question}
"""

บันทึกการประชุม:

${dump}

สรุปให้หัวหน้าฟัง ตามโครงนี้ (ใช้หัวข้อตามนี้เป๊ะ):

**สรุป** - ตอบตรง ๆ 2-3 บรรทัด ว่าควรทำอะไร (ต้องเลือกข้าง ห้ามตอบว่า "ขึ้นอยู่กับ")
**เหตุผล** - 2-3 ข้อสั้น ๆ
**ข้อค้านที่ยังค้างอยู่** - ข้อที่ยังไม่มีใครตอบได้ ถ้าถูกตอบครบแล้วให้เขียนว่า "ตอบครบแล้ว"
**แต่ละแผนกเห็นต่างตรงไหน** - ระบุชื่อแผนกและจุดที่ยังไม่ลงรอย ถ้าลงรอยกันจริงให้เขียนว่า "ทุกแผนกเห็นตรงกัน"
**ต้องการจากหัวหน้า** - ข้อมูลหรือการตัดสินใจที่ยังขาด ถ้าไม่มีให้ตัดหัวข้อนี้ทิ้ง

ห้ามเกริ่นนำ เริ่มที่ **สรุป** ทันที`,
    maxTokens: 12000,
    effort: 'medium',
  }, creds);
}

/* ============================================================
   โหมดสายพาน - เจ้าของเรื่องถือคำถามไว้ เดินไปถามทีละแผนก
   ============================================================ */

/** เจ้าของเรื่องตั้งคำถามเฉพาะเจาะจงให้อีกแผนก - ไม่ใช่ส่งคำถามเดิมต่อดิบ ๆ */
function relayAsk(
  skill: string, owner: AskAgent, question: string, target: AskAgent,
  gathered: { deptName: string; text: string }[], creds: Creds, company?: CompanyContext,
) {
  const sofar = gathered.length
    ? `\n\nสิ่งที่คุณได้มาจากแผนกก่อนหน้าแล้ว:\n\n${gathered
        .map((g) => `### ${g.deptName}\n${g.text}`)
        .join('\n\n')}`
    : '';

  return ask({
    system: agentSystem(skill, owner, ROOM_CROSS, company),
    user: `หัวหน้ามอบเรื่องนี้ให้${owner.deptName}เป็นเจ้าของเรื่อง:

"""
${question}
"""${sofar}

ตอนนี้คุณกำลังจะเดินไปหา **${target.name}** จาก${target.deptName}

เขียน **คำถามที่คุณจะถามเขา** - ไม่ใช่ส่งคำถามของหัวหน้าต่อไปดิบ ๆ
ถามเฉพาะสิ่งที่ **${target.deptName}เท่านั้นที่ตอบได้** และที่คุณต้องรู้จริง ๆ
เพื่อเอามาทำงานของ${owner.deptName}ต่อ

ถ้าได้ข้อมูลจากแผนกก่อนหน้ามาแล้ว ให้ใช้มันตั้งคำถามที่เจาะกว่าเดิม

เขียนไม่เกิน 4 บรรทัด เป็นคำถามล้วน ๆ ห้ามเกริ่นนำ ห้ามอธิบายว่าทำไมถึงถาม`,
    maxTokens: 2000,
    effort: 'low',
  }, creds);
}

/** แผนกที่ถูกถามตอบกลับ - ตอบเฉพาะที่ถูกถาม ไม่ใช่ตอบคำถามใหญ่ของหัวหน้า */
function relayAnswer(
  skill: string, a: AskAgent, bigQuestion: string, asked: string, owner: AskAgent, creds: Creds,
  company?: CompanyContext,
) {
  return ask({
    system: agentSystem(skill, a, ROOM_CROSS, company),
    user: `บริบท - หัวหน้าถามบริษัทว่า:

"""
${bigQuestion}
"""

เรื่องนี้${owner.deptName}เป็นเจ้าของเรื่อง และ **${owner.name}** เดินมาถามคุณว่า:

"""
${asked}
"""

ตอบคำถามของเขาในฐานะ${a.deptName}

กติกา:
- ตอบ **เฉพาะที่เขาถาม** ไม่ต้องไปตอบคำถามใหญ่ของหัวหน้าแทนเขา
- ระบุให้ชัดว่าอะไรคือข้อกำหนดที่ต้องทำแน่ ๆ อะไรคือข้อควรระวัง
- ถ้ามีตัวเลข เงื่อนไข หรือขั้นตอนที่เป็นของแผนกคุณโดยตรง ให้ใส่มาเลย
- ถ้าคำถามของเขามีสมมติฐานที่ผิด **ให้แก้ให้เขาก่อน** แล้วค่อยตอบ
- ถ้าเรื่องนี้เกินขอบเขตของ${a.deptName} ให้บอกว่าต้องไปถามแผนกไหนต่อ

เขียนไม่เกิน 8 บรรทัด ห้ามเกริ่นนำ`,
    maxTokens: 6000,
    effort: ROLES[a.role].effort,
  }, creds);
}

/** เจ้าของเรื่องสรุปเอง - ต่างจากโต๊ะกลมตรงที่คนสรุปคือคนที่เดินไปถามมาเองทั้งสาย */
function relaySummary(
  skill: string, owner: AskAgent, question: string,
  steps: { deptName: string; asked: string; text: string }[], creds: Creds, company?: CompanyContext,
) {
  const dump = steps
    .map((s, i) => `## ทอดที่ ${i + 1} - ${s.deptName}\n\n**คุณถามว่า:** ${s.asked}\n\n**เขาตอบว่า:**\n${s.text}`)
    .join('\n\n');

  return ask({
    system: `${skill}
${companyBlock(company, owner.deptId) ? `\n---\n\n${companyBlock(company, owner.deptId)}\n` : ''}
---

## บทบาทของคุณ

คุณคือ **${owner.name}** จาก${owner.deptName} และคุณเป็น **เจ้าของเรื่องนี้**
คุณเพิ่งเดินไปถามแผนกอื่นมาครบทุกแผนกด้วยตัวเอง และกำลังจะไปรายงานหัวหน้า

หน้าที่ของคุณคือ **ประกอบคำตอบเป็นแผนเดียว** ไม่ใช่เอาคำตอบของแต่ละแผนกมาเรียงต่อกัน:
- ถ้าแผนกหนึ่งบอกว่าทำได้ อีกแผนกบอกว่ามีเงื่อนไข ต้องรวมเป็นขั้นตอนเดียวที่ทำตามได้จริง
- ข้อกำหนดที่แผนกอื่นบอกว่าเป็นเรื่องบังคับ **ห้ามตัดทิ้ง** แม้จะทำให้แผนดูยุ่งขึ้น
- ถ้าคำตอบของสองแผนกขัดกัน ให้บอกตรง ๆ ว่าขัดกันตรงไหน อย่ากลบ`,
    user: `คำถามของหัวหน้า:

"""
${question}
"""

บันทึกที่คุณเดินไปเก็บมา:

${dump}

รายงานหัวหน้า ตามโครงนี้ (ใช้หัวข้อตามนี้เป๊ะ):

**สรุป** - ตอบตรง ๆ 2-3 บรรทัด ว่าทำได้หรือไม่ได้ และต้องทำอะไร
**ขั้นตอน** - ลำดับที่ต้องทำจริง เรียง 1-2-3 ระบุด้วยว่าขั้นไหนเป็นของแผนกไหน
**ข้อกำหนดที่ห้ามพลาด** - เงื่อนไขบังคับที่แต่ละแผนกยืนยันมา ระบุชื่อแผนกกำกับ
**จุดที่แต่ละแผนกให้ข้อมูลขัดกัน** - ถ้าไม่มีให้เขียนว่า "ไม่มี"
**ต้องการจากหัวหน้า** - ข้อมูลหรือการตัดสินใจที่ยังขาด ถ้าไม่มีให้ตัดหัวข้อนี้ทิ้ง

ห้ามเกริ่นนำ เริ่มที่ **สรุป** ทันที`,
    maxTokens: 12000,
    effort: 'medium',
  }, creds);
}

/* ============================================================
   โหมดตอบตรง - คำถามข้อเท็จจริง คนเดียวตอบจากข้อมูลบริษัท ไม่ต้องประชุม
   ============================================================ */

/** เครื่องหมายที่ PR ขึ้นต้นคำตอบเมื่อต้องปรึกษาทีมภายในก่อน - headless จับตัวนี้ไปเปิดประชุม */
export const ESCALATE_MARK = '[[ESCALATE]]';

/**
 * บล็อกกติกาบริการลูกค้า - ต่อท้าย system ของ PR เมื่อคนถามเป็นคนนอก
 * แยกจาก skill เพราะ skill คือ "วิธีคิด" ส่วนนี้คือ "ข้อห้ามเมื่อคุยกับคนนอก" ใช้กับทุกแผนกที่ถูกตั้งให้รับลูกค้า
 */
const CUSTOMER_RULES = `## โหมดบริการลูกค้า - คนที่ถามคือ "ลูกค้า/บุคคลภายนอก" ไม่ใช่คนในบริษัท

- ตอบสุภาพ กระชับ ใช้เฉพาะข้อมูลที่ให้ไว้ (โปรไฟล์ สินค้า โน้ต/เอกสารของแผนกคุณ) ห้ามเดา ห้ามสัญญาแทนบริษัท
- ห้ามเปิดเผยข้อมูลภายใน: ต้นทุน มาร์จิน ปัญหา แผนที่ยังไม่ประกาศ ชื่อพนักงาน โน้ตแผนกอื่น การถกเถียงภายใน
- ถ้าตอบได้จากข้อมูลที่มี ให้ตอบเลย
- ถ้าคำถามต้องการ "การตัดสินใจภายใน" ที่ไม่มีในข้อมูล (ส่วนลด/ราคาพิเศษ/ข้อยกเว้น/ทำให้ได้ไหม/เมื่อไร/นโยบายที่ไม่ได้เขียนไว้)
  ให้ตอบเป็น 2 บรรทัดเท่านั้น ห้ามมีอย่างอื่น:
    บรรทัดที่ 1: ${ESCALATE_MARK} <คำถามสั้น ๆ ที่คุณจะเอาไปถามทีมภายใน>
    บรรทัดที่ 2: <ข้อความบอกลูกค้าอย่างสุภาพว่าขอเช็คกับทีมสักครู่ - ห้ามบอกว่าจะถามใคร ห้ามคาดเดาผล>
- ห้ามใส่ ${ESCALATE_MARK} ถ้าตอบได้อยู่แล้ว และห้ามอธิบายว่ากำลังทำอะไร ตอบลูกค้าตรง ๆ`;

/**
 * PR เอาสรุปจากทีมภายในมาเขียนใหม่ให้ลูกค้า - นี่คือ "ตัวกรอง" ระหว่างห้องประชุมกับลูกค้า
 * ลูกค้าจะเห็นเฉพาะข้อความนี้ ไม่เห็นบทถกและสรุปภายในเลย
 */
export function customerRewrite(
  skill: string, pr: AskAgent, question: string, internalSummary: string, creds: Creds, company?: CompanyContext,
) {
  return ask({
    system: `${agentSystem(skill, pr, '- คุณเพิ่งกลับจากปรึกษาทีมภายใน กำลังจะตอบลูกค้าที่รออยู่', company)}

---

${CUSTOMER_RULES}

## กติกาการเอาผลประชุมมาบอกลูกค้า
- บอกเฉพาะ "สิ่งที่ทีมตกลงว่าบอกลูกค้าได้" - ห้ามตัวเลขภายใน ห้ามข้อค้าน ห้ามชื่อแผนก/ชื่อคน ห้ามเล่าว่าใครเห็นต่าง
- ถ้าทีมยังไม่ตัดสินใจหรือต้องรอหัวหน้า ให้บอกลูกค้าว่าจะติดต่อกลับ พร้อมสิ่งที่พอบอกได้ตอนนี้ - ห้ามแต่งคำตอบขึ้นเอง
- ห้ามระบุกรอบเวลา ("ภายในสัปดาห์นี้") ส่วนลด ข้อเสนอ หรือเอกสารใด ๆ ที่ทีมไม่ได้บอกไว้ในสรุป - พูดเกินสรุปคือสัญญาแทนบริษัท
- โทนสุภาพ เป็นมิตร ไม่เกิน 8 บรรทัด ไม่มีหัวข้อตัวหนา ไม่เกริ่นว่า "จากการประชุม" ไม่ขึ้นต้นด้วย "เรียน"`,
    user: `ลูกค้าถามว่า:

"""
${question}
"""

สรุปจากทีมภายใน (ห้ามส่งต่อตรง ๆ - เอาไปกรองแล้วเขียนใหม่):

"""
${internalSummary}
"""

เขียนข้อความตอบลูกค้า`,
    maxTokens: 3000,
    effort: 'low',
  }, creds);
}

function directAnswer(
  skill: string, a: AskAgent, question: string, creds: Creds, company?: CompanyContext, customer = false,
) {
  const room = customer
    ? `- ไม่มีการประชุม คุณตอบลูกค้าคนเดียวจากข้อมูลบริษัทที่มี\n\n${CUSTOMER_RULES}`
    : '- ไม่มีการประชุม คุณตอบคนเดียวจากข้อมูลบริษัทที่มี';
  return ask({
    system: agentSystem(skill, a, room, company),
    user: `${customer ? 'ลูกค้าถามว่า' : 'หัวหน้าถามว่า'}:

"""
${question}
"""

ตอบตรง ๆ จาก **ข้อมูลบริษัท** ที่ให้ไว้ ถ้าเป็นการขอให้ร่างข้อความ ให้ร่างจริงพร้อมใช้
ถ้าข้อมูลบริษัทไม่มีเรื่องที่ถาม ให้บอกว่าไม่มีในข้อมูล และแนะนำว่าควรกรอกเพิ่มที่หัวข้อไหน
ห้ามเดาข้อเท็จจริงเรื่องบริษัทที่ไม่ได้ให้มา
ถ้าเรื่องนี้ควรเข้าประชุมมากกว่าตอบตรง (มีความเสี่ยง ต้องตัดสินใจ) ให้บอกว่าควรตั้งเป็นวาระประชุม

ห้ามเกริ่นนำ เริ่มที่คำตอบทันที`,
    maxTokens: 6000,
    effort: 'low',
  }, creds);
}

/* ---------- โหมดสาธิต: ไม่มี API key ก็ยังเล่นดู animation ได้ ---------- */

function mockText(a: AskAgent, round: number) {
  const role = ROLES[a.role];
  if (round === 1) {
    return `[โหมดสาธิต] ในฐานะ${role.th}ของ${a.deptName} ผมมองเรื่องนี้จากมุม: ${a.lens}\n(ใส่ API key เพื่อให้ agent ตอบจริง)`;
  }
  return `ค้าน: [โหมดสาธิต] ผมไม่เห็นด้วยกับข้อเสนอที่เร็วที่สุด เพราะยังไม่ได้ประเมินความเสี่ยง\nตกหล่น: ยังไม่มีใครพูดถึงต้นทุนเวลาจริง\nจุดยืน: เดินหน้าได้แต่ต้องมีเงื่อนไขกำกับ`;
}

const mockAsk = (owner: AskAgent, t: AskAgent) =>
  `[โหมดสาธิต] ${owner.deptName}ขอถาม${t.deptName}ว่าเรื่องนี้ติดข้อกำหนดอะไรบ้าง และต้องเตรียมอะไรก่อน`;

/* ============================================================
   เลขาฯ จดรายงานการประชุม - คนละหน้าที่กับประธาน
   ประธาน "ตัดสิน" จากมุมของแผนกตัวเอง เลขาฯ "จดให้เป็นกลาง" ว่าใครพูดอะไร มติคืออะไร ค้างอะไร
   ใช้โมเดลถูก ๆ ได้ เพราะไม่ต้องคิด แค่เรียบเรียงตามโครง
   ============================================================ */
function writeMinutes(
  question: string, agents: AskAgent[], dump: string, final: string, chairName: string, creds: Creds,
) {
  const who = agents.map((a) => `${a.name} (${ROLES[a.role].th} - ${a.deptName})`).join(', ');
  return ask({
    system: `คุณคือ **${SECRETARY_NAME}** เลขานุการของบริษัท นั่งจดอยู่ในห้องประชุม
หน้าที่ของคุณคือเขียน "รายงานการประชุม" ให้เป็นกลางและครบถ้วน - คุณไม่ตัดสิน ไม่เพิ่มความเห็นตัวเอง
บันทึกให้คนที่ไม่ได้อยู่ในห้องอ่านแล้วรู้ว่าเกิดอะไรขึ้น ใครยืนยันอะไร และตกลงกันว่าอย่างไร
เขียนภาษาไทย กระชับ เป็นข้อ ๆ`,
    user: `วาระ: "${question}"
ผู้เข้าประชุม: ${who}
ประธาน/ผู้สรุป: ${chairName}

บันทึกดิบจากห้องประชุม:

${dump}

คำสรุปของประธานที่รายงานหัวหน้า:

${final}

เขียนรายงานการประชุมตามโครงนี้ (ใช้หัวข้อตามนี้เป๊ะ ไม่ต้องเกริ่น):

**ประเด็นจากแต่ละแผนก** - แผนกละ 1-2 บรรทัด ระบุชื่อแผนก ว่ายืนยันอะไร
**ข้อค้านที่ยกขึ้นมา** - ใครค้านใครเรื่องอะไร และถูกตอบหรือยัง (ถ้าไม่มีให้เขียน "ไม่มี")
**มติ** - สิ่งที่ประธานตัดสิน 1-3 บรรทัด ตามที่ประธานสรุป ห้ามแต่งเพิ่ม
**สิ่งที่ต้องทำต่อ / รอหัวหน้าตัดสิน** - ถ้าไม่มีให้เขียน "ไม่มี"`,
    maxTokens: 4000,
    effort: 'low',
  }, creds);
}

const mockAnswer = (a: AskAgent) =>
  `[โหมดสาธิต] ${a.deptName}ตอบว่าเรื่องนี้มีเงื่อนไขที่ต้องทำก่อน และมีจุดที่ต้องระวัง\n(ใส่ API key เพื่อให้ agent ตอบจริง)`;

function mockFinal(question: string) {
  return `**สรุป**\n[โหมดสาธิต] ยังไม่มี API key ระบบจึงตอบด้วยข้อความตัวอย่างแทนคำตอบจริงของ agent\n\n**เหตุผล**\n- ทีมเดินเข้าประชุมและถกครบทุกรอบตามปกติแล้ว (ดูได้จาก animation)\n- เหลือแค่ใส่คีย์เพื่อให้เนื้อหาเป็นของจริง\n\n**ข้อค้านที่ยังค้างอยู่**\n- ตอบครบแล้ว\n\n**แต่ละแผนกเห็นต่างตรงไหน**\n- โหมดสาธิตไม่ได้ถกจริง\n\n**ต้องการจากหัวหน้า**\n- กดปุ่ม คีย์ของฉัน บนแถบบน แล้วใส่คีย์ (คำถามที่ถามมา: "${question.slice(0, 50)}")`;
}


/* ============================================================ */

export interface EngineInput {
  question: string;
  mode: MeetingMode;
  ownerDeptId: string;
  /** ประธาน/คนสรุป - ไม่ส่งมาใช้หัวหน้าของแผนกเจ้าของเรื่อง */
  chairId?: string;
  agents: AskAgent[];
  company?: CompanyContext;
  /** ชุดคีย์เริ่มต้น - null คือโหมดสาธิต */
  creds: Creds | null;
  /** โมเดลต่อคน/ต่อบทบาท */
  assign?: LlmAssignment;
  /** คนถามเป็นลูกค้า (โหมดตอบตรง) - ใช้กติกาบริการลูกค้า และอาจขึ้น ESCALATE_MARK ให้คนเรียกเปิดประชุมต่อ */
  customer?: boolean;
  /** แผนกที่ออฟฟิศสร้างเอง/ทับ preset - ไม่ส่งมาใช้ preset ล้วน */
  departments?: DepartmentDef[];
}

/** โหลด skill ของแผนก (ให้ headless ใช้ตอน PR เขียนคำตอบให้ลูกค้า) */
export async function skillTextOf(deptId: string, custom: DepartmentDef[] = []): Promise<string> {
  const d = deptMap(custom).get(deptId);
  if (!d) return '';
  return (await loadSkillFor(d)).text;
}

/** ตัดคำขอให้อยู่ในกรอบ - ใช้ทั้ง route และ headless */
export function normalizeMode(m: unknown): MeetingMode {
  return m === 'relay' ? 'relay' : m === 'direct' ? 'direct' : 'roundtable';
}

export async function runMeetingEngine(input: EngineInput, send: (ev: AskEvent) => void): Promise<void> {
  const agents = input.agents.slice(0, MAX_ATTENDEES);
  const question = input.question.trim();
  const mode = input.mode;
  const company = input.company;
  const creds = input.creds;
  const deptIds = [...new Set(agents.map((a) => a.deptId))];
  const ownerDeptId = deptIds.includes(input.ownerDeptId) ? input.ownerDeptId : deptIds[0];
  const depts = deptMap(input.departments);

  /**
   * โมเดลต่อคน/ต่อบทบาท - ชุดคีย์เพิ่มเติมมาใน body เพราะมีได้หลายชุดพร้อมกัน
   * ใช้เฉพาะคำขอนี้เหมือน header ไม่เก็บ ไม่ log และไม่ส่งกลับ
   * ชุดที่กรอกไม่ครบ (byokCreds คืน null) ถือว่าไม่มี แล้วถอยไปชุดถัดไปตามลำดับ
   */
  const assign: LlmAssignment | undefined = input.assign;
  const conns = new Map<string, Creds>();
  for (const [id, c] of Object.entries(assign?.conns ?? {})) {
    const cr = byokCreds(c);
    if (cr) conns.set(id, cr);
  }
  const pick = (id?: string | null) => (id ? conns.get(id) ?? null : null);
  /**
   * โมเดลของคนนี้ - รายคนชนะเสมอ ถัดมาหัวหน้าแผนกได้ค่า "หัวหน้าแผนก" (ทุกรอบ ไม่ใช่แค่ตอนสรุป)
   * ที่เหลือใช้ค่าลูกทีม แล้วค่อยถอยไปชุดเริ่มต้นจาก header
   */
  const credsOf = (a: AskAgent): Creds | null =>
    pick(assign?.byAgent?.[a.id]) ?? (a.isHead ? pick(assign?.chair) : null) ?? pick(assign?.member) ?? creds;
  /** เลขาฯ: ตั้ง 'off' = ไม่จด, ไม่ตั้ง = ค่าลูกทีม -> ค่าเริ่มต้น */
  const secretaryCreds: Creds | null =
    assign?.secretary === 'off' ? null : pick(assign?.secretary) ?? pick(assign?.member) ?? creds;

  // ชื่อโมเดลจริงต่อชุดคีย์ - ปลายทางในเครื่องต้องไปถามก่อน ถามครั้งเดียวพอ
  const modelCache = new Map<Creds, Promise<string>>();
  const modelOf = (c: Creds | null): Promise<string> => {
    if (!c) return Promise.resolve('โหมดสาธิต');
    let p = modelCache.get(c);
    if (!p) { p = effectiveModel(c); modelCache.set(c, p); }
    return p;
  };


      const roleTh = (a: AskAgent) => ROLES[a.role].th;
      /** บอกหน้าเว็บว่าใครกำลังเริ่มคิดอะไร - ยิงก่อนเรียก LLM ทุกครั้ง จะได้เห็นว่าใครช้า */
      const working = async (a: { id: string; name: string }, task: WorkTask, label: string, c: Creds | null) =>
        send({ type: 'working', agentId: a.id, agentName: a.name, task, label, model: await modelOf(c) });
      /** เลขาฯ จดหลัง final - พังก็ข้าม ไม่ให้รายงานการประชุมมาทำให้คำตอบหลักล้ม */
      const minutes = async (dump: string, final: string, chairName: string) => {
        if (!secretaryCreds || !final) return;
        send({ type: 'phase', phase: 'synthesis', label: `${SECRETARY_NAME} กำลังจดรายงานการประชุม` });
        await working({ id: 'secretary', name: SECRETARY_NAME }, 'minutes', 'จดรายงานการประชุม', secretaryCreds);
        try {
          const text = await writeMinutes(question, agents, dump, final, chairName, secretaryCreds);
          send({ type: 'minutes', text, model: await modelOf(secretaryCreds) });
        } catch (e) {
          // ไม่มีรายงานก็ยังมีคำตอบของประธานอยู่ - แต่ต้องบอก ไม่งั้นผู้ใช้คิดว่าเลขาฯ ลืมจด
          send({ type: 'minutes', text: '', model: await modelOf(secretaryCreds), error: e instanceof Error ? e.message : String(e) });
        }
      };

      try {
        // แต่ละแผนกอ่านสกิลของตัวเอง - โหลดทีเดียวแล้วแจกตาม deptId
        const skills = new Map<string, LoadedSkill>();
        await Promise.all(
          deptIds.map(async (id) => {
            const d = depts.get(id);
            if (d) skills.set(id, await loadSkillFor(d));
          }),
        );
        const skillOf = (a: AskAgent) => skills.get(a.deptId)?.text ?? '';
        const room = deptIds.length > 1 ? ROOM_CROSS : ROOM_SAME;

        const files: SkillFile[] = deptIds.map((id) => {
          const s = skills.get(id);
          const d = depts.get(id);
          return {
            deptId: id,
            deptName: d?.nameTh ?? agents.find((a) => a.deptId === id)?.deptName ?? id,
            file: s?.file ?? '',
            bytes: s?.bytes ?? 0,
            missing: s?.missing ?? true,
          };
        });

        // ประธานที่ประชุม = คนที่ผู้ใช้เลือกในหน้าวาระ (ต้องเป็นคนที่อยู่ในห้องจริง)
        // ไม่ได้เลือกมา -> หัวหน้าของแผนกเจ้าของเรื่อง -> ใครก็ได้ในแผนกนั้น
        const ownerPool = agents.filter((a) => a.deptId === ownerDeptId);
        const chair = agents.find((a) => a.id === input.chairId)
          ?? ownerPool.find((a) => a.isHead)
          ?? ownerPool[0]
          ?? agents[0];
        const chairC = credsOf(chair);

        // ส่งหลักฐานให้ผู้ใช้ตรวจได้ว่า skill ถูกอ่านและประกอบเป็น system prompt จริง
        // และใครใช้โมเดลไหน - mixed-model จะได้ตรวจได้ว่าตั้งแล้วมีผลจริง
        const agentModels = await Promise.all(
          agents.map(async (a) => {
            const c = credsOf(a);
            return { agentId: a.id, agentName: a.name, model: await modelOf(c), provider: c?.provider ?? 'mock' };
          }),
        );
        send({
          type: 'skill',
          proof: {
            files,
            systemPrompt: agentSystem(skillOf(agents[0]), agents[0], room, company),
            company: companyStats(company, agents[0].deptId),
            agentName: agents[0].name,
            model: await modelOf(chairC),
            provider: chairC?.provider ?? 'mock',
            agentModels,
          },
        });

        if (mode === 'direct') {
          /* ---------- ตอบตรง ---------- */
          const who = chair;
          const c = chairC;
          send({ type: 'phase', phase: 'direct', label: `${who.name} ตอบจากข้อมูลบริษัท` });
          await working(who, 'direct', 'ตอบจากข้อมูลบริษัท', c);
          const text = c
            ? await directAnswer(skillOf(who), who, question, c, company, !!input.customer)
            : (await sleep(1200), `[โหมดสาธิต] ${who.deptName}ตอบจากข้อมูลบริษัท (ใส่ API key เพื่อให้ตอบจริง)`);
          send({ type: 'final', text, leadAgentId: who.id, leadAgentName: who.name, model: await modelOf(c) });
          send({ type: 'done' });
          return;
        }

        if (mode === 'relay') {
          /* ---------- สายพาน ---------- */
          const owner = chair;
          const ownerC = chairC;
          // แผนกอื่นส่งตัวแทนแผนกละคน - สายพานคุยกันทีละคน ไม่ใช่ประชุม
          const targets = deptIds
            .filter((id) => id !== owner.deptId)
            .map((id) => agents.find((a) => a.deptId === id))
            .filter((a): a is AskAgent => !!a);

          const steps: { deptName: string; asked: string; text: string }[] = [];

          for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            const step = i + 1;
            send({ type: 'phase', phase: 'consult', label: `${owner.name} ไปถาม${t.deptName}` });
            await working(owner, 'ask', `คิดคำถามให้${t.deptName}`, ownerC);

            const asked = ownerC
              ? await relayAsk(skillOf(owner), owner, question, t, steps, ownerC, company)
              : (await sleep(1200), mockAsk(owner, t));
            send({
              type: 'consult',
              step,
              fromAgentId: owner.id, fromName: owner.name,
              toAgentId: t.id, toName: t.name, toDeptId: t.deptId,
              text: asked.trim(),
            });

            const tc = credsOf(t);
            await working(t, 'answer', `ตอบ${owner.name}`, tc);
            const answer = tc
              ? await relayAnswer(skillOf(t), t, question, asked, owner, tc, company)
              : (await sleep(1500), mockAnswer(t));
            send({
              type: 'opinion',
              agentId: t.id, agentName: t.name, agentRole: roleTh(t), deptId: t.deptId,
              round: 1, step, askedBy: owner.name, text: answer, model: await modelOf(tc),
            });

            steps.push({ deptName: t.deptName, asked: asked.trim(), text: answer });
          }

          send({ type: 'phase', phase: 'synthesis', label: `${owner.name} ประกอบคำตอบก่อนไปรายงาน` });
          await working(owner, 'synthesis', 'ประกอบคำตอบ', ownerC);
          const final = ownerC
            ? await relaySummary(skillOf(owner), owner, question, steps, ownerC, company)
            : (await sleep(1500), mockFinal(question));

          send({ type: 'final', text: final, leadAgentId: owner.id, leadAgentName: owner.name, model: await modelOf(ownerC) });
          if (ownerC) {
            const dump = steps.map((s, i) => `### ขั้นที่ ${i + 1} - ${owner.name} ถาม${s.deptName}: ${s.asked}\n${s.text}`).join('\n\n');
            await minutes(dump, final, owner.name);
          }
          send({ type: 'done' });
          return;
        }

        /* ---------- โต๊ะกลม ---------- */
        send({ type: 'phase', phase: 'round1', label: 'แต่ละแผนกให้ความเห็นของตัวเอง' });
        const r1: Said[] = [];
        await Promise.all(
          agents.map(async (a) => {
            const c = credsOf(a);
            await working(a, 'round1', 'ให้ความเห็นรอบแรก', c);
            const text = c
              ? await round1(skillOf(a), a, question, room, c, company)
              : (await sleep(1800 + Math.random() * 1500), mockText(a, 1));
            r1.push(asSaid(a, text));
            send({
              type: 'opinion',
              agentId: a.id, agentName: a.name, agentRole: roleTh(a), deptId: a.deptId,
              round: 1, text, model: await modelOf(c),
            });
          }),
        );

        send({ type: 'phase', phase: 'round2', label: 'ถกแย้งกันข้ามแผนก' });
        const r2: Said[] = [];
        await Promise.all(
          agents.map(async (a) => {
            const others = r1.filter((o) => o.name !== a.name);
            const c = credsOf(a);
            await working(a, 'round2', 'ค้าน/ต่อยอดรอบสอง', c);
            const text = c
              ? await round2(skillOf(a), a, question, others, room, c, company)
              : (await sleep(1500 + Math.random() * 1500), mockText(a, 2));
            r2.push(asSaid(a, text));
            send({
              type: 'opinion',
              agentId: a.id, agentName: a.name, agentRole: roleTh(a), deptId: a.deptId,
              round: 2, text, model: await modelOf(c),
            });
          }),
        );

        send({ type: 'phase', phase: 'synthesis', label: 'ประธานสรุปก่อนมารายงาน' });
        // ประธาน = หัวหน้าแผนกที่ผู้ใช้เลือกไว้ (เลือกไว้แล้วข้างบน) - ถกมาด้วยแล้ว ตอนนี้สวมหมวกประธาน
        const deptNames = deptIds.map((id) => depts.get(id)?.nameTh ?? agents.find((a) => a.deptId === id)?.deptName ?? id);
        await working(chair, 'synthesis', 'สรุปในฐานะประธาน', chairC);
        const final = chairC
          ? await synthesize(skillOf(chair), chair, question, deptNames, r1, r2, chairC, company)
          : (await sleep(1500), mockFinal(question));

        send({ type: 'final', text: final, leadAgentId: chair.id, leadAgentName: chair.name, model: await modelOf(chairC) });
        if (chairC) {
          const dump = ['## รอบแรก', dumpSaid(r1), '', '## รอบสอง (ค้าน)', dumpSaid(r2)].join('\n\n');
          await minutes(dump, final, chair.name);
        }
        send({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      }
}
