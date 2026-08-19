import { NextRequest } from 'next/server';
import { chunkText, embedModelFor, embedTexts } from '@/lib/embed';
import { resolveCreds } from '@/lib/llm';
import { checkOfficePolicy } from '@/lib/office-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * แปลงข้อความเป็น vector ด้วยคีย์ที่ผู้ใช้ส่งมา (เหมือน /api/ask)
 * เซิร์ฟเวอร์ไม่มี Supabase creds - client เป็นคนเอา vector ไปเก็บ/ค้นเองผ่าน RLS
 *
 * body: { texts: string[] }  หรือ  { document: string }  (ตัดชิ้นให้ด้วย)
 */
export async function POST(req: NextRequest) {
  const creds = resolveCreds({
    provider: req.headers.get('x-llm-provider'),
    apiKey: req.headers.get('x-llm-key'),
    model: req.headers.get('x-llm-model'),
    baseUrl: req.headers.get('x-llm-base-url'),
  });
  if (!creds) return Response.json({ error: 'ยังไม่มีคีย์ LLM - ตั้งค่าที่ปุ่มคีย์ของฉันก่อน' }, { status: 400 });

  let body: { texts?: string[]; document?: string; officeId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  const deny = await checkOfficePolicy(body.officeId, creds);
  if (deny) return Response.json({ error: deny }, { status: 403 });

  const texts = Array.isArray(body.texts)
    ? body.texts.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    : typeof body.document === 'string' ? chunkText(body.document) : [];
  if (!texts.length) return Response.json({ error: 'ไม่มีข้อความให้แปลง' }, { status: 400 });
  if (texts.length > 400) return Response.json({ error: 'เอกสารใหญ่เกินไป (เกิน 400 ชิ้น) - แบ่งไฟล์ก่อน' }, { status: 413 });

  try {
    // ยิงเป็นก้อนละ 64 กัน payload/quota
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const r = await embedTexts(texts.slice(i, i + 64), creds);
      vectors.push(...r.vectors);
    }
    return Response.json({ texts, vectors, model: embedModelFor(creds) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
