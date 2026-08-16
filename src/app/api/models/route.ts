import { NextRequest } from 'next/server';
import { defaultModelFor, listModels, resolveCreds } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ดึงรายชื่อโมเดลที่คีย์นี้เรียกได้จริง
 * คีย์มาทาง header เหมือน /api/ask — ใช้แล้วทิ้ง ไม่เก็บ ไม่ log
 * ใช้เป็นปุ่ม "ตรวจคีย์" ไปในตัว เพราะถ้าคีย์ผิดจะ error ตรงนี้เลย
 */
export async function POST(req: NextRequest) {
  const creds = resolveCreds({
    provider: req.headers.get('x-llm-provider'),
    apiKey: req.headers.get('x-llm-key'),
    model: null,
  });

  if (!creds) {
    return Response.json({ error: 'ยังไม่มีคีย์ — ใส่ API key ก่อน' }, { status: 400 });
  }

  try {
    const models = await listModels(creds);
    return Response.json({
      provider: creds.provider,
      source: creds.source,
      defaultModel: defaultModelFor(creds.provider),
      models,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
