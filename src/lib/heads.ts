/**
 * หัวหน้าแผนก = คนแรกที่จ้างเข้าแผนกนั้น (ลำดับใน roster คือลำดับจ้าง ทั้งในเครื่องและจาก DB ที่ order by hired_at)
 * ไม่เก็บเป็น flag เพราะไล่ออกทีไรก็ต้องเลื่อนตำแหน่ง - คำนวณเอาจากลำดับตรงกว่าและไม่มีทางค้าง
 *
 * หัวหน้าทำสองอย่าง: ถกในรอบปกติเหมือนคนอื่น (บทบาทผู้เสนอ) และเป็นประธานที่ประชุมได้
 * โมเดล "หัวหน้าแผนก" ใน KeyPanel ใช้กับหัวหน้าทุกคนทุกรอบ ไม่ใช่เฉพาะตอนสรุป
 */
export function deptHeadIds<T extends { id: string; deptId: string }>(roster: T[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of roster) if (!m.has(r.deptId)) m.set(r.deptId, r.id);
  return m;
}

export function isDeptHead<T extends { id: string; deptId: string }>(roster: T[], id: string): boolean {
  const r = roster.find((x) => x.id === id);
  return !!r && deptHeadIds(roster).get(r.deptId) === id;
}
