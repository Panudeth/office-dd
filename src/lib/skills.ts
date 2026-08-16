import fs from 'node:fs/promises';
import path from 'node:path';

export interface LoadedSkill {
  id: string;
  /** path แบบสัมพัทธ์ที่เอาไปโชว์ให้ผู้ใช้ตรวจได้ */
  file: string;
  text: string;
  bytes: number;
  /** true = อ่านไฟล์ไม่เจอ กำลังใช้ข้อความสำรอง */
  missing: boolean;
}

const cache = new Map<string, { mtimeMs: number; skill: LoadedSkill }>();

/**
 * โหลด skills/<id>.md — นี่คือ "การเรียน skill" ของ agent
 * เกิดขึ้น **ตอนถามคำถาม** ไม่ใช่ตอนกดจ้าง เนื้อไฟล์จะถูกวางไว้ต้น system prompt
 * ของทุกคอลในรอบนั้น (agent ไม่มี state ค้างระหว่างคำถาม)
 *
 * cache ผูกกับ mtime ของไฟล์ — แก้ .md แล้วเห็นผลทันที ไม่ต้องรีสตาร์ท dev server
 */
export async function loadSkill(id: string): Promise<LoadedSkill> {
  const safe = id.replace(/[^a-z0-9_-]/gi, '');
  const rel = path.join('skills', `${safe}.md`);
  const file = path.join(process.cwd(), rel);

  try {
    const stat = await fs.stat(file);
    const hit = cache.get(safe);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.skill;

    const text = await fs.readFile(file, 'utf8');
    const skill: LoadedSkill = {
      id: safe,
      file: rel.replace(/\\/g, '/'),
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      missing: false,
    };
    cache.set(safe, { mtimeMs: stat.mtimeMs, skill });
    return skill;
  } catch {
    const text = `# Skill: ${safe}\n\nคุณเป็นพนักงานผู้เชี่ยวชาญด้าน ${safe} ตอบเป็นภาษาไทย กระชับ ตรงประเด็น`;
    return {
      id: safe,
      file: rel.replace(/\\/g, '/'),
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      missing: true,
    };
  }
}

export async function listSkills(): Promise<string[]> {
  try {
    const dir = await fs.readdir(path.join(process.cwd(), 'skills'));
    return dir.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}
