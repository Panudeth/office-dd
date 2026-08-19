import { mergeDepartments, type Department, type DepartmentDef } from './departments';
import { ask, type Creds } from './llm';
import type { Agenda, AgendaItem, MeetingMode } from './protocol';
import { profileBlock } from './company';
import { langNote, type ReplyLang } from '@/lib/lang';

/* ============================================================
   เลขานุการที่ประชุม - อ่านคำถามแล้วบอกว่าเรื่องนี้ต้องมีใครเข้าบ้าง

   ทำไมต้องใช้ LLM แทนการนับคำ: คำถามอย่าง "อยากจ้างแรงงานต่างด้าว"
   ไม่มีคำว่ากฎหมายหรือภาษีอยู่ในประโยคเลย การนับคำจะเห็นแค่คำว่า "จ้าง"
   แล้วเรียกฝ่ายบุคคลมาแผนกเดียว ทั้งที่เรื่องนี้ติดทั้งใบอนุญาตและต้นทุน
   ============================================================ */

/** อธิบายว่าแต่ละแผนกดูแลอะไร - ประกอบจาก lens ที่มีอยู่แล้ว ไม่ต้องเขียนซ้ำ */
function deptCatalog(depts: Department[], hiredDeptIds: string[]): string {
  return depts.filter((d) => hiredDeptIds.includes(d.id))
    .map((d) => `- ${d.id} (${d.nameTh}): ${d.description ? `${d.description} / ` : ''}${d.lenses.proposer} / ${d.lenses.challenger}`)
    .join('\n');
}

const SYSTEM = `คุณคือเลขานุการที่ประชุมของบริษัท หน้าที่เดียวของคุณคือ
อ่านคำถามของผู้บริหารแล้วตัดสินว่า **เรื่องนี้ต้องเรียกแผนกไหนเข้าประชุมบ้าง**

หลักการ:
- เรียกเฉพาะแผนกที่ถ้าไม่มาแล้วคำตอบจะผิดหรือขาดจริง ๆ ไม่ใช่เรียกเผื่อไว้
- คำถามส่วนใหญ่ต้องการ 2-3 แผนก คำถามที่แคบจริงจึงจะใช้แผนกเดียว
- ห้ามเรียกเกิน 3 แผนก
- ดูให้ออกว่าคำถามพาดพิงเรื่องอะไรบ้างแม้ผู้ถามจะไม่ได้เอ่ยชื่อเรื่องนั้นตรง ๆ
  เช่น การจ้างคนต่างชาติ พาดพิงทั้งใบอนุญาตทำงาน (กฎหมาย) และต้นทุนที่เพิ่ม (การเงิน)
  ไม่ใช่แค่เรื่องการรับคนเข้าทำงาน

เลือกรูปแบบการประชุมด้วย:
- "roundtable" เมื่อแต่ละแผนกจะ **เห็นไม่ตรงกัน** และต้องเถียงกันถึงจะได้คำตอบ
  (เช่น จะลดราคาสินค้าไหม การตลาดกับการเงินขัดกันแน่)
- "relay" เมื่อมีแผนกหนึ่งเป็น **เจ้าของเรื่องชัดเจน** และแค่ต้องไปขอข้อมูลจากแผนกอื่นมาประกอบ
  (เช่น จ้างแรงงานต่างด้าว ฝ่ายบุคคลเป็นเจ้าของเรื่อง ไปถามกฎหมายแล้วถามการเงิน)
- "direct" เมื่อเป็น **คำถามข้อเท็จจริงเรื่องบริษัท** ที่ตอบได้จากข้อมูลบริษัทโดยไม่ต้องตัดสินใจอะไร
  (เช่น บริษัทเราทำอะไร ติดต่อใคร มีกี่คน ร่างประกาศแจ้งลูกค้าเรื่องปิดปรับปรุง)
  ให้ items มีแผนกเดียวคือ pr ถ้าบริษัทมีฝ่ายประชาสัมพันธ์ ไม่มีก็เลือกแผนกที่ใกล้เคียงที่สุดแผนกเดียว
  ห้ามใช้ direct กับคำถามที่ต้องชั่งน้ำหนักหรือมีความเสี่ยง - นั่นต้องประชุม

ตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่นนอก JSON ห้ามใส่ markdown code fence`;

function userPrompt(question: string, depts: Department[], hiredDeptIds: string[], profile?: Record<string, string>): string {
  const facts = profileBlock(profile);
  return `${facts ? `${facts}\n\n` : ''}แผนกที่บริษัทนี้มีพนักงานอยู่จริง (เลือกได้เฉพาะ id ในรายการนี้เท่านั้น):

${deptCatalog(depts, hiredDeptIds)}

คำถามของผู้บริหาร:

"""
${question}
"""

ตอบเป็น JSON รูปนี้เป๊ะ ๆ:

{
  "note": "<สรุปหนึ่งบรรทัดว่าเรื่องนี้จริง ๆ แล้วคือเรื่องอะไร>",
  "mode": "roundtable" | "relay" | "direct",
  "owner": "<id ของแผนกเจ้าของเรื่อง ต้องอยู่ใน items ด้วย>",
  "items": [
    { "dept": "<id>", "reason": "<ทำไมเรื่องนี้ขาดแผนกนี้ไม่ได้ สั้น ๆ หนึ่งบรรทัด>" }
  ]
}`;
}

/** ดึง JSON ออกจากคำตอบที่โมเดลอาจแถม code fence หรือคำเกริ่นมาด้วย */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('ไม่พบ JSON ในคำตอบของเลขาฯ');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * เลือกแผนกด้วยการนับคำ - ใช้ตอนไม่มีคีย์ LLM (โหมดสาธิต)
 * แม่นน้อยกว่ามาก แต่ยังดีกว่าเดิมตรงที่คืนได้หลายแผนก ไม่ใช่แผนกเดียว
 */
export function keywordAgenda(question: string, hiredDeptIds: string[], custom: DepartmentDef[] = []): Agenda {
  const q = question.toLowerCase();
  const scored = mergeDepartments(custom).filter((d) => hiredDeptIds.includes(d.id))
    .map((d) => ({
      id: d.id,
      score: d.keywords.reduce((n, kw) => (q.includes(kw.toLowerCase()) ? n + 1 : n), 0),
    }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // ไม่โดนคำไหนเลย - เอาแผนกแรกที่มีคนไว้ก่อน ดีกว่าไม่มีใครเข้าประชุม
  const ids = scored.length ? scored.map((s) => s.id) : hiredDeptIds.slice(0, 1);

  return {
    mode: 'roundtable',
    ownerDeptId: ids[0],
    items: ids.map((id) => ({
      deptId: id,
      reason: 'เลือกจากคำที่ตรงในคำถาม (ยังไม่ได้ใส่คีย์ LLM จึงยังไม่ได้อ่านความหมาย)',
    })),
    note: 'โหมดสาธิต - ใส่ API key แล้วเลขาฯ จะอ่านคำถามให้จริง',
    fallback: true,
  };
}

export async function buildAgenda(
  question: string,
  hiredDeptIds: string[],
  creds: Creds | null,
  profile?: Record<string, string>,
  custom: DepartmentDef[] = [],
  lang?: ReplyLang,
): Promise<Agenda> {
  if (!creds || !hiredDeptIds.length) return keywordAgenda(question, hiredDeptIds, custom);
  const depts = mergeDepartments(custom);
  const known = new Set(depts.map((d) => d.id));

  let raw: unknown;
  try {
    const text = await ask(
      { system: SYSTEM + langNote(lang), user: userPrompt(question, depts, hiredDeptIds, profile), maxTokens: 2000, effort: 'low' },
      creds,
    );
    raw = extractJson(text);
  } catch {
    // เลขาฯ พังไม่ควรทำให้ถามคำถามไม่ได้เลย - ถอยไปใช้การนับคำแล้วเดินต่อ
    return keywordAgenda(question, hiredDeptIds, custom);
  }

  const o = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.items) ? o.items : [];

  const seen = new Set<string>();
  const items: AgendaItem[] = [];
  for (const r of rows) {
    const row = (r ?? {}) as Record<string, unknown>;
    const deptId = typeof row.dept === 'string' ? row.dept : '';
    // โมเดลชอบแต่งแผนกที่ไม่มีอยู่จริงขึ้นมา - ตัดทิ้งเงียบ ๆ ดีกว่าปล่อยไปพังตอนประชุม
    if (!known.has(deptId) || !hiredDeptIds.includes(deptId) || seen.has(deptId)) continue;
    seen.add(deptId);
    items.push({
      deptId,
      reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : 'เกี่ยวข้องกับคำถามนี้',
    });
    if (items.length >= 3) break;
  }

  if (!items.length) return keywordAgenda(question, hiredDeptIds, custom);

  const owner = typeof o.owner === 'string' && seen.has(o.owner) ? o.owner : items[0].deptId;
  const mode: MeetingMode = o.mode === 'relay' ? 'relay' : o.mode === 'direct' ? 'direct' : 'roundtable';
  // แผนกเดียวไม่มีใครให้ส่งต่อ - สายพานจะกลายเป็นการเดินไปคุยกับตัวเอง
  // direct ต้องแผนกเดียวเท่านั้น - หลายแผนกแปลว่าเลขาฯ ตัดสินผิด ให้เป็นโต๊ะกลมแทน
  const safeMode: MeetingMode =
    mode === 'relay' && items.length < 2 ? 'roundtable'
      : mode === 'direct' && items.length > 1 ? 'roundtable'
        : mode;

  return {
    mode: safeMode,
    ownerDeptId: owner,
    items,
    note: typeof o.note === 'string' ? o.note.trim() : '',
    fallback: false,
  };
}
