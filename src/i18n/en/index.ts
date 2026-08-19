/**
 * คำแปลอังกฤษ แยกไฟล์ตามส่วนของแอป - key = ข้อความไทยต้นฉบับ (ดู src/lib/i18n.ts)
 * เพิ่มไฟล์ใหม่: สร้าง src/i18n/en/<area>.ts export default Record<string,string> แล้ว import มารวมตรงนี้
 */
import common from './common';
import page from './page';
import hire from './hire';
import key from './key';
import office from './office';
import department from './department';
import integrations from './integrations';
import company from './company';
import chat from './chat';
import layout from './layout';
import game from './game';
import misc from './misc';

export const EN: Record<string, string> = {
  ...common, ...page, ...hire, ...key, ...office, ...department, ...integrations, ...company, ...chat, ...layout, ...game, ...misc,
};
