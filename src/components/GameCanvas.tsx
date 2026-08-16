'use client';

import { useEffect, useRef } from 'react';
import { World } from '@/game/world';

export default function GameCanvas({ onReady }: { onReady: (w: World) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const world = new World(canvas);
    // resize อีกครั้งหลัง layout นิ่ง (parent อาจยังกว้างไม่ครบตอน mount)
    const t = window.setTimeout(() => world.resize(), 0);

    /**
     * world ฟังแค่ window resize ซึ่งไม่ครอบคลุมตอนผู้ใช้ลากย่อขยาย sidebar
     * เพราะหน้าต่างเท่าเดิมแต่คอลัมน์ของ canvas แคบลง
     *
     * เทียบขนาดก่อนสั่ง resize กันยิงซ้ำโดยไม่จำเป็น
     * (กรอบของ canvas ยืดตามแถวใน grid ไม่ได้โตตามเนื้อหา จึงไม่มีลูปย้อนกลับ)
     */
    const parent = canvas.parentElement;
    let lastW = parent?.clientWidth ?? 0;
    let lastH = parent?.clientHeight ?? 0;
    const ro = new ResizeObserver(() => {
      const w = parent?.clientWidth ?? 0;
      const h = parent?.clientHeight ?? 0;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      world.resize();
    });
    if (parent) ro.observe(parent);
    // handle สำหรับดีบักในคอนโซล เช่น vcWorld.debugStep(10) - เฉพาะตอน dev
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { vcWorld?: World }).vcWorld = world;
    }
    onReady(world);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      world.destroy();
    };
    // ตั้งใจสร้าง world ครั้งเดียวต่อการ mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} className="screen" />;
}
