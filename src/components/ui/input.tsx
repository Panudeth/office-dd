import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

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
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)} {...props}>
      {label && (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-wall-mid">
          {label}
        </span>
      )}
      {children}
      {hint && <span className="text-[11px] leading-snug text-dim">{hint}</span>}
    </div>
  );
}
