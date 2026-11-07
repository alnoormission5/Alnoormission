-- Run once in Supabase SQL Editor (after schema.sql).
create table class_teachers(
  class_id uuid primary key references classes on delete cascade,
  teacher_id uuid not null references profiles on delete cascade);
alter table class_teachers enable row level security;
create policy ct_read on class_teachers for select using (app_role()='admin' or teacher_id=auth.uid());
create policy ct_admin on class_teachers for all using (app_role()='admin') with check (app_role()='admin');

create function is_class_teacher(cid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select app_role()='teacher' and exists(select 1 from class_teachers where class_id=cid and teacher_id=auth.uid()) $$;
create function is_class_teacher_of(sid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from students s where s.id=sid and is_class_teacher(s.class_id)) $$;

-- Class teachers can read the students of their class
create or replace function teaches_class(cid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select app_role()='teacher' and (
     exists(select 1 from teacher_assignments where teacher_id=auth.uid() and class_id=cid)
     or exists(select 1 from class_teachers where teacher_id=auth.uid() and class_id=cid)) $$;

-- Class teachers can READ (not edit) all subjects' marks for their own class
drop policy marks_read on marks;
create policy marks_read on marks for select using (
  app_role()='admin' or (student_id=auth.uid() and app_role()='student')
  or can_mark(student_id,subject_id) or is_class_teacher_of(student_id));
