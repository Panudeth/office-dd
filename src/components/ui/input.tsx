import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { InfoTip } from './infotip';

const base =
  'w-full rounded-box border-2 border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[13px] ' +
  'text-parchment placeholder:text-ink-400 ' +
  'focus-visible:border-brass focus-visible:outline-none ' +
  'disabled:opacity-40';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(base, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(base, 'resize-y leading-relaxed', className)} {...props} />;
}

/** ป้ายกำกับช่องกรอก คู่กับ Field ด้านล่าง */
export function Field({
  label,
  hint,
  info,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  label?: React.ReactNode;
  /** บรรทัดสั้น ๆ ใต้ช่อง (สถานะ/ข้อผิดพลาด) - คำอธิบายยาวใช้ info แทน */
  hint?: React.ReactNode;
  /** คำอธิบายยาว - ซ่อนหลังไอคอน (i) ข้างป้าย */
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)} {...props}>
      {(label || info) && (
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </span>
      )}
      {children}
      {hint && <span className="text-[11px] leading-snug text-dim">{hint}</span>}
    </div>
  );
}
