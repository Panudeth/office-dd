import { NextRequest } from 'next/server';
import { avatarPng, parsePaletteParam } from '@/lib/avatar-png';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * รูปหน้าพนักงาน (pixel) เป็น PNG - ใช้กับช่องที่ต้องการ URL รูปจริง (Slack / Discord / webhook)
 *   GET /api/avatar?p=<palette base64url>&s=<scale 1-8>
 * palette มีแค่รหัสสี ไม่มีข้อมูลส่วนตัว จึงเปิดสาธารณะได้ (cache ยาว - สีเดิมได้รูปเดิมเสมอ)
 */
export async function GET(req: NextRequest) {
  const pal = parsePaletteParam(req.nextUrl.searchParams.get('p') ?? '');
  if (!pal) return new Response('bad palette', { status: 400 });
  const scale = Number(req.nextUrl.searchParams.get('s') ?? 4) || 4;
  const png = avatarPng(pal, scale);
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
