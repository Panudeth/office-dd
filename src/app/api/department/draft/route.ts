import { NextRequest } from 'next/server';
import { PRESET_BY_ID, ROLE_ORDER, sanitizeDeptDef, slugifyDeptId, type AgentRole } from '@/lib/departments';
import { ask, resolveCreds } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/* ============================================================
   "ให้ AI ร่างแผนก" - ผู้ใช้กรอกแค่ชื่อ + หน้าที่ (ภาษาคน) แล้ว LLM เขียนที่เหลือให้ทั้งชุด:
   id, ชื่อย่อ, สี, keywords สำหรับ route, มุมมอง 4 บทบาท, สกิล (markdown แบบเดียวกับ skills/*.md), playbook
   ผู้ใช้แก้ทุกช่องได้ก่อนบันทึก - นี่คือสิ่งที่ทำให้ "ไม่รู้ล่วงหน้าว่าเขาจะตั้งแผนกอะไร" ไม่เป็นปัญหา
   คีย์มาทาง header เหมือน /api/ask
   ============================================================ */

interface DraftBody {
  name?: string;
  description?: string;
  /** id ที่มีอยู่แล้ว (preset + ของออฟฟิศ) - จะได้ไม่ชน */
  existingIds?: string[];
  /** ร่างทับแผนกเดิม (id คงเดิม) */
  id?: string;
}

const SYSTEM = `คุณคือที่ปรึกษาออกแบบองค์กร หน้าที่คือ "ตั้งแผนกใหม่" ให้บริษัทจำลองที่พนักงานทุกคนเป็น AI agent
แผนกหนึ่งมี 4 บทบาทที่ถูกประเมินคนละเกณฑ์: ผู้เสนอ (proposer) ผู้ค้าน (challenger) ผู้ตรวจสอบ (verifier) ผู้ดูความเป็นไปได้ (pragmatist)
ทุกคนในแผนก "เรียนสกิลเดียวกัน" (ไฟล์ markdown) แล้วมองงานจากมุมของบทบาทตัวเอง

ตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่นนอก JSON ห้ามใส่ markdown code fence`;

const userPrompt = (b: DraftBody, existing: string[]) => `ตั้งแผนกจากข้อมูลนี้:

ชื่อแผนก: ${b.name}
หน้าที่/สิ่งที่ผู้ใช้อยากให้แผนกนี้ทำ (ภาษาคน):
"""
${b.description || '(ไม่ได้ระบุ - เดาจากชื่อแผนก)'}
"""
${b.id ? `id ต้องเป็น "${b.id}" (แก้แผนกเดิม)` : `id ที่ใช้ไปแล้ว ห้ามซ้ำ: ${existing.join(', ') || '-'}`}

ตอบ JSON รูปนี้เป๊ะ ๆ:
{
  "id": "<slug อังกฤษตัวเล็ก a-z0-9 และขีดกลาง 2-32 ตัว เช่น it-support>",
  "shortTh": "<ชื่อย่อไทยหรืออังกฤษ ไม่เกิน 12 ตัวอักษร ไว้ขึ้นป้ายแผนกบนแผนที่>",
  "color": "<สี hex 6 หลัก โทนที่ต่างจาก #9a5fc0 #3fa06a #4a7fd0 #e0a13f #e07aa8 #5cbcc8 - อ่านออกบนพื้นเข้ม>",
  "keywords": ["<คำไทย/อังกฤษ 10-18 คำที่ถ้าโผล่ในคำถามแปลว่าเกี่ยวกับแผนกนี้>"],
  "lenses": {
    "proposer": "<มุมที่ผู้เสนอของแผนกนี้ต้องมอง หนึ่งประโยค>",
    "challenger": "<มุมที่ผู้ค้านของแผนกนี้ต้องมอง หนึ่งประโยค>",
    "verifier": "<มุมที่ผู้ตรวจสอบของแผนกนี้ต้องมอง หนึ่งประโยค>",
    "pragmatist": "<มุมที่ผู้ดูความเป็นไปได้ของแผนกนี้ต้องมอง หนึ่งประโยค>"
  },
  "skillText": "<สกิล markdown ภาษาไทย 1500-3000 ตัวอักษร โครง: '# Skill: <ชื่อ>' / บทนำ 1 บรรทัดว่าเป็นแผนกอะไรของบริษัท / '## หน้าที่' / '## หลักการทำงาน' (5 ข้อ ตัวหนา+อธิบาย เน้นวิธีคิดที่ใช้ได้จริง) / '## ขอบเขต' (สิ่งที่ห้ามทำ/ห้ามเดา) / '## รูปแบบคำตอบ' (ภาษาไทย กระชับ)>",
  "playbook": "<ถ้าหน้าที่บอกว่ารับข้อมูลจากระบบภายนอก (bug report, บิล, alert, log ฯลฯ) ให้เขียนขั้นตอนสั้น ๆ 3-6 ข้อว่าเมื่อมีข้อมูลเข้ามาต้องทำอะไร ตัดสินยังไง รายงานอะไร ใครควรถูกแจ้ง - ถ้าไม่เกี่ยวกับข้อมูลเข้าให้เป็นสตริงว่าง>"
}`;

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('โมเดลไม่ได้ตอบเป็น JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function POST(req: NextRequest) {
  let body: DraftBody;
  try {
    body = (await req.json()) as DraftBody;
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'ต้องมีชื่อแผนก' }, { status: 400 });

  const creds = resolveCreds({
    provider: req.headers.get('x-llm-provider'),
    apiKey: req.headers.get('x-llm-key'),
    model: req.headers.get('x-llm-model'),
    baseUrl: req.headers.get('x-llm-base-url'),
  });
  if (!creds) return Response.json({ error: 'ยังไม่มีคีย์ AI - ใส่คีย์ก่อน หรือกรอกเองทุกช่อง' }, { status: 400 });

  const existing = (Array.isArray(body.existingIds) ? body.existingIds : []).filter((x): x is string => typeof x === 'string').slice(0, 100);
  try {
    const text = await ask({ system: SYSTEM, user: userPrompt(body, existing), maxTokens: 6000, effort: 'medium' }, creds);
    const raw = (extractJson(text) ?? {}) as Record<string, unknown>;
    // id: ของเดิม > ที่โมเดลตั้ง > slug จากชื่อ > dept-<สุ่ม> - และห้ามชนของที่มี
    let id = body.id?.trim() || (typeof raw.id === 'string' ? slugifyDeptId(raw.id) : '') || slugifyDeptId(name);
    if (!id) id = `dept-${Math.random().toString(36).slice(2, 7)}`;
    if (!body.id && (existing.includes(id) || PRESET_BY_ID.has(id))) id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
    const lensesIn = (raw.lenses && typeof raw.lenses === 'object' ? raw.lenses : {}) as Record<string, unknown>;
    const lenses: Partial<Record<AgentRole, string>> = {};
    for (const r of ROLE_ORDER) if (typeof lensesIn[r] === 'string') lenses[r] = lensesIn[r] as string;
    const def = sanitizeDeptDef({
      id, nameTh: name, shortTh: raw.shortTh, color: raw.color, description: body.description ?? '',
      keywords: raw.keywords, lenses, skillText: raw.skillText, playbook: raw.playbook,
    });
    if (!def) return Response.json({ error: 'ร่างไม่ผ่านการตรวจ - ลองใหม่' }, { status: 502 });
    return Response.json({ draft: def });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
