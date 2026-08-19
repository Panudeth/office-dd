'use client';

import { Plug } from 'lucide-react';
import type { Office } from '@/lib/supabase';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import IntegrationsSection from '@/components/IntegrationsSection';

/** หน้าต่าง "เชื่อมต่อ" - แยกจากหน้าออฟฟิศ เพราะเป็นเรื่องของนักพัฒนา/ระบบภายนอก ไม่ใช่การเลือกออฟฟิศ */
export default function IntegrationsPanel({ open, onClose, office, onPolicy }: { open: boolean; onClose: () => void; office: Office | null; onPolicy?: (p: 'any' | 'local') => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<Plug />}
        title="เชื่อมต่อ MCP / API / LINE"
        description={office ? `ให้ระบบภายนอกถามออฟฟิศ "${office.name}" ได้ - agent ของเรา (internal) หรือช่องทางลูกค้า (public)` : 'เลือกออฟฟิศก่อน'}
        wide
      >
        {office ? <IntegrationsSection office={office} onPolicy={onPolicy} /> : null}
      </DialogContent>
    </Dialog>
  );
}
