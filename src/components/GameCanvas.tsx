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
    // handle สำหรับดีบักในคอนโซล เช่น vcWorld.debugStep(10) — เฉพาะตอน dev
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { vcWorld?: World }).vcWorld = world;
    }
    onReady(world);
    return () => {
      window.clearTimeout(t);
      world.destroy();
    };
    // ตั้งใจสร้าง world ครั้งเดียวต่อการ mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} className="screen" />;
}
