-- ===== TABLES =====
create table profiles(
  id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('admin','teacher','student')),
  full_name text not null check (length(full_name) between 2 and 100),
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now());
create table academic_years(id uuid primary key default gen_random_uuid(), name text unique not null, is_current boolean not null default false);
create table classes(id uuid primary key default gen_random_uuid(), name text not null, section text not null default 'A',
  academic_year_id uuid not null references academic_years on delete restrict, unique(name,section,academic_year_id));
create table subjects(id uuid primary key default gen_random_uuid(), name text not null, code text unique not null);
create table exams(id uuid primary key default gen_random_uuid(), name text not null,
  max_marks numeric not null default 100 check (max_marks>0),
  academic_year_id uuid not null references academic_years on delete restrict, unique(name,academic_year_id));
create table students(id uuid primary key references profiles on delete cascade, admission_no text unique not null,
  full_name text not null, class_id uuid references classes on delete restrict);
create table teacher_assignments(id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles on delete cascade,
  class_id uuid not null references classes on delete cascade,
  subject_id uuid not null references subjects on delete cascade, unique(teacher_id,class_id,subject_id));
create table marks(id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  subject_id uuid not null references subjects on delete restrict,
  exam_id uuid not null references exams on delete restrict,
  marks_obtained numeric not null check (marks_obtained>=0),
  max_marks numeric not null,
  entered_by uuid, updated_at timestamptz not null default now(),
  unique(student_id,subject_id,exam_id));
create table marks_audit(id bigint generated always as identity primary key,
  student_id uuid, subject_id uuid, exam_id uuid, action text, old_marks numeric, new_marks numeric,
  changed_by uuid, changed_at timestamptz not null default now());
create index on marks(student_id); create index on marks(exam_id); create index on students(class_id);
create index on teacher_assignments(teacher_id);

-- ===== HELPER FUNCTIONS (security definer avoids RLS recursion) =====
create function app_role() returns text language sql stable security definer set search_path=public as
$$ select role from profiles where id=auth.uid() and active $$;
create function teaches_class(cid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select app_role()='teacher' and exists(select 1 from teacher_assignments where teacher_id=auth.uid() and class_id=cid) $$;
create function can_mark(sid uuid, subj uuid) returns boolean language sql stable security definer set search_path=public as
$$ select app_role()='teacher' and exists(select 1 from students s join teacher_assignments t on t.class_id=s.class_id
   where s.id=sid and t.teacher_id=auth.uid() and t.subject_id=subj) $$;

-- ===== MARKS VALIDATION + AUDIT TRIGGERS =====
create function marks_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare mx numeric;
begin
  select max_marks into mx from exams where id=new.exam_id;
  if mx is null then raise exception 'Unknown exam'; end if;
  if new.marks_obtained>mx then raise exception 'Marks cannot exceed %', mx; end if;
  new.max_marks:=mx; new.entered_by:=auth.uid(); new.updated_at:=now();
  return new;
end $$;
create trigger marks_guard_t before insert or update on marks for each row execute function marks_guard();

create function marks_audit_fn() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    insert into marks_audit(student_id,subject_id,exam_id,action,old_marks,changed_by) values(old.student_id,old.subject_id,old.exam_id,'DELETE',old.marks_obtained,auth.uid());
  elsif tg_op='INSERT' then
    insert into marks_audit(student_id,subject_id,exam_id,action,new_marks,changed_by) values(new.student_id,new.subject_id,new.exam_id,'INSERT',new.marks_obtained,auth.uid());
  elsif new.marks_obtained is distinct from old.marks_obtained then
    insert into marks_audit(student_id,subject_id,exam_id,action,old_marks,new_marks,changed_by) values(new.student_id,new.subject_id,new.exam_id,'UPDATE',old.marks_obtained,new.marks_obtained,auth.uid());
  end if;
  return null;
end $$;
create trigger marks_audit_t after insert or update or delete on marks for each row execute function marks_audit_fn();

-- ===== AUTOMATIC CALCULATIONS (respects RLS of the caller) =====
create view exam_summary with (security_invoker=true) as
select m.student_id, s.class_id, m.exam_id, count(*) as subjects,
  sum(m.marks_obtained) as total, sum(m.max_marks) as max_total,
  round(100*sum(m.marks_obtained)/sum(m.max_marks),2) as percentage,
  round(avg(m.marks_obtained),2) as avg_marks
from marks m join students s on s.id=m.student_id group by m.student_id, s.class_id, m.exam_id;

-- ===== ROW LEVEL SECURITY =====
revoke all on all tables in schema public from anon;
alter table profiles enable row level security;
alter table students enable row level security;
alter table teacher_assignments enable row level security;
alter table marks enable row level security;
alter table marks_audit enable row level security;

create policy profiles_read on profiles for select using (id=auth.uid() or app_role()='admin');
create policy profiles_admin on profiles for all using (app_role()='admin') with check (app_role()='admin');
create policy students_read on students for select using (app_role()='admin' or (id=auth.uid() and app_role()='student') or teaches_class(class_id));
create policy students_admin on students for all using (app_role()='admin') with check (app_role()='admin');
create policy ta_read on teacher_assignments for select using (app_role()='admin' or teacher_id=auth.uid());
create policy ta_admin on teacher_assignments for all using (app_role()='admin') with check (app_role()='admin');
create policy marks_read on marks for select using (app_role()='admin' or (student_id=auth.uid() and app_role()='student') or can_mark(student_id,subject_id));
create policy marks_insert on marks for insert with check (app_role()='admin' or can_mark(student_id,subject_id));
create policy marks_update on marks for update using (app_role()='admin' or can_mark(student_id,subject_id)) with check (app_role()='admin' or can_mark(student_id,subject_id));
create policy marks_delete on marks for delete using (app_role()='admin');
create policy audit_read on marks_audit for select using (app_role()='admin');  -- inserts only via trigger; no update/delete policy

do $$ declare t text; begin
  foreach t in array array['academic_years','classes','subjects','exams'] loop
    execute format('alter table %I enable row level security',t);
    execute format('create policy "%1$s_read" on %1$I for select using (app_role() is not null)',t);
    execute format('create policy "%1$s_admin" on %1$I for all using (app_role()=''admin'') with check (app_role()=''admin'')',t);
  end loop;
end $$;
