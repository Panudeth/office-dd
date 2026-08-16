'use client';

import { useEffect, useRef } from 'react';
import { drawChar } from '@/game/character';
import type { Palette } from '@/game/types';

/**
 * รูปหน้าพนักงาน - วาดด้วย drawChar ตัวเดียวกับที่ใช้วาดบนแผนที่
 * จึงตรงกับตัวที่เดินอยู่เสมอ ไม่ใช่ไอคอนที่ต้องมาไล่อัปเดตตามทีหลัง
 *
 * ตัวละครจริงสูง 24px ตรงนี้ครอปเอาแค่ 15px บนคือหัวกับไหล่
 * วาดใน useEffect ไม่ใช่ตอน render เพราะ canvas ยังไม่มีจริงบนเซิร์ฟเวอร์
 */
export default function Portrait({
  palette,
  size = 3,
  className,
}: {
  palette: Palette;
  /** ขยายกี่เท่าจากขนาดพิกเซลจริง */
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;

    const tmp = document.createElement('canvas');
    tmp.width = 16;
    tmp.height = 24;
    const tg = tmp.getContext('2d');
    if (!tg) return;
    // ท่ายืนหันหน้าเข้าหาคนดู - เฟรม 1 คือเฟรมที่ world ใช้ตอนไม่ได้เดิน
    drawChar(tg, palette, 'down', 'stand', 1);

    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, 16, 15, 0, 0, c.width, c.height);
  }, [palette]);

  return (
    <canvas
      ref={ref}
      width={16 * size}
      height={15 * size}
      aria-hidden
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
