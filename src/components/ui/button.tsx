'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* ปุ่มมีความหนาจริง กดแล้วยุบ 2px (ดู utility .press ใน globals.css)
   ทุก variant ใช้คู่สี "หน้า/ขอบเข้ม" จากวัสดุเดียวกันในเกม */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-box ' +
    'border-2 font-semibold tracking-wide select-none ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        // ไม้ ใช้เป็นปุ่มทั่วไป
        default:
          'press bg-wood-mid border-wood-deep text-parchment hover:bg-wood',
        // พรมเขียว ใช้กับปุ่มที่ยืนยันการกระทำ
        primary:
          'press bg-carpet-dark border-[#2c6c36] text-white hover:bg-carpet',
        // พรมแดง ใช้กับปุ่มที่ลบของ
        danger:
          'press bg-rug-dark border-[#7d4234] text-white hover:bg-rug',
        // โปร่ง ใช้กับปุ่มรอง ไม่แย่งสายตา
        outline:
          'bg-transparent border-ink-500 text-dim hover:bg-ink-700 hover:text-parchment',
        // ไม่มีขอบเลย ใช้กับปุ่มปิดหรือปุ่มพับ/กาง
        ghost:
          'bg-transparent border-transparent text-dim hover:bg-ink-700 hover:text-parchment',
      },
      size: {
        sm: 'h-7 px-2.5 text-[11px]',
        default: 'h-9 px-3.5 text-xs',
        lg: 'h-11 px-6 text-sm',
        icon: 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
