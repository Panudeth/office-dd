#!/usr/bin/env node
/**
 * ยิง webhook ของ LINE "ปลอม" เข้าเซิร์ฟเวอร์เรา - เซ็น x-line-signature ด้วย LINE_CHANNEL_SECRET จริงจาก .env
 * ใช้ทดสอบฝั่งเรา (ลายเซ็น -> PR ตอบ -> พยายาม push) โดยไม่ต้องรอให้ LINE ยิงมา
 * ถ้า token ยังไม่ถูก จะเห็น "[line] reply 401" ใน log ของ dev server = ฝั่งเราทำงาน แต่ส่งเข้า LINE ไม่ได้ (คาดไว้แล้ว)
 *
 *   node scripts/line-webhook-test.mjs "ร้านเปิดกี่โมง"
 *   node scripts/line-webhook-test.mjs "ราคาเท่าไร" http://localhost:3210
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = {};
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ไม่มีไฟล์ */ }
}

const text = process.argv[2] ?? 'สวัสดีค่ะ อยากทราบว่าบริษัททำอะไรบ้าง';
const base = (process.argv[3] ?? 'http://localhost:3210').replace(/\/$/, '');
const secret = process.env.LINE_CHANNEL_SECRET ?? env.LINE_CHANNEL_SECRET;
if (!secret) {
  console.error('ยังไม่มี LINE_CHANNEL_SECRET ใน .env - เอาจาก LINE Developers > Basic settings > Channel secret');
  process.exit(1);
}

const body = JSON.stringify({
  destination: 'Uxxxxxxxx',
  events: [{
    type: 'message', mode: 'active', timestamp: 0, webhookEventId: 'test',
    replyToken: 'test-reply-token',
    source: { type: 'user', userId: 'Utest0000000000000000000000000000' },
    message: { id: '1', type: 'text', text },
  }],
});
const sig = createHmac('sha256', secret).update(body).digest('base64');

console.log(`POST ${base}/api/line/webhook  ("${text}")`);
const res = await fetch(`${base}/api/line/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
  body,
});
console.log(res.status, await res.text());
console.log('-> ดู log ของ dev server: ควรเห็นหัวหน้า PR ลุกไปตอบ และ "[line] push ..." (401 ถ้า token ยังไม่ถูก)');
