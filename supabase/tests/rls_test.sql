-- Row-level security tests. Run after supabase_stubs.sql + migrations.
-- Every check raises an exception on failure, so the script stops at the first broken rule.
\set ON_ERROR_STOP 1

-- ---------- fixtures (as superuser) ----------
insert into public.tenants(id, slug, name, emp_code_prefix) values
  ('11111111-1111-1111-1111-111111111111','deno','DENO Manufacturing','DEN'),
  ('22222222-2222-2222-2222-222222222222','acme','Acme Auto','ACM');
select public.seed_tenant_defaults('11111111-1111-1111-1111-111111111111');
select public.seed_tenant_defaults('22222222-2222-2222-2222-222222222222');
insert into public.plants(id, tenant_id, code, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','PL1','Bommasandra');

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000a1','hr@deno.test'),
  ('00000000-0000-0000-0000-0000000000a2','mgr@deno.test'),
  ('00000000-0000-0000-0000-0000000000a3','op1@deno.test'),
  ('00000000-0000-0000-0000-0000000000a4','op2@deno.test'),
  ('00000000-0000-0000-0000-0000000000b1','hr@acme.test');

insert into public.employees(id, tenant_id, first_name, status) values
  ('eeeeeeee-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Manager','active');
insert into public.employees(id, tenant_id, first_name, status, reporting_manager_id) values
  ('eeeeeeee-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Operator One','active','eeeeeeee-0000-0000-0000-000000000002'),
  ('eeeeeeee-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Operator Two','active',null);
insert into public.employees(id, tenant_id, first_name, status) values
  ('eeeeeeee-0000-0000-0000-0000000000b9','22222222-2222-2222-2222-222222222222','Acme Person','active');
insert into public.employee_private(employee_id, tenant_id, account_number) values
  ('eeeeeeee-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','1234567890'),
  ('eeeeeeee-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','9999999999');

insert into public.app_users(id, tenant_id, role, full_name, email, employee_id) values
  ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','hr_manager','HR','hr@deno.test',null),
  ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','manager','Mgr','mgr@deno.test','eeeeeeee-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','employee','Op1','op1@deno.test','eeeeeeee-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','hr_manager','HR','hr@acme.test',null);

create or replace function pg_temp.expect(label text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;
grant execute on function pg_temp.expect(text,bigint,bigint) to authenticated;

-- ---------- employee code allocation ----------
do $$ begin
  if public.next_employee_code('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001') <> 'DEN-PL1-0001' then raise exception 'FAIL code 1'; end if;
  if public.next_employee_code('11111111-1111-1111-1111-111111111111') <> 'DEN-0002' then raise exception 'FAIL code 2'; end if;
  if public.next_employee_code('22222222-2222-2222-2222-222222222222') <> 'ACM-0001' then raise exception 'FAIL code 3'; end if;
  raise notice 'ok  employee codes are sequential per tenant';
end $$;

-- ---------- HR of DENO ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', false);
select pg_temp.expect('deno HR sees only deno employees', (select count(*) from public.employees), 3);
select pg_temp.expect('deno HR sees deno bank details', (select count(*) from public.employee_private), 2);
select pg_temp.expect('deno HR sees 10 deno departments', (select count(*) from public.departments), 10);
select pg_temp.expect('deno HR sees one tenant', (select count(*) from public.tenants), 1);
do $$ begin
  begin
    insert into public.employees(tenant_id, first_name) values ('22222222-2222-2222-2222-222222222222','Intruder');
    raise exception 'FAIL deno HR inserted into acme';
  exception when insufficient_privilege then raise notice 'ok  deno HR cannot insert into acme';
  end;
end $$;
update public.employees set first_name = 'Hacked' where tenant_id = '22222222-2222-2222-2222-222222222222';
reset role;
select pg_temp.expect('acme row untouched by deno HR', (select count(*) from public.employees where first_name='Hacked'), 0);

-- ---------- manager: own team only, no bank data ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', false);
select pg_temp.expect('manager sees self + direct report', (select count(*) from public.employees), 2);
select pg_temp.expect('manager sees no bank details', (select count(*) from public.employee_private), 0);
update public.employees set first_name = 'Changed' where id = 'eeeeeeee-0000-0000-0000-000000000003';
reset role;
select pg_temp.expect('manager cannot edit employee', (select count(*) from public.employees where first_name='Changed'), 0);

-- ---------- employee: self only ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3"}', false);
select pg_temp.expect('employee sees only self', (select count(*) from public.employees), 1);
select pg_temp.expect('employee sees only own bank row', (select count(*) from public.employee_private), 1);
select pg_temp.expect('employee sees no audit log', (select count(*) from public.audit_log), 0);
select pg_temp.expect('employee sees no users list except self', (select count(*) from public.app_users), 1);
update public.tenants set name = 'Pwned';
reset role;
select pg_temp.expect('employee cannot rename company', (select count(*) from public.tenants where name='Pwned'), 0);

-- ---------- anonymous: nothing ----------
set role anon;
select set_config('request.jwt.claims', '', false);
select pg_temp.expect('anon sees no employees', (select count(*) from public.employees), 0);
select pg_temp.expect('anon sees no tenants', (select count(*) from public.tenants), 0);
reset role;

-- ---------- audit trail ----------
select pg_temp.expect('audit rows written for employee inserts', (select count(*) from public.audit_log where entity='employees' and action='insert'), 4);

\echo ALL_RLS_TESTS_PASSED
