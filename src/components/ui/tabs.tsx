'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* แท็บทำหน้าตาเป็นแผ่นไม้เหมือนหัวแผง แท็บที่เลือกอยู่ยกตัวขึ้นมาชนขอบล่าง
   จะได้อ่านออกว่าอันไหน active โดยไม่ต้องพึ่งสีอย่างเดียว */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'bevel flex items-stretch gap-1 border-b-2 border-wood-deep bg-wood-mid px-1.5 pt-1.5',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 rounded-t-box border-2 border-b-0 border-transparent',
        'px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        'text-parchment-2/70 hover:text-parchment',
        'data-[state=active]:border-wood-deep data-[state=active]:bg-ink-800',
        'data-[state=active]:text-parchment',
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('flex min-h-0 flex-1 flex-col focus-visible:outline-none', className)}
      {...props}
    />
  );
}
