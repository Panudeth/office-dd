'use client';

import { useEffect, useRef } from 'react';
import { decalSprite, decorSprite, objSprite, tileSprite } from '@/game/art';
import { footprint, type FurnKind, type LayoutItem } from '@/game/furniture';
import { TS } from '@/game/map';
import type { Dir } from '@/game/types';

/**
 * รูปตัวอย่างเฟอร์นิเจอร์ - วาดด้วย sprite ตัวเดียวกับบนแผนที่ (objSprite) จึงตรงกับของจริงเสมอ
 * วาดใน useEffect เพราะ canvas มีเฉพาะฝั่ง client
 */
export default function FurnThumb({
  kind, dir = 'up', v = 0, size = 3, className,
}: { kind: FurnKind; dir?: Dir; v?: number; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const it: LayoutItem = { id: 'thumb', kind, x: 0, y: 0, dir, v };
  const fp = footprint(it);
  const minX = Math.min(...fp.map((f) => f.x)), minY = Math.min(...fp.map((f) => f.y));
  const w = (Math.max(...fp.map((f) => f.x)) - minX + 1) * TS;
  // เผื่อด้านบนให้ sprite ที่สูงกว่า 1 ช่อง (ต้นไม้ ตู้ พนักพิงเก้าอี้)
  const PAD = 12;
  const h = (Math.max(...fp.map((f) => f.y)) - minY + 1) * TS + PAD;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.save();
    g.scale(size, size);
    // ลำดับวาดตามแถว (ล่างทับบน) เหมือน render จริง
    [...fp].sort((a, b) => a.y - b.y).forEach((f) => {
      const ox = (f.x - minX) * TS, oy = (f.y - minY) * TS + PAD;
      if (f.layer === 'obj' && f.obj) { const s = objSprite(f.obj); g.drawImage(s.c, ox - (s.ox ?? 0), oy - s.oy); }
      else if (f.layer === 'decal' && f.decal) g.drawImage(decalSprite({ ...f.decal, x: 0, y: 0 }), ox, oy);
      else if (f.layer === 'wall' && f.wall === 'logo') {
        const w = (f.wallRect?.w ?? 1) * TS, h = (f.wallRect?.h ?? 1) * TS;
        for (let dx = 0; dx < (f.wallRect?.w ?? 1); dx++) for (let dy = 0; dy < (f.wallRect?.h ?? 1); dy++) g.drawImage(tileSprite('#', 1, 1, 0), ox + dx * TS, oy + dy * TS);
        g.fillStyle = '#3a2c1a'; g.fillRect(ox + 1, oy + 2, w - 2, h - 3); g.fillStyle = '#f0e2c0'; g.fillRect(ox + 2, oy + 3, w - 4, h - 5);
        g.fillStyle = '#d8b060'; g.fillRect(ox + 1, oy + 2, w - 2, 1); g.fillStyle = '#a07830'; g.fillRect(ox + 1, oy + h - 2, w - 2, 1);
      }
      else if (f.layer === 'wall' && f.wall) { g.drawImage(tileSprite('#', 1, 1, 0), ox, oy); g.drawImage(decorSprite(f.wall), ox, oy); }
      else if (f.layer === 'wall') { g.drawImage(tileSprite('#', 1, 1, 0), ox, oy); }
      else if (kind === 'deptsign') { g.fillStyle = 'rgba(10,14,20,.8)'; g.fillRect(ox, oy + 4, TS, 8); g.fillStyle = '#ffd166'; g.fillRect(ox, oy + 4, TS, 2); }
    });
    g.restore();
  }, [kind, dir, v, size]); // eslint-disable-line react-hooks/exhaustive-deps -- fp/minX/minY ล้วนมาจาก kind/dir/v

  return (
    <canvas
      ref={ref}
      width={w * size}
      height={h * size}
      aria-hidden
      className={className}
      style={{ imageRendering: 'pixelated', width: w * size / 2, height: h * size / 2 }}
    />
  );
}

/** รูปตัวอย่างพื้น/ผนัง (สำหรับจานสีทาพื้น) */
export function TileThumb({ code, size = 3, className }: { code: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.save(); g.scale(size, size);
    // วาด 2x2 ให้เห็นลายต่อกัน (mask ใช้พิกัดกลางแผนที่ที่ไม่ใช่ขอบ)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(tileSprite(code, 20 + x, 8 + y, 0), x * TS, y * TS);
    g.restore();
  }, [code, size]);
  return <canvas ref={ref} width={32 * size} height={32 * size} aria-hidden className={className} style={{ imageRendering: 'pixelated', width: 32 * size / 2, height: 32 * size / 2 }} />;
}
