-- Tests for 0014_security_hardening. Run after supabase_stubs.sql + all migrations (own fixtures, any database state).
\set ON_ERROR_STOP 1
insert into hrm.tenants(id, slug, name, emp_code_prefix) values
  ('31111111-1111-1111-1111-111111111111','hta','H Tenant A','HTA'),
  ('32222222-2222-2222-2222-222222222222','htb','H Tenant B','HTB') on conflict do nothing;
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000c1','adm@hta.test'),('00000000-0000-0000-0000-0000000000c2','mgr@hta.test'),('00000000-0000-0000-0000-0000000000c3','hr@hta.test') on conflict do nothing;
insert into hrm.employees(id, tenant_id, first_name, status) values
  ('eeeeeeee-0000-0000-0000-0000000000c2','31111111-1111-1111-1111-111111111111','Mgr','active'),
  ('eeeeeeee-0000-0000-0000-0000000000c4','31111111-1111-1111-1111-111111111111','Other','active') on conflict do nothing;
insert into hrm.app_users(id, tenant_id, role, full_name, email, employee_id) values
  ('00000000-0000-0000-0000-0000000000c1','31111111-1111-1111-1111-111111111111','company_admin','Adm','adm@hta.test',null),
  ('00000000-0000-0000-0000-0000000000c2','31111111-1111-1111-1111-111111111111','manager','Mgr','mgr@hta.test','eeeeeeee-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3','31111111-1111-1111-1111-111111111111','hr_manager','HR','hr@hta.test',null) on conflict do nothing;

-- 1. company admin cannot become platform admin, nor move company
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', false);
do $$ declare ok boolean := false; begin
  begin update hrm.app_users set role='platform_admin' where id='00000000-0000-0000-0000-0000000000c1'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: admin became platform_admin'; end if;
  ok := false;
  begin update hrm.app_users set tenant_id='32222222-2222-2222-2222-222222222222' where id='00000000-0000-0000-0000-0000000000c2'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: user moved to another tenant'; end if;
  update hrm.app_users set role='hr_executive' where id='00000000-0000-0000-0000-0000000000c2';   -- normal role change still works
  update hrm.app_users set role='manager' where id='00000000-0000-0000-0000-0000000000c2';
  raise notice 'ok  platform_admin escalation blocked';
end $$;
-- 2. tenant functions are closed to signed-in users
do $$ declare ok boolean := false; begin
  begin perform hrm.next_employee_code('32222222-2222-2222-2222-222222222222'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: next_employee_code callable'; end if;
  ok := false;
  begin perform hrm.seed_tenant_defaults('32222222-2222-2222-2222-222222222222'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: seed_tenant_defaults callable'; end if;
  raise notice 'ok  tenant functions closed';
end $$;
reset role;
-- 3. audit log is append-only, even for the owner role path used by the app
insert into hrm.audit_log(tenant_id, action, entity) values ('31111111-1111-1111-1111-111111111111','test','x');
do $$ declare ok boolean := false; begin
  begin update hrm.audit_log set action='y' where tenant_id='31111111-1111-1111-1111-111111111111'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: audit log updated'; end if;
  ok := false;
  begin delete from hrm.audit_log where tenant_id='31111111-1111-1111-1111-111111111111'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: audit log deleted'; end if;
  raise notice 'ok  audit log immutable';
end $$;
-- 4. restore rejects rows of another company
do $$ declare ok boolean := false; begin
  begin perform hrm.company_import_safe('31111111-1111-1111-1111-111111111111',
    jsonb_build_object('format','kmr-hrm-backup','tenant_id','31111111-1111-1111-1111-111111111111',
      'tables', jsonb_build_object('attendance_devices', jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'tenant_id','32222222-2222-2222-2222-222222222222','serial_no','EVIL'))))); exception when others then ok := sqlerrm like 'Backup rejected%'; end;
  if not ok then raise exception 'FAIL: cross-tenant restore accepted'; end if;
  raise notice 'ok  cross-tenant restore rejected';
end $$;
-- 5. a manager sees only their team's incidents
insert into hrm.incidents(id, tenant_id, kind, occurred_at, description, injured_employee_id, status) values
  ('99999999-0000-0000-0000-000000000001','31111111-1111-1111-1111-111111111111','first_aid', now(), 'other dept', 'eeeeeeee-0000-0000-0000-0000000000c4','reported') on conflict do nothing;
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', false);
do $$ declare n int; begin
  select count(*) into n from hrm.incidents where id='99999999-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: manager sees an incident outside the team'; end if;
  raise notice 'ok  manager incident scope';
end $$;
reset role;
select 'ALL_HARDENING_TESTS_PASSED';
