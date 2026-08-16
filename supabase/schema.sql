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
create index if not exists office_doc_office_idx on public.office_doc (office_id, created_at desc);
create index if not exists office_doc_chunk_doc_idx on public.office_doc_chunk (doc_id, seq);
-- ivfflat ต้องมีข้อมูลก่อนถึงคุ้ม แต่สร้างไว้เลยไม่เสียหาย (ตารางเล็ก Postgres จะ seq scan เอง)
create index if not exists office_doc_chunk_embed_idx on public.office_doc_chunk
  using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 20);
create index if not exists office_member_user_idx on public.office_member (user_id);
create index if not exists meeting_office_idx on public.meeting (office_id, created_at desc);

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
alter table public.office_profile   enable row level security;
alter table public.office_dept_note enable row level security;
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
end $$;
