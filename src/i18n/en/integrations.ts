/** คำแปลอังกฤษ - แผงเชื่อมต่อ (IntegrationsPanel / IntegrationsSection) - key = ไทยต้นฉบับ */
const d: Record<string, string> = {
  // IntegrationsPanel
  'แผนก': 'Departments',
  'Webhook เข้าของออฟฟิศ (token / LINE OA)': 'Office inbound webhooks (token / LINE OA)',
  'โมเดล / นโยบาย': 'Model / policy',
  'เลือกออฟฟิศก่อน (โหมดในเครื่องไม่มี webhook/การเชื่อมต่อ)': 'Choose an office first (local mode has no webhooks or integrations)',
  'แผนก & การเชื่อมต่อ': 'Departments & integrations',
  'ออฟฟิศ "{name}"': 'Office "{name}"',
  'เลือกออฟฟิศก่อน': 'Choose an office first',

  // IntegrationsSection - header
  'บัตรผ่านขาเข้าของออฟฟิศ - ใครยิงเข้ามาได้บ้าง': 'Office inbound passes - who can call in',
  'ที่นี่ = สร้าง "บัตรผ่าน" ให้ระบบข้างนอกยิงเข้าออฟฟิศ ทำครั้งเดียว ใช้ได้หลายแผนก (ต่างจากในหน้าแผนกที่แค่ติ๊กว่าแผนกนั้นรับจากบัตรไหน) · webhook เข้า = ระบบยิงข้อมูลให้แผนกที่เลือก · internal = agent ของเราเอง ถามทุกแผนก/ประชุม/อ่านสมุด (MCP/API) · public = ช่องทางลูกค้า ได้เฉพาะคำตอบที่กรองแล้ว · LINE OA = ลูกค้าทัก LINE แล้วแผนกที่เลือกตอบ · token โชว์ครั้งเดียว เก็บเหมือนรหัสผ่าน':
    'This is where you create a "pass" so outside systems can call into the office - create it once, use it across departments (the department page only ticks which passes that department accepts) · inbound webhook = a system pushes data to the selected departments · internal = our own agent, can ask any department, hold meetings, read the notebook (MCP/API) · public = customer channel, gets filtered answers only · LINE OA = customers message on LINE and the selected department replies · the token is shown once, keep it like a password',
  'กำลังโหลด': 'Loading',
  'ยังไม่มี token': 'No tokens yet',
  'public - ลูกค้า': 'public - customers',
  'webhook เข้า': 'inbound webhook',
  'internal - ทีมเรา': 'internal - our team',
  '→ แผนก:': '→ Departments:',
  'ใช้ล่าสุด {time}': 'Last used {time}',
  'ยังไม่เคยใช้': 'Never used',
  'เพิกถอน': 'Revoke',

  // department short names (d.shortTh)
  'กฎหมาย': 'Legal',
  'การเงิน': 'Finance',
  'วิศวกรรม': 'Engineering',
  'บุคคล': 'People',
  'การตลาด': 'Marketing',
  'ประชาสัมพันธ์': 'PR',
  'ฝ่ายกฎหมาย': 'Legal',
  'ฝ่ายการเงิน': 'Finance',
  'ฝ่ายวิศวกรรม': 'Engineering',
  'ฝ่ายบุคคล': 'People',
  'ฝ่ายการตลาด': 'Marketing',
  'ฝ่ายประชาสัมพันธ์': 'Public Relations',

  // create token
  'ชื่อระบบที่จะยิงเข้า เช่น gcp-billing': 'Name of the calling system, e.g. gcp-billing',
  'ชื่อ token เช่น Claude Code / LINE bot': 'Token name, e.g. Claude Code / LINE bot',
  'webhook เข้า - ระบบยิงข้อมูลให้แผนก': 'inbound webhook - a system pushes data to departments',
  'internal - agent ของเรา (MCP/API)': 'internal - our agent (MCP/API)',
  'public - ช่องทางลูกค้า': 'public - customer channel',
  'พิมพ์ชื่อระบบก่อน': 'Enter the system name first',
  'เลือกแผนกที่จะรับอย่างน้อย 1': 'Select at least 1 receiving department',
  'สร้าง token': 'Create token',
  'แผนกที่รับ:': 'Receiving departments:',
  'ระบบนี้ยิงเข้าแผนกไหนได้บ้าง - เปลี่ยนทีหลังได้ทั้งที่นี่และในหน้าแผนก (แท็บ "ขาเข้า" ติ๊กรับ) · URL ที่ระบบต้องยิง:':
    'Which departments this system can push to - change it later here or on the department page (tick it under the "Inbound" tab) · URL the system must call:',
  '{what} แล้วปุ่ม "สร้าง token" จะกดได้': '{what} to enable the "Create token" button',
  'พิมพ์ชื่อระบบ': 'Enter the system name',
  'เลือกแผนกที่รับอย่างน้อย 1': 'Select at least 1 receiving department',
  'token ใหม่ - คัดลอกตอนนี้ จะไม่โชว์อีก': 'New token - copy it now, it will not be shown again',
  'คัดลอก': 'Copy',

  // how-to MCP / API / LINE
  'วิธีต่อ MCP (Claude Code / pugbase / อื่น ๆ)': 'How to connect via MCP (Claude Code / pugbase / others)',
  'เร็ว': 'fast',
  'ประชุม': 'Meeting',
  'เท่านั้น - PR ตอบจากข้อมูลสาธารณะ ถ้าต้องปรึกษาทีมจะเปิดประชุมภายในเองแล้วกรองคำตอบให้':
    'only - PR answers from public information; if it needs the team it holds an internal meeting and filters the answer',
  'วิธีต่อ API ตรง / LINE': 'How to connect via direct API / LINE',
  'ตั้งจากหน้าเว็บ -': 'set up from the web page -',
  'แผนก & Webhook': 'Departments & Webhooks',
  'เลือกแผนกที่ตอบลูกค้า': 'pick the department that answers customers',
  'แท็บ': 'tab',
  'Webhook เข้า': 'Inbound webhooks',
  'เพิ่ม LINE OA': 'Add LINE OA',
  'ได้ URL': 'you get the URL',
  'ไปวางใน LINE console': 'to paste into the LINE console',
  'ลูกค้าเห็นเฉพาะข้อมูลที่ติดว่าเปิดเผยได้': 'customers only see information marked as public',

  // settings - model policy
  'นโยบายโมเดลของออฟฟิศ': 'Office model policy',
  'ทุกผู้ให้บริการ': 'Any provider',
  '= ใช้คีย์ Claude/Gemini/OpenAI-compatible ได้ตามที่ตั้งใน "คีย์ของฉัน"': '= Claude / Gemini / OpenAI-compatible keys as configured in "My keys"',
  'เฉพาะโมเดลในเครื่อง/LAN': 'Local / LAN models only',
  '= เซิร์ฟเวอร์ปฏิเสธทุกคำขอที่ชุดคีย์ไม่ได้ชี้ไป localhost / IP วง LAN / .local (Ollama, LM Studio) ครอบทั้งประชุมจากหน้าเว็บ MCP/API/LINE webhook เข้า และการฝังเอกสาร - ข้อมูลบริษัทไม่ออกจากเครื่องแม้ใครจะใส่คีย์ข้างนอกมา':
    '= the server rejects any request whose key set does not point to localhost / a LAN IP / .local (Ollama, LM Studio). Covers meetings from the web page, MCP/API/LINE inbound webhooks, and document embedding - company data never leaves the machine even if someone adds an external key',
  'เจ้าของออฟฟิศเท่านั้นที่เปลี่ยนได้': 'Only the office owner can change this',
  'เปิดอยู่ - คำขอที่ใช้คีย์ข้างนอกจะถูกปฏิเสธพร้อมข้อความบอกให้เปลี่ยนชุดคีย์': 'Enabled - requests using an external key are rejected with a message asking to switch key sets',

  // settings - server-side model
  'โมเดลที่ MCP / API / LINE ใช้': 'Model used by MCP / API / LINE',
  'รีเฟรช': 'Refresh',
  'ใช้ชุดคีย์ที่ sync จาก "คีย์ของฉัน"': 'Using the key set synced from "My keys"',
  'อัปเดต {time}': 'updated {time}',
  'ใช้ชุดคีย์/โมเดลรายคนตามที่ตั้งใน "คีย์ของฉัน" และแผงพนักงาน sync อัตโนมัติจากเบราว์เซอร์ของเจ้าของ/exec และเข้ารหัสก่อนบันทึกลงฐานข้อมูล':
    'Uses the per-person key set / model configured in "My keys" and the staff panel, synced automatically from the owner/exec browser and encrypted before it is stored in the database',
  'ไม่มีคีย์': 'no key',
  'ลบออกจากเซิร์ฟเวอร์ (กลับไปใช้ .env)': 'Remove from server (fall back to .env)',
  'ยังไม่มีชุดคีย์บนเซิร์ฟเวอร์ - ใช้ค่าจาก': 'No key set on the server yet - using values from',
  'ตอนนี้ MCP/API/LINE ใช้ค่าจาก': 'MCP/API/LINE currently use values from',
  '(LLM_PROVIDER, OPENAI_BASE_URL, OPENAI_MODEL) เพิ่มชุดคีย์ใน "คีย์ของฉัน" แล้วระบบจะ sync ให้อัตโนมัติ (เฉพาะเจ้าของ/exec)':
    '(LLM_PROVIDER, OPENAI_BASE_URL, OPENAI_MODEL). Add a key set in "My keys" and it syncs automatically (owner/exec only)',
};
export default d;
