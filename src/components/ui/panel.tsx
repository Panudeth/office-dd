import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ============================================================
   Panel คือกล่องข้อความแบบ GBA
   ขอบหนา มุมเหลี่ยม หัวเป็นแผ่นไม้ ตัวเป็นพื้นเข้ม
   ทุกแผงในแอปใช้อันนี้ จะได้เป็นภาษาเดียวกันทั้งหมด
   ============================================================ */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col rounded-box border-2 border-ink-500 bg-ink-800',
        'shadow-[0_2px_0_0_rgba(0,0,0,.5)]',
        className,
      )}
      {...props}
    />
  );
}

/** หัวแผง เป็นแผ่นไม้ อ่านแล้วรู้ทันทีว่าแผงเริ่มตรงไหน */
export function PanelHeader({
  icon,
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<'header'>, 'title'> & {
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header
      className={cn(
        'bevel flex items-center gap-2 border-b-2 border-wood-deep bg-wood-mid px-2.5 py-1.5',
        className,
      )}
      {...props}
    >
      {icon && <span className="text-parchment-2 [&_svg]:size-4">{icon}</span>}
      <h2 className="text-[11px] uppercase text-parchment">{title}</h2>
      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </header>
  );
}

export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col gap-2.5 p-2.5', className)}
      {...props}
    />
  );
}

/** ข้อความอธิบายตัวเล็ก ใช้ซ้ำเยอะจนควรมีตัวเดียว */
export function Hint({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('text-[11px] leading-relaxed text-dim', className)}
      {...props}
    />
  );
}
