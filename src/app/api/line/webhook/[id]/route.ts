import { NextRequest, after } from 'next/server';
import { handleLineEvents, loadLineInbound, verifyLineSignature } from '@/lib/line-inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Webhook ของ LINE OA ที่ตั้งค่าจากหน้าเว็บ (ต่อแผนก) - <id> คือแถวใน office_dept_inbound
 * ใส่ URL นี้ใน LINE Developers -> Messaging API -> Webhook URL แล้วกด Verify
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const cfg = await loadLineInbound(id);
  return Response.json({ ok: true, configured: !!cfg });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const cfg = await loadLineInbound(id);
  if (!cfg) return Response.json({ error: 'ไม่พบการตั้งค่า LINE นี้ หรือถูกปิดอยู่' }, { status: 404 });
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get('x-line-signature') ?? '', cfg.channelSecret)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  const r = handleLineEvents(raw, { ...cfg, origin: req.nextUrl.origin });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  after(async () => { await r.work; });
  return Response.json({ ok: true });
}
