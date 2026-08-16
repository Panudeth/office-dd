import { NextRequest } from 'next/server';
import { DEPT_BY_ID, ROLES } from '@/lib/departments';
import { ask, defaultModelFor, resolveCreds, type Creds } from '@/lib/llm';
import { loadSkill } from '@/lib/skills';
import type { AskAgent, AskEvent, AskRequest } from '@/lib/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * system prompt ของ agent หนึ่งตัว =
 *   skill.md ที่ "เรียนมา"  +  หน้าที่ตามบทบาท  +  มุมมองเฉพาะแผนก
 *
 * ตัวที่ทำให้ agent จากโมเดลเดียวกันเห็นต่างจริงคือ "หน้าที่" กับ "เกณฑ์ประเมิน"
 * ไม่ใช่บุคลิก — ผู้เสนอถูกห้ามสรุปว่าอย่าทำ ผู้ค้านถูกห้ามลงท้ายว่าเห็นด้วย
 * สองข้อนี้ทำให้ทั้งคู่ไปถึงจุดหมายคนละที่ตั้งแต่ยังไม่เห็นหน้ากัน
 */
export function agentSystem(skill: string, deptName: string, a: AskAgent): string {
  const role = ROLES[a.role];
  return `${skill}

---

## บทบาทของคุณในห้องประชุมนี้

คุณคือ **${a.name}** ทำหน้าที่ **${role.th}** ของ${deptName}

${role.mandate}

มุมที่คุณต้องมองเป็นหลัก: ${a.lens}

## กติกาห้องประชุม

- คุณกำลังนั่งกับเพื่อนร่วมทีมที่เรียนสกิลเดียวกัน แต่ **ถูกประเมินคนละเกณฑ์กับคุณ**
- ห้ามพยายามหาข้อสรุปร่วมกันเอง หน้าที่สรุปเป็นของประธาน ไม่ใช่ของคุณ
- ทีมที่เห็นตรงกันหมดตั้งแต่รอบแรก คือทีมที่ยังไม่มีใครทำงาน
- พูดจากมุมของคุณให้สุด แม้จะรู้ว่าคนอื่นจะไม่ชอบ`;
}

async function round1(skill: string, deptName: string, a: AskAgent, question: string, creds: Creds) {
  const role = ROLES[a.role];
  return ask({
    system: agentSystem(skill, deptName, a),
    user: `หัวหน้าถามเข้ามาว่า:

"""
${question}
"""

รอบแรก — คุณยังไม่เห็นความเห็นของใคร พูดจากหน้าที่ ${role.th} ของคุณเท่านั้น

${role.round1}

เขียนไม่เกิน 6 บรรทัด ห้ามเกริ่นนำ ห้ามทวนคำถาม เริ่มที่เนื้อเลย
ห้ามเขียนคำตอบแบบรอบด้านที่ครอบคลุมทุกมุม — นั่นเป็นงานของทั้งทีมรวมกัน ไม่ใช่ของคุณคนเดียว`,
    maxTokens: 6000,
    effort: role.effort,
  }, creds);
}

async function round2(
  skill: string, deptName: string, a: AskAgent, question: string,
  others: { name: string; roleTh: string; text: string }[], creds: Creds,
) {
  const role = ROLES[a.role];
  const peers = others.map((o) => `### ${o.name} (${o.roleTh})\n${o.text}`).join('\n\n');

  return ask({
    system: agentSystem(skill, deptName, a),
    user: `คำถามเดิม:

"""
${question}
"""

ตอนนี้คุณได้ยินเพื่อนร่วมทีมพูดแล้ว:

${peers}

รอบสอง — ${role.round2}

ตอบตามรูปแบบนี้เป๊ะ ๆ (3 บรรทัด ขึ้นต้นด้วยคำเหล่านี้):

ค้าน: <ระบุชื่อคนและข้อที่คุณไม่เห็นด้วย พร้อมเหตุผล — บังคับต้องมี อย่างน้อย 1 ข้อ>
ตกหล่น: <สิ่งที่ทั้งห้องยังไม่มีใครพูดถึง>
จุดยืน: <จุดยืนสุดท้ายของคุณหลังฟังทุกคน>

กติกาเข้ม:
- **ห้ามเขียนว่า "เห็นด้วยกับทุกคน" หรือ "ไม่มีข้อค้าน"** ถ้าคุณหาข้อค้านไม่เจอ แปลว่ายังอ่านไม่ละเอียดพอ
- ถ้าคุณจะเปลี่ยนจุดยืนตามคนอื่น ต้องระบุว่า **ข้อเท็จจริงหรือหลักฐานอะไร** ทำให้เปลี่ยน
  การเขียนว่า "ฟังดูมีเหตุผล" หรือ "คุณ X พูดถูก" โดยไม่ระบุเหตุ ถือว่ายังไม่ได้ทำงาน
- ค้านให้ตรงตัวบุคคลและตรงข้อ ห้ามค้านลอย ๆ ที่ใช้ได้กับทุกเรื่อง`,
    maxTokens: 6000,
    effort: role.effort,
  }, creds);
}

/**
 * สรุปโดย "ประธาน" — เป็นบทบาทที่แยกจากผู้ถกทั้งสามคน
 * ประธานถูกสั่งห้ามเกลี่ยให้ทุกคนถูก เพราะการเกลี่ยคือวิธีที่คำตอบจะกลายเป็นน้ำ
 */
async function synthesize(
  skill: string, deptName: string, chair: AskAgent, question: string,
  r1: { name: string; roleTh: string; text: string }[],
  r2: { name: string; roleTh: string; text: string }[],
  creds: Creds,
) {
  const dump = [
    '## รอบแรก (ต่างคนต่างพูด)',
    ...r1.map((o) => `**${o.name} — ${o.roleTh}:**\n${o.text}`),
    '',
    '## รอบสอง (หลังได้ยินกัน)',
    ...r2.map((o) => `**${o.name} — ${o.roleTh}:**\n${o.text}`),
  ].join('\n\n');

  return ask({
    system: `${skill}

---

## บทบาทของคุณ

ตอนนี้คุณคือ **ประธานที่ประชุม**ของ${deptName} — ไม่ใช่ผู้ถก
คุณเพิ่งฟังทีมเถียงกันสองรอบ และกำลังจะเดินไปสรุปให้หัวหน้าบริษัทฟัง

หน้าที่ของคุณคือ **ตัดสิน** ไม่ใช่รวบรวม:
- ถ้าสองฝ่ายขัดกัน ให้บอกว่าฝั่งไหนมีน้ำหนักกว่าและเพราะอะไร
- **ห้ามเกลี่ยให้ทุกคนถูก** และห้ามเขียนข้อสรุปแบบกว้าง ๆ ที่ไม่ได้เลือกอะไรเลย
- ถ้าตัดสินไม่ได้จริงเพราะข้อมูลไม่พอ ให้บอกตรง ๆ ว่าต้องรู้อะไรก่อน
- ข้อค้านที่ยังไม่มีใครตอบได้ ต้องขึ้นมาอยู่ในคำตอบ ห้ามกลบ`,
    user: `คำถามของหัวหน้า:

"""
${question}
"""

บันทึกการประชุม:

${dump}

สรุปให้หัวหน้าฟัง ตามโครงนี้ (ใช้หัวข้อตามนี้เป๊ะ):

**สรุป** — ตอบตรง ๆ 2–3 บรรทัด ว่าควรทำอะไร (ต้องเลือกข้าง ห้ามตอบว่า "ขึ้นอยู่กับ")
**เหตุผล** — 2–3 ข้อสั้น ๆ
**ข้อค้านที่ยังค้างอยู่** — ข้อที่ผู้ค้านยกมาแล้วยังไม่มีใครตอบได้ ถ้าถูกตอบครบแล้วให้เขียนว่า "ตอบครบแล้ว"
**ทีมเห็นต่างตรงไหน** — ระบุชื่อและจุดที่ยังไม่ลงรอย ถ้าลงรอยกันจริงให้เขียนว่า "ทีมเห็นตรงกัน"
**ต้องการจากหัวหน้า** — ข้อมูลหรือการตัดสินใจที่ยังขาด ถ้าไม่มีให้ตัดหัวข้อนี้ทิ้ง

ห้ามเกริ่นนำ เริ่มที่ **สรุป** ทันที`,
    maxTokens: 12000,
    effort: 'medium',
  }, creds);
}

/* ---------- โหมดสาธิต: ไม่มี API key ก็ยังเล่นดู animation ได้ ---------- */
function mockText(a: AskAgent, round: number) {
  const role = ROLES[a.role];
  if (round === 1) {
    return `[โหมดสาธิต] ในฐานะ${role.th} ผมมองเรื่องนี้จากมุม: ${a.lens}\n(ตั้งค่า ANTHROPIC_API_KEY เพื่อให้ agent ตอบจริง)`;
  }
  return `ค้าน: [โหมดสาธิต] ผมไม่เห็นด้วยกับข้อเสนอที่เร็วที่สุด เพราะยังไม่ได้ประเมินความเสี่ยง\nตกหล่น: ยังไม่มีใครพูดถึงต้นทุนเวลาจริง\nจุดยืน: เดินหน้าได้แต่ต้องมีเงื่อนไขกำกับ`;
}
function mockFinal(question: string) {
  return `**สรุป**\n[โหมดสาธิต] ยังไม่มี API key ระบบจึงตอบด้วยข้อความตัวอย่างแทนคำตอบจริงของ agent\n\n**เหตุผล**\n- ทีมเดินไปประชุมและถกครบทั้งสองรอบตามปกติแล้ว (ดูได้จาก animation)\n- เหลือแค่ใส่คีย์เพื่อให้เนื้อหาเป็นของจริง\n\n**ข้อค้านที่ยังค้างอยู่**\n- ตอบครบแล้ว\n\n**ทีมเห็นต่างตรงไหน**\n- ทีมเห็นตรงกัน (โหมดสาธิตไม่ได้ถกจริง)\n\n**ต้องการจากหัวหน้า**\n- กดปุ่ม 🔑 คีย์ของฉัน บนแถบบน แล้วใส่คีย์ Claude หรือ Gemini (คำถามที่ถามมา: "${question.slice(0, 50)}")`;
}

export async function POST(req: NextRequest) {
  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const dept = DEPT_BY_ID.get(body.departmentId);
  const agents = (body.agents ?? []).slice(0, 3);
  if (!dept || !agents.length || !body.question?.trim()) {
    return new Response('missing question / department / agents', { status: 400 });
  }

  // คีย์ของผู้ใช้มาทาง header ไม่ใช่ body — จะได้ไม่ติดไปกับ log ของ request body
  // ใช้เฉพาะภายในคำขอนี้ ไม่เก็บลงดิสก์ ไม่ส่งกลับไปที่ client
  const creds = resolveCreds({
    provider: req.headers.get('x-llm-provider'),
    apiKey: req.headers.get('x-llm-key'),
    model: req.headers.get('x-llm-model'),
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: AskEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      const roleTh = (a: AskAgent) => ROLES[a.role].th;

      try {
        const loaded = await loadSkill(dept.skill);
        const skill = loaded.text;
        const question = body.question.trim();
        const live = creds !== null;

        // ส่งหลักฐานให้ผู้ใช้ตรวจได้ว่า skill ถูกอ่านและประกอบเป็น system prompt จริง
        // (skill ถูกโหลด "ตอนนี้" ไม่ใช่ตอนกดจ้าง — agent ไม่มี state ค้างระหว่างคำถาม)
        send({
          type: 'skill',
          proof: {
            file: loaded.file,
            bytes: loaded.bytes,
            missing: loaded.missing,
            systemPrompt: agentSystem(skill, dept.nameTh, agents[0]),
            agentName: agents[0].name,
            model: creds?.model || (creds ? defaultModelFor(creds.provider) : 'โหมดสาธิต'),
            provider: creds?.provider ?? 'mock',
          },
        });

        /* ---------- รอบ 1: ต่างคนต่างพูดจากหน้าที่ของตัวเอง ---------- */
        send({ type: 'phase', phase: 'round1', label: 'แต่ละบทบาทให้ความเห็นของตัวเอง' });
        const r1: { name: string; roleTh: string; text: string }[] = [];
        await Promise.all(
          agents.map(async (a) => {
            const text = live
              ? await round1(skill, dept.nameTh, a, question, creds)
              : (await sleep(1800 + Math.random() * 1500), mockText(a, 1));
            r1.push({ name: a.name, roleTh: roleTh(a), text });
            send({ type: 'opinion', agentId: a.id, agentName: a.name, agentRole: roleTh(a), round: 1, text });
          }),
        );

        /* ---------- รอบ 2: บังคับให้ค้าน ---------- */
        send({ type: 'phase', phase: 'round2', label: 'ถกแย้งกัน' });
        const r2: { name: string; roleTh: string; text: string }[] = [];
        await Promise.all(
          agents.map(async (a) => {
            const others = r1.filter((o) => o.name !== a.name);
            const text = live
              ? await round2(skill, dept.nameTh, a, question, others, creds)
              : (await sleep(1500 + Math.random() * 1500), mockText(a, 2));
            r2.push({ name: a.name, roleTh: roleTh(a), text });
            send({ type: 'opinion', agentId: a.id, agentName: a.name, agentRole: roleTh(a), round: 2, text });
          }),
        );

        /* ---------- สรุป: ประธานตัดสิน ---------- */
        send({ type: 'phase', phase: 'synthesis', label: 'ประธานสรุปก่อนมารายงาน' });
        // ให้ผู้ตรวจสอบ (ตัวกลาง) เป็นคนเดินมารายงาน ถ้าไม่มีค่อยใช้คนแรก
        const chair = agents.find((a) => a.role === 'verifier') ?? agents[0];
        const final = live
          ? await synthesize(skill, dept.nameTh, chair, question, r1, r2, creds)
          : (await sleep(1500), mockFinal(question));

        send({ type: 'final', text: final, leadAgentId: chair.id, leadAgentName: chair.name });
        send({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
