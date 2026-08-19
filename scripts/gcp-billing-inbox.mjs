#!/usr/bin/env node
/**
 * ดึงสรุปบิล GCP จาก BigQuery (Billing export) แล้วยิงเข้า Webhook เข้าของแผนก
 * ไม่ต้องลง npm - ใช้ REST ของ BigQuery + access token จาก gcloud (หรือ GOOGLE_ACCESS_TOKEN)
 *
 *   ต้องเปิด Billing export -> BigQuery (Standard usage cost) ก่อน  ดู README หัวข้อ "บิล GCP -> แผนก"
 *
 *   ตัวแปร:
 *     GCP_PROJECT=my-proj                          โปรเจกต์ที่ใช้รัน query (คิดค่า BigQuery ที่นี่ - export table อยู่โปรเจกต์ไหนก็ได้)
 *     BQ_TABLE=my-proj.billing.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX   ตาราง export (ดูชื่อใน BigQuery)
 *     OFFICE_INBOX_URL=https://<โดเมน>/api/office/inbox/finance             URL ของแผนก (แท็บ Webhook เข้า)
 *     OFFICE_INBOX_TOKEN=vc_...                                              token ชื่อ "gcp-billing" ของแผนกนั้น
 *     MONTH=2026-07        (ไม่ใส่ = เดือนปัจจุบัน)   ALERT_PCT=20  (แจ้งรายการที่พุ่งเกิน % นี้)   WAIT=0
 *     GOOGLE_ACCESS_TOKEN= (ไม่ใส่ = เรียก `gcloud auth print-access-token` ให้)
 *
 *   node scripts/gcp-billing-inbox.mjs
 */
import { execSync } from 'node:child_process';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const need = (k) => { const v = env(k); if (!v) { console.error(`ตั้ง ${k} ก่อน`); process.exit(1); } return v; };

const project = need('GCP_PROJECT');
const table = need('BQ_TABLE');
const inboxUrl = need('OFFICE_INBOX_URL');
const inboxToken = need('OFFICE_INBOX_TOKEN');
const alertPct = Number(env('ALERT_PCT', '20')) || 20;
const wait = Number(env('WAIT', '0')) || 0;

const now = new Date();
const cur = env('MONTH') || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const [cy, cm] = cur.split('-').map(Number);
const prevD = new Date(Date.UTC(cy, cm - 2, 1));
const prev = `${prevD.getUTCFullYear()}-${String(prevD.getUTCMonth() + 1).padStart(2, '0')}`;
const inv = (m) => m.replace('-', ''); // invoice.month เป็น '202607'

const accessToken = env('GOOGLE_ACCESS_TOKEN') || execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

// ต้นทุนสุทธิ = cost + credits (credits เป็นค่าลบ) แยกตามบริการ/โปรเจกต์ ทั้งเดือนนี้และเดือนก่อน
const sql = `
SELECT invoice.month AS month,
       service.description AS service,
       project.id AS project,
       ROUND(SUM(cost), 2) AS cost,
       ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS credits,
       ANY_VALUE(currency) AS currency
FROM \`${table}\`
WHERE invoice.month IN ('${inv(cur)}', '${inv(prev)}')
GROUP BY 1, 2, 3`;

const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 60000, maxResults: 5000 }),
});
const q = await res.json();
if (!res.ok) { console.error('BigQuery error:', JSON.stringify(q, null, 2)); process.exit(1); }
if (!q.jobComplete) { console.error('query ยังไม่เสร็จใน 60 วิ - ลองใหม่'); process.exit(1); }
const cols = (q.schema?.fields ?? []).map((f) => f.name);
const rows = (q.rows ?? []).map((r) => Object.fromEntries(r.f.map((c, i) => [cols[i], c.v])));

const num = (v) => Number(v ?? 0) || 0;
const sumBy = (month, key) => {
  const m = new Map();
  for (const r of rows) {
    if (r.month !== inv(month)) continue;
    const k = r[key] ?? '(none)';
    m.set(k, (m.get(k) ?? 0) + num(r.cost) + num(r.credits));
  }
  return m;
};
const total = (month) => [...sumBy(month, 'service').values()].reduce((a, b) => a + b, 0);
const currency = rows.find((r) => r.currency)?.currency ?? 'USD';
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);

const svcCur = sumBy(cur, 'service'), svcPrev = sumBy(prev, 'service');
const byService = [...svcCur.entries()].map(([service, cost]) => ({
  service, cost: r2(cost), prevMonth: r2(svcPrev.get(service) ?? 0), changePct: pct(cost, svcPrev.get(service) ?? 0),
})).sort((a, b) => b.cost - a.cost);
const projCur = sumBy(cur, 'project'), projPrev = sumBy(prev, 'project');
const byProject = [...projCur.entries()].map(([project, cost]) => ({
  project, cost: r2(cost), prevMonth: r2(projPrev.get(project) ?? 0), changePct: pct(cost, projPrev.get(project) ?? 0),
})).sort((a, b) => b.cost - a.cost);
const spikes = byService.filter((s) => s.changePct >= alertPct && s.cost >= 1);

const payload = {
  title: `บิล GCP เดือน ${cur}`,
  source: 'gcp-billing',
  intent: 'task',
  ask: `สรุปค่าใช้จ่าย GCP เดือน ${cur} ให้ผู้บริหาร: ยอดรวมเทียบเดือน ${prev} (เปลี่ยนกี่ %) บริการ/โปรเจกต์ที่กินมากสุด 5 อันดับ ` +
    `รายการที่พุ่งเกิน ${alertPct}% (ถ้ามีให้ขึ้นบรรทัดแรกว่าต้องดู) และเสนอจุดที่น่าจะประหยัดได้ 3 ข้อ ตอบสั้นอ่านในแชทได้จบ`,
  idempotencyKey: `gcp-billing-${cur}-${now.toISOString().slice(0, 10)}`,
  wait,
  data: {
    currency, month: cur, prevMonth: prev,
    total: r2(total(cur)), prevTotal: r2(total(prev)), changePct: pct(total(cur), total(prev)),
    note: cur === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` ? `เดือนปัจจุบันยังไม่จบ - ข้อมูลถึงวันที่ ${now.toISOString().slice(0, 10)}` : 'เดือนเต็ม',
    alertPct, spikes,
    byService: byService.slice(0, 25),
    byProject: byProject.slice(0, 15),
  },
};

const out = await fetch(inboxUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inboxToken}` },
  body: JSON.stringify(payload),
});
const body = await out.json().catch(() => ({}));
console.log(`GCP ${cur}: รวม ${payload.data.total} ${currency} (เดือนก่อน ${payload.data.prevTotal}, ${payload.data.changePct}%) พุ่ง ${spikes.length} รายการ`);
console.log(out.status, JSON.stringify(body, null, 2));
if (!out.ok) process.exit(1);
