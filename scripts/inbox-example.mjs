#!/usr/bin/env node
/**
 * ตัวอย่างยิงข้อมูลเข้า "Webhook เข้า" ของแผนก - ใช้เป็นต้นแบบให้ cron/CI/n8n ของคุณ
 * ไม่ต้องห่อรูปแบบพิเศษ: ยิง JSON อะไรก็ได้ แผนกจะอ่านตาม playbook แล้วรายงาน + ส่งออกไป Teams/Slack/LINE ที่ผูกไว้
 *
 *   OFFICE_INBOX_TOKEN=vc_xxx node scripts/inbox-example.mjs <deptId> [base] [--wait 120]
 *   เช่น  OFFICE_INBOX_TOKEN=vc_xxx node scripts/inbox-example.mjs finance http://localhost:3210 --wait 120
 *
 * token สร้างจากหน้าออฟฟิศ -> แผนก -> แท็บ "Webhook เข้า" (scope inbox ผูกกับแผนกนั้น)
 * ตัวอย่างข้างล่างจำลอง "สรุปบิล GCP รายเดือน" - แทนที่ด้วยผล query จริงจาก BigQuery billing export ได้เลย
 */
const [deptId = 'finance', baseArg = 'http://localhost:3210'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const waitIdx = process.argv.indexOf('--wait');
const wait = waitIdx > 0 ? Number(process.argv[waitIdx + 1] ?? 60) : 0;
const token = process.env.OFFICE_INBOX_TOKEN;
if (!token) { console.error('ตั้ง OFFICE_INBOX_TOKEN=vc_... ก่อน (สร้างจากแท็บ Webhook เข้า ของแผนก)'); process.exit(1); }
const base = baseArg.replace(/\/$/, '');

const month = new Date().toISOString().slice(0, 7);
const payload = {
  title: `บิล GCP เดือน ${month}`,
  source: 'gcp-billing-export',
  intent: 'task',
  ask: 'สรุปค่าใช้จ่ายรวม แยกตามบริการ เทียบกับเดือนก่อน (ถ้ามีในเอกสารของแผนก) ชี้รายการที่พุ่งเกิน 20% และเสนอจุดที่ประหยัดได้ 3 ข้อ',
  idempotencyKey: `gcp-${month}`,
  wait,
  data: {
    currency: 'THB',
    period: month,
    total: 48210.55,
    byService: [
      { service: 'Compute Engine', cost: 21850.1, prevMonth: 17420.0 },
      { service: 'Cloud SQL', cost: 12300.0, prevMonth: 12100.0 },
      { service: 'Cloud Storage', cost: 5320.45, prevMonth: 5100.2 },
      { service: 'BigQuery', cost: 6140.0, prevMonth: 2900.0 },
      { service: 'Networking', cost: 2600.0, prevMonth: 2450.0 },
    ],
    topProjects: [{ project: 'prod-api', cost: 30100 }, { project: 'data-lake', cost: 12800 }, { project: 'staging', cost: 5310.55 }],
  },
};

const res = await fetch(`${base}/api/office/inbox/${deptId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
const body = await res.json().catch(() => ({}));
console.log(res.status, JSON.stringify(body, null, 2));
if (res.status === 202) console.log(`\nงานเดินต่อฝั่งเซิร์ฟเวอร์ - ดูผล: curl -H "Authorization: Bearer $OFFICE_INBOX_TOKEN" "${base}${body.poll}"`);
