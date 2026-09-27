
-- =====================================================================
-- Your company, plant, web address and first admin
-- =====================================================================
do $$
declare
  s record;
  v_tenant uuid;
  v_user uuid;
begin
  select * into s from hrm_setup;
  insert into public.tenants (slug, name, legal_name, emp_code_prefix)
  values (lower(s.company_slug), s.company_name, nullif(s.legal_name, ''), upper(s.emp_code_prefix))
  returning id into v_tenant;

  perform public.seed_tenant_defaults(v_tenant);   -- departments, designations, shifts, leave types

  if coalesce(s.web_address, '') <> '' then
    insert into public.tenant_domains (domain, tenant_id, is_primary, verified)
    values (lower(s.web_address), v_tenant, true, true);
  end if;
  if coalesce(s.plant_code, '') <> '' then
    insert into public.plants (tenant_id, code, name) values (v_tenant, upper(s.plant_code), s.plant_name);
  end if;

  select id into v_user from auth.users where lower(email) = lower(s.admin_email);
  insert into public.app_users (id, tenant_id, role, full_name, email, must_change_password)
  values (v_user, v_tenant, 'company_admin', s.admin_name, lower(s.admin_email), false);

  raise notice 'HRM SETUP COMPLETE — company "%" (slug %), admin %', s.company_name, lower(s.company_slug), lower(s.admin_email);
end $$;

drop table hrm_setup;

select 'HRM SETUP COMPLETE' as result,
       (select count(*) from public.tenants)     as companies,
       (select count(*) from public.shifts)      as shifts,
       (select count(*) from public.leave_types) as leave_types,
       (select count(*) from public.app_users)   as admin_logins;
