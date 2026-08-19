import 'server-only';
import { mergeDepartments, sanitizeDeptDefs, type Department, type DepartmentDef } from '@/lib/departments';
import { sbAdmin } from '@/lib/supabase-admin';

/* ============================================================
   แผนกของออฟฟิศฝั่งเซิร์ฟเวอร์ - งานที่ไม่มีเบราว์เซอร์ (MCP / LINE / API / inbox)
   โหลด office_department ด้วย secret key แล้วประกอบกับ preset (id ซ้ำ = ทับ, id ใหม่ = แผนกใหม่)
   ============================================================ */

/** แถว office_department ของออฟฟิศเป็น DepartmentDef (ล้างแล้ว) - [] ถ้าไม่มี/ตารางยังไม่มี */
export async function loadOfficeDeptDefs(officeId: string): Promise<DepartmentDef[]> {
  const c = sbAdmin();
  if (!c) return [];
  const { data, error } = await c.from('office_department').select('*').eq('office_id', officeId).order('sort_order').order('updated_at');
  if (error || !data) return [];
  return sanitizeDeptDefs((data as Record<string, unknown>[]).map((r) => ({
    id: r.id, nameTh: r.name_th, shortTh: r.short_th, color: r.color, description: r.description,
    keywords: r.keywords, lenses: r.lenses, skillText: r.skill_md, playbook: r.playbook,
  })));
}

/** preset + แผนกของออฟฟิศ - รายการเต็มที่เซิร์ฟเวอร์ใช้ต่อคำขอ */
export async function loadOfficeDepartments(officeId: string): Promise<{ list: Department[]; byId: Map<string, Department>; custom: DepartmentDef[] }> {
  const custom = await loadOfficeDeptDefs(officeId);
  const list = mergeDepartments(custom);
  return { list, byId: new Map(list.map((d) => [d.id, d])), custom };
}
