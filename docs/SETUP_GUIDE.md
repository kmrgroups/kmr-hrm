# HRM Suite — complete setup (hrm.kmr-groups.com)

Four parts, about 30 minutes. Nothing needs to be installed on your computer.

## 1. Supabase (the database)

1. supabase.com → **New project** → region **South Asia (Mumbai)** → note the database password somewhere safe.
2. **Authentication → Users → Add user → Create new user**: your admin email and a password, tick **Auto Confirm User**.
3. Open `supabase/SETUP_FULL.sql`, change the values under **YOUR COMPANY** at the top
   (company name, web address, the admin email from step 2).
4. **SQL Editor → New query** → paste the whole file → **Run**. It must end with `HRM SETUP COMPLETE`.
   If it stops, the message says exactly what to fix — nothing is half-created.
5. **Authentication → Sign In / Providers → Email**: keep Email enabled, turn **Allow new users to sign up** off
   (HR creates every login from inside the app).
6. **Authentication → URL Configuration**: Site URL `https://hrm.kmr-groups.com`,
   and add `https://hrm.kmr-groups.com/**` under Redirect URLs.
7. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key for part 3.

> Upgrading a database that already has Phase 1? Do **not** run SETUP_FULL.sql. Run only
> `supabase/migrations/0002_attendance_leave.sql` once.

## 2. Email (Resend) — needed for sign-in codes and every HR message

1. resend.com → sign up (free: 3,000 emails a month).
2. **Domains → Add domain** → `kmr-groups.com` → add the DNS records it shows wherever kmr-groups.com's DNS is managed → wait for **Verified**.
3. **API Keys → Create** → copy the key.

## 3. Vercel (the app)

Project connected to `kmrgroups/kmr-groups-it` with the domain `hrm.kmr-groups.com`.
**Settings → Environment Variables** (Production), then redeploy:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase `service_role` key (secret) |
| `DEFAULT_TENANT_SLUG` | `kmr` (the company_slug you used) |
| `APP_PUBLIC_URL` | `https://hrm.kmr-groups.com` |
| `APP_SECRET` | any long random text, 40+ characters |
| `CRON_SECRET` | another long random text |

Leave `NEXT_PUBLIC_BASE_PATH` and `APP_ROOT_DOMAIN` **unset** for hrm.kmr-groups.com.
No email key is needed: each company connects its own mailbox in **Settings › Company email** (run `supabase/migrations/0004_company_email.sql` once).
Optional: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` for WhatsApp messages.

Only one Vercel project should be connected to this repository — delete any extra ones
(Settings → bottom of the page → Delete Project), otherwise every upload builds several copies.

## 4. First sign-in

Open `https://hrm.kmr-groups.com`, sign in with the admin email and password from part 1, then:

1. **Company & branding**: upload the logo (also becomes the browser-tab icon), colours, address.
2. **Attendance setup**: check shifts, add this year's holidays, connect the biometric device.
3. **Leave policy**: adjust quotas; **Leave** page → import opening balances.
4. **Employees → Add** (or Onboarding links) and give HR colleagues their logins under **Users**.

## Later changes to the database

New phases ship as `supabase/migrations/000N_*.sql`. Run only the new file in the SQL Editor.
