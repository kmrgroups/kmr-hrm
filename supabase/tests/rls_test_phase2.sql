-- Phase 2 (attendance + leave) security tests.
-- Run after: supabase_stubs.sql, 0001_foundation.sql, rls_test.sql (fixtures), 0002_attendance_leave.sql
\set ON_ERROR_STOP 1

create or replace function pg_temp.expect(label text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;
grant execute on function pg_temp.expect(text,bigint,bigint) to authenticated, anon;
select set_config('request.jwt.claims', '{}', false);

-- ---------- defaults for existing companies ----------
select pg_temp.expect('existing company got 4 default shifts', (select count(*) from hrm.shifts where tenant_id='11111111-1111-1111-1111-111111111111'), 4);
select pg_temp.expect('existing company got 5 default leave types', (select count(*) from hrm.leave_types where tenant_id='11111111-1111-1111-1111-111111111111'), 5);

-- ---------- punch ingestion + matching ----------
update hrm.employees set attendance_id = '101' where id = 'eeeeeeee-0000-0000-0000-000000000003';
select pg_temp.expect('ingest stores new punches (matched + unmatched)', (select count(*) from hrm.ingest_punches(
  '11111111-1111-1111-1111-111111111111', null, 'csv',
  '[{"attendance_id":"101","punched_at":"2026-09-21T09:02:00+05:30"},
    {"attendance_id":"101","punched_at":"2026-09-21T17:40:00+05:30"},
    {"attendance_id":"999","punched_at":"2026-09-21T09:10:00+05:30"}]'::jsonb)), 3);
select pg_temp.expect('duplicate punches are ignored', (select count(*) from hrm.ingest_punches(
  '11111111-1111-1111-1111-111111111111', null, 'csv',
  '[{"attendance_id":"101","punched_at":"2026-09-21T09:02:00+05:30"}]'::jsonb)), 0);
select pg_temp.expect('device user 999 not matched yet', (select count(*) from hrm.attendance_punches where attendance_id='999' and employee_id is null), 1);
update hrm.employees set attendance_id = '999' where id = 'eeeeeeee-0000-0000-0000-000000000004';
select pg_temp.expect('setting attendance ID links earlier punches', (select count(*) from hrm.attendance_punches where attendance_id='999' and employee_id='eeeeeeee-0000-0000-0000-000000000004'), 1);

insert into hrm.attendance_days(tenant_id, employee_id, work_date, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','2026-09-21','present'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','2026-09-21','present');
insert into hrm.leave_ledger(tenant_id, employee_id, leave_type_id, leave_year, kind, days, period)
  select '11111111-1111-1111-1111-111111111111', e, lt.id, 2026, 'accrual', 12, '2026'
    from unnest(array['eeeeeeee-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000004']::uuid[]) e,
         hrm.leave_types lt where lt.tenant_id='11111111-1111-1111-1111-111111111111' and lt.code='CL';
do $$ begin
  begin
    insert into hrm.leave_ledger(tenant_id, employee_id, leave_type_id, leave_year, kind, days, period)
      select '11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003', id, 2026, 'accrual', 12, '2026'
        from hrm.leave_types where tenant_id='11111111-1111-1111-1111-111111111111' and code='CL';
    raise exception 'FAIL yearly grant applied twice';
  exception when unique_violation then raise notice 'ok  a yearly grant can only be applied once';
  end;
end $$;

-- ---------- employee: own data only ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3"}', false);
select pg_temp.expect('employee sees own punches only', (select count(*) from hrm.attendance_punches), 2);
select pg_temp.expect('employee sees own day only', (select count(*) from hrm.attendance_days), 1);
select pg_temp.expect('employee sees own balance only', (select count(*) from hrm.leave_balances), 1);
select pg_temp.expect('employee reads company leave types', (select count(*) from hrm.leave_types), 5);
select pg_temp.expect('employee sees no devices', (select count(*) from hrm.attendance_devices), 0);
insert into hrm.leave_requests(tenant_id, employee_id, leave_type_id, from_date, to_date, days, reason)
  select '11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003', id, '2026-10-05','2026-10-05', 1, 'Family function'
    from hrm.leave_types where code='CL';
select pg_temp.expect('employee can apply for own leave', (select count(*) from hrm.leave_requests), 1);
do $$ begin
  begin
    insert into hrm.leave_requests(tenant_id, employee_id, leave_type_id, from_date, to_date, days)
      select '11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004', id, '2026-10-05','2026-10-05', 1
        from hrm.leave_types where code='CL';
    raise exception 'FAIL employee applied leave for a colleague';
  exception when insufficient_privilege then raise notice 'ok  employee cannot apply for someone else';
  end;
  begin
    insert into hrm.leave_requests(tenant_id, employee_id, leave_type_id, from_date, to_date, days, status)
      select '11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003', id, '2026-10-06','2026-10-06', 1, 'approved'
        from hrm.leave_types where code='CL';
    raise exception 'FAIL employee self-approved leave';
  exception when insufficient_privilege then raise notice 'ok  employee cannot create an approved request';
  end;
  begin
    insert into hrm.leave_ledger(tenant_id, employee_id, leave_type_id, leave_year, kind, days)
      select '11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003', id, 2026, 'adjustment', 50
        from hrm.leave_types where code='CL';
    raise exception 'FAIL employee credited own balance';
  exception when insufficient_privilege then raise notice 'ok  employee cannot change own balance';
  end;
end $$;
update hrm.leave_requests set status = 'approved';
select pg_temp.expect('employee cannot approve own request', (select count(*) from hrm.leave_requests where status='approved'), 0);
select pg_temp.expect('employee cannot approve for self via can_approve_for', (select hrm.can_approve_for('eeeeeeee-0000-0000-0000-000000000003')::int), 0);
do $$ begin
  begin
    perform hrm.ingest_punches('11111111-1111-1111-1111-111111111111', null, 'manual', '[]'::jsonb);
    raise exception 'FAIL employee called ingest_punches';
  exception when insufficient_privilege then raise notice 'ok  only the server can ingest punches';
  end;
end $$;
reset role;

-- ---------- manager: team only ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', false);
select pg_temp.expect('manager sees team punches', (select count(*) from hrm.attendance_punches), 2);
select pg_temp.expect('manager sees team leave requests', (select count(*) from hrm.leave_requests), 1);
select pg_temp.expect('manager may approve direct report', (select hrm.can_approve_for('eeeeeeee-0000-0000-0000-000000000003')::int), 1);
select pg_temp.expect('manager may not approve outside team', (select hrm.can_approve_for('eeeeeeee-0000-0000-0000-000000000004')::int), 0);
reset role;

-- ---------- HR: whole company, never another company ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', false);
select pg_temp.expect('deno HR sees all deno punches', (select count(*) from hrm.attendance_punches), 3);
select pg_temp.expect('deno HR may approve anyone in deno', (select hrm.can_approve_for('eeeeeeee-0000-0000-0000-000000000004')::int), 1);
select pg_temp.expect('deno HR may not approve acme staff', (select hrm.can_approve_for('eeeeeeee-0000-0000-0000-0000000000b9')::int), 0);
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', false);
select pg_temp.expect('acme HR sees no deno punches', (select count(*) from hrm.attendance_punches), 0);
select pg_temp.expect('acme HR sees no deno requests', (select count(*) from hrm.leave_requests), 0);
select pg_temp.expect('acme HR sees no deno balances', (select count(*) from hrm.leave_balances), 0);
reset role;

-- ---------- anonymous ----------
set role anon;
select set_config('request.jwt.claims', '', false);
select pg_temp.expect('anon sees no punches', (select count(*) from hrm.attendance_punches), 0);
select pg_temp.expect('anon sees no leave types', (select count(*) from hrm.leave_types), 0);
reset role;

\echo ALL_PHASE2_RLS_TESTS_PASSED
