-- Visual Company — schema เฟส 1 (Auth + Create My Office + พนักงานไม่หาย)
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งไฟล์นี้ → Run
-- รันซ้ำได้ ไม่พัง (idempotent)

-- ============================================================
-- ตาราง
-- ============================================================

create table if not exists public.office (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now()
);

create table if not exists public.office_member (
  office_id   uuid not null references public.office(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'exec' check (role in ('owner', 'exec', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (office_id, user_id)
);

create table if not exists public.employee (
  id          uuid primary key,
  office_id   uuid not null references public.office(id) on delete cascade,
  name        text not null,
  title       text not null,
  dept_id     text not null,
  role        text not null,
  -- สีตัวละคร เก็บไว้เพื่อให้หน้าตาเหมือนเดิมหลังรีเฟรช
  palette     jsonb not null,
  -- ที่นั่งประจำโต๊ะ {x, y}
  seat        jsonb not null,
  hired_at    timestamptz not null default now()
);

-- บันทึกการประชุมที่เลขานุการเก็บไว้ - ผู้ใช้เปิดดูย้อนหลังได้จากไอคอนเลขาฯ บนแถบบน
create table if not exists public.meeting (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.office(id) on delete cascade,
  -- ใครถาม - set null เมื่อบัญชีถูกลบ จะได้ไม่ลบบันทึกของทั้งออฟฟิศทิ้งไปด้วย
  asked_by    uuid references auth.users(id) on delete set null,
  question    text not null,
  mode        text not null check (mode in ('roundtable', 'relay', 'direct')),
  owner_dept  text not null,
  -- แผนกที่เข้าประชุมจริง เก็บแยกไว้เพื่อกรองรายการได้โดยไม่ต้องแกะ jsonb
  dept_ids    text[] not null default '{}',
  -- รายชื่อผู้เข้าประชุม {id,name,title,deptId,palette} เก็บสำเนาไว้
  -- เพราะพนักงานอาจถูกเลิกจ้างไปแล้วแต่บันทึกการประชุมต้องยังอ่านออก
  attendees   jsonb not null default '[]',
  summary     text not null default '',
  transcript  jsonb not null default '[]',
  consults    jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

-- ตารางที่สร้างไว้ก่อนหน้ามี constraint แค่สองโหมด - เปลี่ยนให้รับ direct ด้วย
alter table public.meeting drop constraint if exists meeting_mode_check;
alter table public.meeting add constraint meeting_mode_check check (mode in ('roundtable', 'relay', 'direct'));
-- รายงานการประชุมที่เลขาฯ เขียน (เป็นกลาง คนละคนกับประธานที่เขียน summary) - ตารางเก่าไม่มีคอลัมน์นี้
alter table public.meeting add column if not exists minutes text not null default '';

-- ============================================================
-- การประชุมแบบ "สด" - engine รันฝั่ง server แล้วเขียน event ลง DB
-- เบราว์เซอร์ทุกจอ (และระบบภายนอกที่เรียกผ่าน API/MCP/LINE) เห็นการประชุมเดียวกัน
-- ============================================================

-- สถานะ + ใครเป็นประธาน + เรียกจากไหน  (ค่าเริ่มต้น done เพื่อให้แถวเก่าที่บันทึกตอนจบยังถูกต้อง)
alter table public.meeting add column if not exists status text not null default 'done';
alter table public.meeting drop constraint if exists meeting_status_check;
alter table public.meeting add constraint meeting_status_check check (status in ('running', 'done', 'error'));
alter table public.meeting add column if not exists chair_id text;
alter table public.meeting add column if not exists source text not null default 'web';
alter table public.meeting add column if not exists error text;
alter table public.meeting add column if not exists updated_at timestamptz not null default now();
-- ใครถาม: internal (คนใน/agent ของเรา) หรือ customer (ลูกค้าผ่าน LINE/ช่องทางสาธารณะ)
-- คำถามจากลูกค้า: บทถกภายในอยู่ในสมุดเหมือนเดิม แต่ลูกค้าได้เฉพาะ customer_reply ที่ PR กรองแล้ว
alter table public.meeting add column if not exists audience text not null default 'internal';
alter table public.meeting drop constraint if exists meeting_audience_check;
alter table public.meeting add constraint meeting_audience_check check (audience in ('internal', 'customer'));
alter table public.meeting add column if not exists customer_reply text not null default '';

-- event ของการประชุม เรียงตาม seq - ตัวเดียวกับที่ส่งทาง SSE ให้เบราว์เซอร์
create table if not exists public.meeting_event (
  id          bigserial primary key,
  meeting_id  uuid not null references public.meeting(id) on delete cascade,
  office_id   uuid not null references public.office(id) on delete cascade,
  seq         int not null,
  type        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- token สำหรับเรียกออฟฟิศจากข้างนอกโดยไม่มีเบราว์เซอร์ (MCP / LINE / API)
-- เก็บเฉพาะ hash - token จริงโชว์ให้เห็นครั้งเดียวตอนสร้าง
create table if not exists public.office_token (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references public.office(id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
-- scope: internal = agent ของเรา (ถามทุกแผนก ประชุม อ่านสมุดได้)  public = ช่องทางลูกค้า (ถาม PR ได้อย่างเดียว ไม่เห็นสมุด)
alter table public.office_token add column if not exists scope text not null default 'internal';
-- ป้ายชื่อผู้ถามจากช่องทางภายนอก เช่น "สมชาย (LINE)" (asked_by เป็น uuid ผู้ใช้ในระบบ ใช้กับคนนอกไม่ได้)
alter table public.meeting add column if not exists asked_by_label text;
alter table public.office_token drop constraint if exists office_token_scope_check;
alter table public.office_token add constraint office_token_scope_check check (scope in ('internal', 'public'));

-- ============================================================
-- ข้อมูลบริษัท - สิ่งที่ agent ทุกตัวต้องรู้ก่อนตอบ (แยกจาก skill ที่เป็น "วิธีคิด")
-- ============================================================

-- โปรไฟล์กลาง หนึ่งแถวต่อออฟฟิศ - ทุกแผนกเห็นชุดเดียวกัน
create table if not exists public.office_profile (
  office_id    uuid primary key references public.office(id) on delete cascade,
  -- ฟิลด์มีโครง เก็บเป็น jsonb ให้เพิ่มหัวข้อได้โดยไม่ต้อง migrate
  -- {name, what, customers, revenue, size, entity, products, redlines, goals, problems, tone, contact}
  fields       jsonb not null default '{}',
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- โน้ตเฉพาะแผนก หนึ่งแถวต่อ (ออฟฟิศ, แผนก)
create table if not exists public.office_dept_note (
  office_id    uuid not null references public.office(id) on delete cascade,
  dept_id      text not null,
  body         text not null default '',
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (office_id, dept_id)
);

-- รายการสินค้า/บริการ - แยกเป็นแถวเพื่อให้แก้ทีละชิ้นได้ และ agent เห็นเป็นรายการชัด ๆ ไม่ใช่ย่อหน้าเดียว
create table if not exists public.office_product (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references public.office(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  -- ราคาเก็บเป็นข้อความ เพราะของจริงมักเป็นช่วง/ต่อหน่วย เช่น "990-2,990 บาท/เดือน" ไม่ใช่ตัวเลขเดียว
  price        text not null default '',
  note         text not null default '',
  sort_order   int not null default 0,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- เอกสารที่อัปโหลด (เฟส 3) - ไฟล์จริงอยู่ใน Storage bucket "docs" ที่ path <office_id>/<doc_id>/<name>
create table if not exists public.office_doc (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references public.office(id) on delete cascade,
  name         text not null,
  -- แผนกที่อ่านเอกสารนี้ได้ - ว่าง = ทุกแผนก
  dept_ids     text[] not null default '{}',
  bytes        int not null default 0,
  chunk_count  int not null default 0,
  status       text not null default 'ready' check (status in ('processing', 'ready', 'error')),
  error        text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
-- ชั้นข้อมูล: internal (ค่าเริ่มต้น - เฉพาะคนใน) / public (ลูกค้าถามผ่าน LINE/ช่องทางสาธารณะเห็นได้)
alter table public.office_doc add column if not exists visibility text not null default 'internal';
alter table public.office_doc drop constraint if exists office_doc_visibility_check;
alter table public.office_doc add constraint office_doc_visibility_check check (visibility in ('internal', 'public'));

-- pgvector สำหรับค้นชิ้นเอกสารตามความหมาย
create extension if not exists vector with schema extensions;

-- ชิ้นเอกสาร + embedding (768 มิติ = Gemini text-embedding-004 และ nomic-embed-text ของ Ollama)
create table if not exists public.office_doc_chunk (
  id           bigserial primary key,
  doc_id       uuid not null references public.office_doc(id) on delete cascade,
  office_id    uuid not null references public.office(id) on delete cascade,
  seq          int not null,
  content      text not null,
  embedding    extensions.vector(768),
  -- ตัวชี้ว่าเป็นโมเดล embedding ไหน - ห้ามเทียบ vector ข้ามโมเดล
  embed_model  text not null default ''
);

create index if not exists employee_office_idx on public.employee (office_id);
create index if not exists office_dept_note_office_idx on public.office_dept_note (office_id);
create index if not exists office_product_office_idx on public.office_product (office_id, sort_order);
create index if not exists office_doc_office_idx on public.office_doc (office_id, created_at desc);
create index if not exists office_doc_chunk_doc_idx on public.office_doc_chunk (doc_id, seq);
-- ivfflat ต้องมีข้อมูลก่อนถึงคุ้ม แต่สร้างไว้เลยไม่เสียหาย (ตารางเล็ก Postgres จะ seq scan เอง)
create index if not exists office_doc_chunk_embed_idx on public.office_doc_chunk
  using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 20);
create index if not exists office_member_user_idx on public.office_member (user_id);
create index if not exists meeting_office_idx on public.meeting (office_id, created_at desc);
create index if not exists meeting_event_meeting_idx on public.meeting_event (meeting_id, seq);
create index if not exists meeting_event_office_idx on public.meeting_event (office_id, created_at desc);
create index if not exists office_token_office_idx on public.office_token (office_id);

-- ============================================================
-- ผังเฟอร์นิเจอร์ของออฟฟิศ (จัดโต๊ะ/เก้าอี้/ของตกแต่งเองแบบ Stardew) - หนึ่งแถวต่อออฟฟิศ
-- data = { v, rev, items: [{ id, kind, x, y, dir?, v?, owner? }] } - owner = employee.id ที่นั่งโต๊ะนั้น
-- ทุกจอที่เปิดออฟฟิศเดียวกันเห็นตรงกันผ่าน Realtime
-- ============================================================
create table if not exists public.office_layout (
  office_id   uuid primary key references public.office(id) on delete cascade,
  data        jsonb not null default '{}',
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- ชุดคีย์/โมเดลของออฟฟิศ - สำเนาของ "คีย์ของฉัน" ในเบราว์เซอร์ (ชุดคีย์, ใครใช้ชุดไหน)
-- เอาไว้ให้ MCP / LINE / API ใช้โมเดลรายคนเหมือนหน้าเว็บ (เดิมเส้นพวกนั้นเห็นแต่ .env)
-- คีย์ถูกเข้ารหัส (AES-256-GCM) ด้วย secret ของเซิร์ฟเวอร์ก่อนลง - อ่าน/เขียนผ่านเซิร์ฟเวอร์เท่านั้น
-- ============================================================
create table if not exists public.office_llm (
  office_id   uuid primary key references public.office(id) on delete cascade,
  data        jsonb not null default '{}',
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- ฟังก์ชันช่วย RLS
-- ต้องเป็น security definer เพื่อ "มองข้าม" RLS ตอนเช็คสมาชิก
-- ไม่งั้น policy ของ office_member จะเรียกตัวเองวนไม่จบ
-- ============================================================

create or replace function public.is_office_member(oid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.office_member m
    where m.office_id = oid
      and m.user_id = auth.uid()
  );
$$;

-- คนสร้างออฟฟิศต้องกลายเป็นสมาชิกทันที ทำที่ trigger จะได้ไม่พลาดครึ่ง ๆ กลาง ๆ
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.office_member (office_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists office_owner_member on public.office;
create trigger office_owner_member
  after insert on public.office
  for each row execute function public.add_owner_as_member();

-- ============================================================
-- RLS — กฎเดียวซ้ำทุกตาราง: แตะได้เฉพาะออฟฟิศที่ตัวเองเป็นสมาชิก
-- บั๊กใน API ก็ทำข้อมูลข้ามออฟฟิศไม่ได้ เพราะ DB ปฏิเสธเอง
-- ============================================================

alter table public.office        enable row level security;
alter table public.office_member enable row level security;
alter table public.employee      enable row level security;
alter table public.meeting       enable row level security;
alter table public.meeting_event enable row level security;
alter table public.office_token  enable row level security;
-- office_llm: เปิด RLS แต่ไม่มี policy = เบราว์เซอร์อ่าน/เขียนตรงไม่ได้เลย (มีแต่ secret key ฝั่งเซิร์ฟเวอร์ที่ผ่าน)
alter table public.office_llm    enable row level security;
alter table public.office_layout enable row level security;
alter table public.office_profile   enable row level security;
alter table public.office_dept_note enable row level security;
alter table public.office_product   enable row level security;
alter table public.office_doc       enable row level security;
alter table public.office_doc_chunk enable row level security;

-- office ------------------------------------------------------
-- ต้องมี owner_id = auth.uid() ด้วย ไม่ใช่แค่ is_office_member()
-- เพราะตอน INSERT ... RETURNING ระบบจะเอา policy ของ SELECT มาตรวจแถวที่เพิ่งสร้าง
-- ถ้าพึ่งแต่ trigger ที่เพิ่มสมาชิก จังหวะจะเสี่ยงเกินไป — สร้างออฟฟิศแล้วอ่านผลไม่ได้
drop policy if exists office_select on public.office;
create policy office_select on public.office
  for select using (owner_id = auth.uid() or public.is_office_member(id));

drop policy if exists office_insert on public.office;
create policy office_insert on public.office
  for insert with check (owner_id = auth.uid());

drop policy if exists office_update on public.office;
create policy office_update on public.office
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists office_delete on public.office;
create policy office_delete on public.office
  for delete using (owner_id = auth.uid());

-- office_member -----------------------------------------------
-- อ่านของตัวเองได้เสมอ (ไม่งั้นจะหาออฟฟิศตัวเองไม่เจอ) และอ่านของเพื่อนร่วมออฟฟิศได้
drop policy if exists office_member_select on public.office_member;
create policy office_member_select on public.office_member
  for select using (user_id = auth.uid() or public.is_office_member(office_id));

-- เชิญคนเข้าออฟฟิศได้เฉพาะเจ้าของ
drop policy if exists office_member_write on public.office_member;
create policy office_member_write on public.office_member
  for all
  using (exists (select 1 from public.office o where o.id = office_id and o.owner_id = auth.uid()))
  with check (exists (select 1 from public.office o where o.id = office_id and o.owner_id = auth.uid()));

-- employee ----------------------------------------------------
drop policy if exists employee_select on public.employee;
create policy employee_select on public.employee
  for select using (public.is_office_member(office_id));

drop policy if exists employee_write on public.employee;
create policy employee_write on public.employee
  for all
  using (public.is_office_member(office_id))
  with check (public.is_office_member(office_id));

-- office_layout: กฎเดียวกับ employee - สมาชิกจ้างคนได้ (= เพิ่มโต๊ะ) จึงต้องแก้ผังได้ด้วย
drop policy if exists office_layout_select on public.office_layout;
create policy office_layout_select on public.office_layout
  for select using (public.is_office_member(office_id));
drop policy if exists office_layout_write on public.office_layout;
create policy office_layout_write on public.office_layout
  for all
  using (public.is_office_member(office_id))
  with check (public.is_office_member(office_id));

-- meeting ------------------------------------------------------
-- กฎเดียวกับ employee: สมาชิกออฟฟิศอ่านและเขียนบันทึกของออฟฟิศตัวเองได้
drop policy if exists meeting_select on public.meeting;
create policy meeting_select on public.meeting
  for select using (public.is_office_member(office_id));

drop policy if exists meeting_write on public.meeting;
create policy meeting_write on public.meeting
  for all
  using (public.is_office_member(office_id))
  with check (public.is_office_member(office_id));

-- meeting_event: สมาชิกอ่านได้ (Realtime ใช้ policy นี้ตอน push) เขียนได้ - engine เขียนด้วย service key อยู่แล้ว
drop policy if exists meeting_event_select on public.meeting_event;
create policy meeting_event_select on public.meeting_event
  for select using (public.is_office_member(office_id));
drop policy if exists meeting_event_write on public.meeting_event;
create policy meeting_event_write on public.meeting_event
  for all using (public.is_office_member(office_id)) with check (public.is_office_member(office_id));

-- ข้อมูลบริษัท ---------------------------------------------------
-- อ่าน: สมาชิกออฟฟิศทุกคน  เขียน: เจ้าของหรือ exec เท่านั้น (viewer อ่านอย่างเดียว)
create or replace function public.can_edit_office(oid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.office_member m
    where m.office_id = oid and m.user_id = auth.uid() and m.role in ('owner', 'exec')
  );
$$;

drop policy if exists office_profile_select on public.office_profile;
create policy office_profile_select on public.office_profile
  for select using (public.is_office_member(office_id));
drop policy if exists office_profile_write on public.office_profile;
create policy office_profile_write on public.office_profile
  for all using (public.can_edit_office(office_id)) with check (public.can_edit_office(office_id));

drop policy if exists office_dept_note_select on public.office_dept_note;
create policy office_dept_note_select on public.office_dept_note
  for select using (public.is_office_member(office_id));
drop policy if exists office_dept_note_write on public.office_dept_note;
create policy office_dept_note_write on public.office_dept_note
  for all using (public.can_edit_office(office_id)) with check (public.can_edit_office(office_id));

drop policy if exists office_product_select on public.office_product;
create policy office_product_select on public.office_product
  for select using (public.is_office_member(office_id));
drop policy if exists office_product_write on public.office_product;
create policy office_product_write on public.office_product
  for all using (public.can_edit_office(office_id)) with check (public.can_edit_office(office_id));

-- office_token: เจ้าของ/exec จัดการ - เห็นแค่ชื่อกับวันที่ (hash ไม่มีประโยชน์กับใคร)
drop policy if exists office_token_all on public.office_token;
create policy office_token_all on public.office_token
  for all using (public.can_edit_office(office_id)) with check (public.can_edit_office(office_id));

drop policy if exists office_doc_select on public.office_doc;
create policy office_doc_select on public.office_doc
  for select using (public.is_office_member(office_id));
drop policy if exists office_doc_write on public.office_doc;
create policy office_doc_write on public.office_doc
  for all using (public.can_edit_office(office_id)) with check (public.can_edit_office(office_id));

drop policy if exists office_doc_chunk_select on public.office_doc_chunk;
create policy office_doc_chunk_select on public.office_doc_chunk
  for select using (public.is_office_member(office_id));
drop policy if exists office_doc_chunk_write on public.office_doc_chunk;
create policy office_doc_chunk_write on public.office_doc_chunk
  for all using (public.can_edit_office(office_id)) with check (public.can_edit_office(office_id));

-- ค้นชิ้นเอกสารที่ใกล้เคียงคำถาม - security invoker: RLS ของ chunk ยังบังคับอยู่
create or replace function public.match_doc_chunks(
  oid uuid,
  query_embedding extensions.vector(768),
  model text,
  dept_filter text[] default null,
  match_count int default 8
)
returns table (chunk_id bigint, doc_id uuid, doc_name text, seq int, content text, similarity float)
language sql
stable
as $$
  select c.id, c.doc_id, d.name, c.seq, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.office_doc_chunk c
  join public.office_doc d on d.id = c.doc_id
  where c.office_id = oid
    and c.embed_model = model
    and d.status = 'ready'
    and (dept_filter is null or d.dept_ids = '{}' or d.dept_ids && dept_filter)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Storage bucket สำหรับไฟล์เอกสาร - private, อ่าน/เขียนตาม policy ด้านล่าง
insert into storage.buckets (id, name, public)
values ('docs', 'docs', false)
on conflict (id) do nothing;

-- path ต้องขึ้นต้นด้วย <office_id>/ - เอา segment แรกมาเช็คสิทธิ์
drop policy if exists docs_read on storage.objects;
create policy docs_read on storage.objects
  for select using (
    bucket_id = 'docs'
    and public.is_office_member(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists docs_write on storage.objects;
create policy docs_write on storage.objects
  for all using (
    bucket_id = 'docs'
    and public.can_edit_office(((storage.foldername(name))[1])::uuid)
  ) with check (
    bucket_id = 'docs'
    and public.can_edit_office(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- Realtime (เฟส 3 จะได้ใช้ทันที ไม่ต้องกลับมาแก้)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'employee'
  ) then
    alter publication supabase_realtime add table public.employee;
  end if;
  -- การประชุมสด: เบราว์เซอร์ subscribe event ที่ engine เขียน
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'meeting_event'
  ) then
    alter publication supabase_realtime add table public.meeting_event;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'meeting'
  ) then
    alter publication supabase_realtime add table public.meeting;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'office_layout'
  ) then
    alter publication supabase_realtime add table public.office_layout;
  end if;
end $$;
