'use client';

import { Info } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ============================================================
   InfoTip - ไอคอน (i) เล็ก ๆ ที่กด/ชี้แล้วโผล่คำอธิบาย
   ใช้แทนย่อหน้าอธิบายยาว ๆ ในฟอร์ม: หน้าจอโชว์แค่หัวข้อ รายละเอียดอยู่หลัง (i)
   เปิดด้วย hover/โฟกัส/คลิก ปิดด้วยคลิกข้างนอก/Esc - ไม่ต้องพึ่ง lib
   ============================================================ */
export function InfoTip({ children, className, side = 'bottom', ...props }: Omit<ComponentProps<'span'>, 'children'> & {
  children: ReactNode;
  /** ฝั่งที่กล่องโผล่ - bottom (ค่าเริ่มต้น) หรือ top เมื่ออยู่ล่างจอ */
  side?: 'bottom' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)} {...props}>
      <button
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
      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute left-0 z-[60] w-72 max-w-[80vw] rounded-box border-2 border-ink-500 bg-ink-900 px-2.5 py-2',
            'text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-parchment-2 shadow-[0_3px_0_0_rgba(0,0,0,.6)]',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
