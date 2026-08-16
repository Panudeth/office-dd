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

create index if not exists employee_office_idx on public.employee (office_id);
create index if not exists office_member_user_idx on public.office_member (user_id);

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
