import type { Metadata } from 'next';
import './globals.css';
import { publicRuntimeEnv } from '@/lib/public-env';

// อ่าน env ตอนมีคนเปิดหน้า (ไม่ bake ตอน build) - จำเป็นสำหรับ Docker image สำเร็จรูป
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Visual Company',
  description: 'บริษัทจำลองแบบ pixel art ที่พนักงานเป็น AI agent - จ้าง ประชุม แล้วรายงานผล',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // ฝากค่า public config ให้เบราว์เซอร์ - สคริปต์ inline รันก่อน bundle ของแอปเสมอ
  const env = JSON.stringify(publicRuntimeEnv()).replace(/</g, '\u003c');
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `window.__ENV=${env}` }} />
        {children}
      </body>
    </html>
  );
}
