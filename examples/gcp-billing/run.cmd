@echo off
REM ยิงสรุปบิล GCP เข้า Webhook เข้าของแผนก
REM ใช้ครั้งแรก: ตั้ง 2 ค่าใน .env ก่อน
REM   OFFICE_INBOX_URL=http://localhost:3210/api/office/inbox/<deptId>     (แท็บ Webhook เข้า ของแผนก)
REM   OFFICE_INBOX_TOKEN=vc_...                                            (token ชื่อ gcp-billing ของแผนกนั้น)
REM รัน: scripts\gcp-billing.cmd            (เดือนปัจจุบัน)
REM      scripts\gcp-billing.cmd 2026-07    (ระบุเดือน)
setlocal
cd /d "%~dp0..\.."
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /r "^OFFICE_INBOX_URL= ^OFFICE_INBOX_TOKEN= ^GCP_PROJECT= ^BQ_TABLE= ^ALERT_PCT=" .env`) do set "%%A=%%B"
if "%OFFICE_INBOX_URL%"=="" ( echo ตั้ง OFFICE_INBOX_URL ใน .env ก่อน & exit /b 1 )
if "%OFFICE_INBOX_TOKEN%"=="" ( echo ตั้ง OFFICE_INBOX_TOKEN ใน .env ก่อน & exit /b 1 )
if "%GCP_PROJECT%"=="" ( echo ตั้ง GCP_PROJECT ใน .env ก่อน ^(โปรเจกต์ที่ตาราง billing export อยู่^) & exit /b 1 )
if "%BQ_TABLE%"=="" ( echo ตั้ง BQ_TABLE ใน .env ก่อน ^(เช่น myproj.gcp_billing.gcp_billing_export_v1_XXXX^) & exit /b 1 )
if "%ALERT_PCT%"=="" set ALERT_PCT=20
if not "%~1"=="" set MONTH=%~1
node examples\gcp-billing\gcp-billing-inbox.mjs
endlocal
