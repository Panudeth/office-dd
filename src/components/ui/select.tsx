'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* select ของ native บน Windows จะโผล่เมนูสีขาวของระบบมาทับธีมทั้งหมด
   Radix วาดเมนูเอง เลยคุมหน้าตาได้ครบและยังเลื่อนด้วยลูกศรได้เหมือนเดิม */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-box border-2 border-ink-600',
        'bg-ink-900 px-2.5 text-[13px] text-parchment',
        'focus-visible:border-brass focus-visible:outline-none disabled:opacity-40',
        '[&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3.5 shrink-0 text-wall-mid" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-box border-2 border-ink-500',
          'bg-ink-800 shadow-[0_3px_0_0_rgba(0,0,0,.6)]',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-box py-1.5 pl-6 pr-2',
        'text-[12px] text-parchment outline-none',
        'data-[highlighted]:bg-wood-dark data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <span className="absolute left-1.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3 text-brass" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
