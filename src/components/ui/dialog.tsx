'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { t } from '@/lib/i18n';

/* Radix จัดการ focus trap, ปิดด้วย Escape, aria และคืนโฟกัสให้ปุ่มเดิม
   ของพวกนี้เขียนเองแล้วพลาดง่าย เลยยืมมาใช้ แต่หน้าตายังเป็นกล่อง GBA เหมือนเดิม */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  icon,
  title,
  description,
  children,
  wide,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** กว้างขึ้นสำหรับฟอร์มยาว ๆ อย่างข้อมูลบริษัท */
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/72" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh]',
          wide ? 'w-[min(720px,calc(100vw-2rem))]' : 'w-[min(460px,calc(100vw-2rem))]',
          '-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
          'rounded-box border-2 border-ink-500 bg-ink-800 shadow-[0_4px_0_0_rgba(0,0,0,.6)]',
          className,
        )}
        {...props}
      >
        <header className="bevel flex items-center gap-2 border-b-2 border-wood-deep bg-wood-mid px-2.5 py-1.5">
          {icon && <span className="text-parchment-2 [&_svg]:size-4">{icon}</span>}
          <DialogPrimitive.Title className="text-[11px] font-bold uppercase tracking-wide text-parchment">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" className="ml-auto text-parchment-2 hover:bg-wood-dark">
              <X />
              <span className="sr-only">{t('ปิด')}</span>
            </Button>
          </DialogPrimitive.Close>
        </header>

        {description ? (
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
        ) : (
          /* Radix เตือนใน console ถ้าไม่มี Description เลย */
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto p-3">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-1 flex items-center justify-end gap-2', className)}
      {...props}
    />
  );
}
