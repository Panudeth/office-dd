import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // มี package-lock.json อยู่ที่ C:\Users\panud ด้วย Next เลยเดา root ผิดไปเป็นโฟลเดอร์นั้น
  // ถ้าไม่ปักหมุดไว้ ตอน build จะไล่เก็บไฟล์ผิดที่และขึ้น warning ทุกครั้ง
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // เทสต์อัตโนมัติรัน dev server อีกตัวพร้อมกันได้โดยไม่ทับ .next ของ server หลัก (ไม่ตั้ง = .next ตามปกติ)
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
