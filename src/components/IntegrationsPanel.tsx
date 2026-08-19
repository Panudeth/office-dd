'use client';

import { Building2, Inbox, Plug, Settings2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Office } from '@/lib/supabase';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import IntegrationsSection from '@/components/IntegrationsSection';

/** หน้าต่าง "เชื่อมต่อ" - แยกจากหน้าออฟฟิศ เพราะเป็นเรื่องของนักพัฒนา/ระบบภายนอก ไม่ใช่การเลือกออฟฟิศ */
export default function IntegrationsPanel({ open, onClose, office, onPolicy, initialTab = 'depts', depts, inline = false }: {
  open: boolean; onClose: () => void; office: Office | null; onPolicy?: (p: 'any' | 'local') => void;
  /** แท็บที่เปิดมา - ปุ่ม "แผนก" เปิด depts, ปุ่ม "เชื่อมต่อ" เปิด in */
  initialTab?: 'depts' | 'in' | 'settings';
  /** เนื้อหาแท็บแผนก (รายการแผนก) - หน้าเว็บประกอบให้ */
  depts?: ReactNode;
  /** แสดงในแท็บของแผงขวา (ไม่มี dialog) */
  inline?: boolean;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const body = (
    <>
        {office ? (
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
            <TabsList className="rounded-t-box border border-b-0 border-wood-deep">
              <TabsTrigger value="depts"><Building2 /> แผนก</TabsTrigger>
              <TabsTrigger value="in"><Inbox /> Webhook เข้าของออฟฟิศ (token / LINE OA)</TabsTrigger>
              <TabsTrigger value="settings"><Settings2 /> โมเดล / นโยบาย</TabsTrigger>
            </TabsList>
            <TabsContent value="depts" className="min-h-0">
              <div className={`flex flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5 ${inline ? '' : 'max-h-[62vh]'}`}>
                {depts}
              </div>
            </TabsContent>
            {(['in', 'settings'] as const).map((p) => (
              <TabsContent key={p} value={p} className="min-h-0">
                <div className={`flex flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5 ${inline ? '' : 'max-h-[62vh]'}`}>
                  <IntegrationsSection office={office} onPolicy={onPolicy} part={p} />
                </div>
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <p className="text-[11px] text-dim">เลือกออฟฟิศก่อน (โหมดในเครื่องไม่มี webhook/การเชื่อมต่อ)</p>
        )}
    </>
  );
  if (inline) return open ? body : null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent icon={<Plug />} title="แผนก & การเชื่อมต่อ" description={office ? `ออฟฟิศ "${office.name}"` : 'เลือกออฟฟิศก่อน'} wide>
        {body}
      </DialogContent>
    </Dialog>
  );
}
