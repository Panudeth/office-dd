# ตัวอย่างฝั่งผู้ใช้: บิล GCP → Webhook เข้าของแผนก

> **นี่ไม่ใช่ส่วนของ office** — office แค่ให้ webhook (`POST /api/office/inbox/<deptId>` + token ต่อแหล่ง)
> ใครจะเอาข้อมูลจากไหนมาส่ง (GCP, AWS, Sentry, CRM, cron, n8n, Make, Zapier) เป็นเรื่องของฝั่งผู้ใช้
> โฟลเดอร์นี้คือตัวอย่างหนึ่ง: ดึงสรุปบิลจาก BigQuery Billing export แล้ว POST เข้าแผนก

## ต้องมีก่อน
1. เปิด **Cloud Billing → Billing export → BigQuery export → Standard usage cost** ชี้ไป dataset ของคุณ (ทำใน Console ครั้งเดียว - Google ไม่มี API ให้ตั้ง) รอ ~24 ชม. จะมีตาราง `gcp_billing_export_v1_<BILLING_ID>`
2. บัญชี/service account ที่รันมี `BigQuery Data Viewer` บน dataset + `BigQuery Job User` บนโปรเจกต์
3. ในออฟฟิศ: แผนกที่จะรายงาน (จ้างอย่างน้อย 1 คน) → แท็บ *Webhook เข้า* → token ชื่อ `gcp-billing` → แท็บ *ส่งออก* → ช่อง Teams/Slack/LINE ที่ติ๊ก `gcp-billing`

## ตั้งค่า
ตัวแปร (env หรือใส่ใน `.env` ของโปรเจกต์นี้):
```
GCP_PROJECT=<โปรเจกต์ที่ใช้รัน query>
BQ_TABLE=<โปรเจกต์>.<dataset>.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX
OFFICE_INBOX_URL=https://<โดเมน office>/api/office/inbox/<deptId>
OFFICE_INBOX_TOKEN=vc_...
ALERT_PCT=20        # แจ้งรายการที่พุ่งเกิน % นี้
MONTH=2026-07       # ไม่ใส่ = เดือนปัจจุบัน
GOOGLE_ACCESS_TOKEN=  # ไม่ใส่ = ใช้ `gcloud auth print-access-token`
```

## รัน
```
node examples/gcp-billing/gcp-billing-inbox.mjs
```
สิ่งที่ส่งเข้าแผนก: ยอดรวมเดือนนี้เทียบเดือนก่อน, ต่อโปรเจกต์ (แตกย่อยรายบริการ), รายการที่พุ่ง, พร้อม `ask` ให้แผนกสรุปให้ผู้บริหาร — มี `idempotencyKey` ต่อวัน ยิงซ้ำไม่เปิดงานซ้ำ

## ตั้งเวลา (เลือกทางใดทางหนึ่ง)
- **Windows**: `run.cmd` (อ่าน URL/token จาก `.env`, ตั้ง GCP_PROJECT/BQ_TABLE ในไฟล์) + Task Scheduler รายวัน
- **GitHub Actions**: workflow `schedule: - cron: '0 1 * * *'` → `google-github-actions/auth` (Workload Identity) → `run: node examples/gcp-billing/gcp-billing-inbox.mjs` โดยใส่ตัวแปรเป็น secrets
- **Cloud Scheduler → Cloud Run Job** ที่มีสคริปต์นี้ + service account
