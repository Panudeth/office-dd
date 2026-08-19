'use client';

import { Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/* ============================================================
   InfoTip - ไอคอน (i) เล็ก ๆ ที่กด/ชี้แล้วโผล่คำอธิบาย
   ใช้แทนย่อหน้าอธิบายยาว ๆ ในฟอร์ม: หน้าจอโชว์แค่หัวข้อ รายละเอียดอยู่หลัง (i)
   กล่องอธิบาย render ผ่าน portal ที่ body แบบ fixed - อยู่ในกล่องที่ scroll/overflow ก็ไม่โดนตัด
   วางใต้ปุ่มเป็นค่าเริ่มต้น ถ้าใกล้ขอบล่างจอจะพลิกขึ้นบน และไม่ล้นขอบซ้าย/ขวา
   เปิดด้วย hover/โฟกัส/คลิก ปิดด้วยคลิกข้างนอก/Esc - ไม่ต้องพึ่ง lib
   ============================================================ */
export function InfoTip({ children, className, side, ...props }: Omit<ComponentProps<'span'>, 'children'> & {
  children: ReactNode;
  /** บังคับฝั่ง - ไม่ระบุ = อัตโนมัติ (ล่าง แล้วพลิกขึ้นถ้าไม่พอ) */
  side?: 'bottom' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLSpanElement>(null);

  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(300, window.innerWidth - 16);
    const est = box.current?.offsetHeight ?? 120;
    const up = side === 'top' || (side !== 'bottom' && b.bottom + est + 12 > window.innerHeight && b.top > est + 12);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - width - 8));
    setPos({ left, top: up ? b.top - 6 : b.bottom + 6, up, width });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !box.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const re = () => place();
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', re);
    window.addEventListener('scroll', re, true);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', re);
      window.removeEventListener('scroll', re, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={cn('relative inline-flex align-middle', className)} {...props}>
      <button
        ref={btn}
        type="button"
        aria-label="รายละเอียด"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-4 items-center justify-center rounded-full border border-ink-500 text-dim hover:border-brass hover:text-parchment focus-visible:border-brass focus-visible:outline-none"
      >
        <Info className="size-2.5" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={box}
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width, transform: pos.up ? 'translateY(-100%)' : undefined } : { left: -9999, top: 0 }}
          className={cn(
            'fixed z-[70] rounded-box border-2 border-ink-500 bg-ink-900 px-2.5 py-2 text-left text-[11px] font-normal normal-case',
            'leading-relaxed tracking-normal text-parchment-2 shadow-[0_3px_0_0_rgba(0,0,0,.6)]',
          )}
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  );
}
