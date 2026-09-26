-- =====================================================================
-- HRM Suite — Phase 1: Foundation + Core HR
-- Multi-tenant schema with row-level security on every tenant table.
-- Run in the Supabase SQL editor (or `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tenants (companies) and their domains
-- ---------------------------------------------------------------------
create table public.tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name            text not null,                 -- short display name
  legal_name      text,
  logo_path       text,                          -- path in the public "branding" bucket
  primary_color   text not null default '#1F3A5F',
  accent_color    text not null default '#E07A1F',
  address         text,
  phone           text,
  email           text,
  website         text,
  emp_code_prefix text not null default 'EMP',
  emp_code_seq    integer not null default 0,
  settings        jsonb not null default '{}'::jsonb,   -- email_from, whatsapp numbers, id card options...
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.tenant_domains (
  domain      text primary key check (domain = lower(domain)),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  is_primary  boolean not null default false,
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.tenant_domains(tenant_id);

-- ---------------------------------------------------------------------
-- Organisation masters
-- ---------------------------------------------------------------------
create table public.plants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  address    text,
  state      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  code       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.designations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  grade      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ---------------------------------------------------------------------
-- Users (one row per Supabase auth user) and roles
-- ---------------------------------------------------------------------
create table public.app_users (
  id                   uuid primary key references auth.users(id) on delete cascade,
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  role                 text not null check (role in (
                         'platform_admin','company_admin','hr_manager','hr_executive',
                         'payroll','manager','interviewer','employee')),
  full_name            text not null,
  email                text not null,
  phone                text,
  employee_id          uuid,                     -- FK added after employees table
  must_change_password boolean not null default false,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);
create index on public.app_users(tenant_id);

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
create table public.employees (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  employee_code           text,
  status                  text not null default 'invited' check (status in (
                            'invited','onboarding','submitted','sent_back','active','inactive','exited')),
  first_name              text not null,
  last_name               text,
  email                   text,
  mobile                  text,
  plant_id                uuid references public.plants(id),
  department_id           uuid references public.departments(id),
  designation_id          uuid references public.designations(id),
  reporting_manager_id    uuid references public.employees(id),
  employment_type         text not null default 'permanent' check (employment_type in (
                            'permanent','probation','fixed_term','trainee','apprentice','contract')),
  category                text not null default 'staff' check (category in ('staff','workman','management')),
  date_of_joining         date,
  date_of_birth           date,
  gender                  text,
  blood_group             text check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  photo_path              text,                  -- selfie in the private employee-docs bucket
  emergency_contact_name  text,
  emergency_contact_phone text,
  profile                 jsonb not null default '{}'::jsonb,   -- onboarding sections (personal, family, academic, professional)
  verify_token            text not null unique default encode(gen_random_bytes(16), 'hex'),  -- used by the ID card QR
  created_by              uuid references auth.users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, employee_code)
);
create index on public.employees(tenant_id, status);

alter table public.app_users
  add constraint app_users_employee_fk foreign key (employee_id) references public.employees(id) on delete set null;

-- Statutory and bank details are kept apart so that managers who can see
-- an employee's profile cannot see these fields.
create table public.employee_private (
  employee_id     uuid primary key references public.employees(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  pan             text,
  aadhaar_last4   text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),  -- full Aadhaar is never stored
  uan             text,
  previous_pf_no  text,
  esi_ip_no       text,
  bank_name       text,
  bank_branch     text,
  account_holder  text,
  account_number  text,
  ifsc            text,
  tax_regime      text check (tax_regime is null or tax_regime in ('new','old')),
  updated_at      timestamptz not null default now()
);

create table public.onboarding_invites (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete cascade,
  token_hash          text not null unique,      -- sha256 of the link token; the raw token is only in the link
  status              text not null default 'sent' check (status in (
                        'sent','in_progress','submitted','sent_back','approved','expired','revoked')),
  current_step        integer not null default 0,
  sent_back_sections  text[] not null default '{}',
  hr_comment          text,
  consent_at          timestamptz,
  consent_ip          text,
  reminders_sent      integer not null default 0,
  last_reminder_at    timestamptz,
  expires_at          timestamptz not null default now() + interval '7 days',
  submitted_at        timestamptz,
  reviewed_at         timestamptz,
  reviewed_by         uuid references auth.users(id),
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index on public.onboarding_invites(tenant_id, status);
create index on public.onboarding_invites(employee_id);

create table public.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  doc_type     text not null,                    -- aadhaar, pan, cheque, qualification, relieving, payslip, experience, photo, selfie, other
  file_path    text not null,                    -- employee-docs/<tenant>/<employee>/<uuid>.<ext>
  file_name    text,
  mime_type    text,
  size_bytes   integer,
  status       text not null default 'uploaded' check (status in ('uploaded','approved','rejected')),
  comment      text,
  uploaded_at  timestamptz not null default now()
);
create index on public.employee_documents(employee_id);

create table public.id_cards (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  version      integer not null default 1,
  status       text not null default 'active' check (status in ('active','replaced','revoked')),
  issued_at    timestamptz not null default now(),
  valid_until  date,
  issued_by    uuid references auth.users(id),
  reason       text                               -- new, lost, damaged, data change
);
create index on public.id_cards(employee_id);

-- ---------------------------------------------------------------------
-- Passkeys (Face ID / fingerprint / Windows Hello login)
-- ---------------------------------------------------------------------
create table public.passkeys (
  id            text primary key,                 -- base64url credential id
  user_id       uuid not null references auth.users(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  public_key    text not null,                    -- base64url COSE public key
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  device_name   text,
  backed_up     boolean not null default false,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index on public.passkeys(user_id);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table public.notification_templates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  event           text not null,
  channel         text not null check (channel in ('email','whatsapp')),
  subject         text,
  body            text not null,
  wa_template     text,                           -- approved Meta template name
  wa_language     text default 'en',
  wa_params       text[] not null default '{}',   -- variable names mapped to {{1}}, {{2}}...
  active          boolean not null default true,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, event, channel)
);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  event         text not null,
  channel       text not null check (channel in ('email','whatsapp','sms')),
  recipient     text not null,
  subject       text,
  body          text,
  status        text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','skipped')),
  provider_id   text,
  error         text,
  related_type  text,
  related_id    uuid,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index on public.notifications(tenant_id, created_at desc);
create index on public.notifications(provider_id);

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigserial primary key,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  actor_id    uuid,
  action      text not null,                     -- insert / update / delete / semantic e.g. onboarding.approved
  entity      text not null,
  entity_id   text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log(tenant_id, created_at desc);
create index on public.audit_log(entity, entity_id);

-- =====================================================================
-- Helper functions
-- =====================================================================

-- Tenant of the signed-in user (null for anonymous / service role)
create or replace function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.app_users where id = auth.uid() and active
$$;

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and active
$$;

create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.app_users where id = auth.uid() and active
$$;

-- True when the signed-in user holds any of the given roles.
-- company_admin and platform_admin pass every HR check.
create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and active
      and (role = any(roles) or role in ('company_admin','platform_admin'))
  )
$$;

create or replace function public.is_hr() returns boolean
language sql stable as $$ select public.has_role('hr_manager','hr_executive') $$;

-- Employees in the signed-in manager's reporting line (direct + indirect)
create or replace function public.is_in_my_team(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive team as (
    select id from public.employees where reporting_manager_id = public.current_employee_id()
    union
    select e.id from public.employees e join team t on e.reporting_manager_id = t.id
  )
  select exists (select 1 from team where id = emp)
$$;

-- Atomically allocate the next employee code, e.g. DEN-PL1-0042
create or replace function public.next_employee_code(p_tenant uuid, p_plant uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_seq    integer;
  v_plant  text;
begin
  update public.tenants set emp_code_seq = emp_code_seq + 1
   where id = p_tenant
   returning emp_code_prefix, emp_code_seq into v_prefix, v_seq;
  if v_seq is null then
    raise exception 'tenant % not found', p_tenant;
  end if;
  if p_plant is not null then
    select code into v_plant from public.plants where id = p_plant and tenant_id = p_tenant;
  end if;
  return v_prefix || coalesce('-' || v_plant, '') || '-' || lpad(v_seq::text, 4, '0');
end $$;

-- Generic audit trigger
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_log(tenant_id, actor_id, action, entity, entity_id, old_data, new_data)
  values (
    case when tg_table_name = 'tenants' then (v_row->>'id')::uuid else (v_row->>'tenant_id')::uuid end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'employee_id'),
    v_old,
    v_new
  );
  return coalesce(new, old);
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger employee_private_touch before update on public.employee_private
  for each row execute function public.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['tenants','tenant_domains','plants','departments','designations','app_users',
                           'employees','employee_private','onboarding_invites','employee_documents','id_cards',
                           'notification_templates']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Default masters for a new tenant
create or replace function public.seed_tenant_defaults(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.departments(tenant_id, name, code) values
    (p_tenant,'Production','PRD'),(p_tenant,'Quality','QA'),(p_tenant,'Maintenance','MNT'),
    (p_tenant,'Stores','STR'),(p_tenant,'Production Planning & Control','PPC'),
    (p_tenant,'Human Resources','HR'),(p_tenant,'Accounts & Finance','FIN'),
    (p_tenant,'Purchase','PUR'),(p_tenant,'Engineering','ENG'),(p_tenant,'EHS','EHS')
  on conflict do nothing;
  insert into public.designations(tenant_id, name, grade) values
    (p_tenant,'Operator','W1'),(p_tenant,'Senior Operator','W2'),(p_tenant,'Technician','W3'),
    (p_tenant,'Supervisor','S1'),(p_tenant,'Engineer','S2'),(p_tenant,'Senior Engineer','S3'),
    (p_tenant,'Assistant Manager','M1'),(p_tenant,'Manager','M2'),(p_tenant,'Senior Manager','M3'),
    (p_tenant,'Head of Department','M4')
  on conflict do nothing;
end $$;

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table public.tenants                enable row level security;
alter table public.tenant_domains         enable row level security;
alter table public.plants                 enable row level security;
alter table public.departments            enable row level security;
alter table public.designations           enable row level security;
alter table public.app_users              enable row level security;
alter table public.employees              enable row level security;
alter table public.employee_private       enable row level security;
alter table public.onboarding_invites     enable row level security;
alter table public.employee_documents     enable row level security;
alter table public.id_cards               enable row level security;
alter table public.passkeys               enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notifications          enable row level security;
alter table public.audit_log              enable row level security;

-- Tenants: members read their own company; company admins edit branding.
create policy tenants_read on public.tenants for select to authenticated
  using (id = public.current_tenant_id());
create policy tenants_update on public.tenants for update to authenticated
  using (id = public.current_tenant_id() and public.has_role('company_admin'))
  with check (id = public.current_tenant_id());

create policy domains_read on public.tenant_domains for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Masters: everyone in the tenant reads; HR writes.
do $$
declare t text;
begin
  foreach t in array array['plants','departments','designations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_tenant_id() and public.is_hr()) with check (tenant_id = public.current_tenant_id() and public.is_hr())', t || '_write', t);
  end loop;
end $$;

-- Users: everyone sees their own row; HR sees all users of the tenant; company admin manages.
create policy app_users_self on public.app_users for select to authenticated
  using (id = auth.uid());
create policy app_users_hr_read on public.app_users for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr());
create policy app_users_admin_write on public.app_users for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('company_admin'))
  with check (tenant_id = public.current_tenant_id());

-- Employees: HR full access; managers read their team; employees read themselves.
create policy employees_hr on public.employees for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr())
  with check (tenant_id = public.current_tenant_id() and public.is_hr());
create policy employees_self on public.employees for select to authenticated
  using (id = public.current_employee_id());
create policy employees_team on public.employees for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('manager') and public.is_in_my_team(id));
create policy employees_payroll on public.employees for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('payroll'));

-- Private (bank / statutory): HR and payroll, plus the employee themselves (read only).
create policy private_hr on public.employee_private for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('hr_manager','hr_executive','payroll'))
  with check (tenant_id = public.current_tenant_id() and public.has_role('hr_manager','hr_executive','payroll'));
create policy private_self on public.employee_private for select to authenticated
  using (employee_id = public.current_employee_id());

create policy invites_hr on public.onboarding_invites for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr())
  with check (tenant_id = public.current_tenant_id() and public.is_hr());

create policy docs_hr on public.employee_documents for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr())
  with check (tenant_id = public.current_tenant_id() and public.is_hr());
create policy docs_self on public.employee_documents for select to authenticated
  using (employee_id = public.current_employee_id());

create policy id_cards_hr on public.id_cards for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr())
  with check (tenant_id = public.current_tenant_id() and public.is_hr());
create policy id_cards_self on public.id_cards for select to authenticated
  using (employee_id = public.current_employee_id());

create policy passkeys_self_read on public.passkeys for select to authenticated
  using (user_id = auth.uid());
create policy passkeys_self_delete on public.passkeys for delete to authenticated
  using (user_id = auth.uid());

create policy templates_read on public.notification_templates for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr());
create policy templates_write on public.notification_templates for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('hr_manager'))
  with check (tenant_id = public.current_tenant_id() and public.has_role('hr_manager'));

create policy notifications_hr on public.notifications for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_hr());

create policy audit_admin on public.audit_log for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('hr_manager'));

-- =====================================================================
-- Storage buckets
--   branding       public  — logos shown on login page, emails and ID cards
--   employee-docs  private — Aadhaar, PAN, cheques, certificates, selfies.
--                            No client policies: the app issues short-lived
--                            signed URLs only after checking the user's role.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding', 'branding', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('employee-docs', 'employee-docs', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;
