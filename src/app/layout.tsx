import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Visual Company',
  description: 'บริษัทจำลองแบบ pixel art ที่พนักงานเป็น AI agent - จ้าง ประชุม แล้วรายงานผล',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
