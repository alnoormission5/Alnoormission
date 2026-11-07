-- Sample structure only. Delete or replace freely. Create sample users from Admin > People.
insert into academic_years(name,is_current) values ('2026-27',true);
insert into subjects(name,code) values ('Mathematics','MATH'),('English','ENG'),('Science','SCI'),('Social Studies','SOC'),('Hindi','HIN');
insert into classes(name,section,academic_year_id) select c,'A',id from academic_years, unnest(array['8','9','10']) c where name='2026-27';
insert into exams(name,max_marks,academic_year_id) select e,m,id from academic_years, (values ('Unit Test 1',25),('Mid-Term',50),('Final Exam',100)) v(e,m) where name='2026-27';
