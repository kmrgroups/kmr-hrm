# HRM Suite — Phase 1: Foundation + Core HR

> **On the KMR platform** the HRM runs at `www.kmr-groups.com/it/hrm` for every customer company, in the `hrm`
> schema of the shared KMR Supabase project, with each company's access controlled by a licence in the **KMR Console**
> (`kmrgroups/kmr-console`, see its docs/PLATFORM_SETUP.md). A dedicated copy for one customer can still use
> `supabase/SETUP_FULL.sql` with `KMR_LICENCE_CHECK=off`.

A multi-company HR platform. It runs as a standalone product (`deno.hrmsuite.in`) and on
each customer's own domain (`hr.customer.com`) with their logo and colours.

**This release covers:**

| Area | What works |
| --- | --- |
| Companies | Many companies in one deployment, isolated by database row-level security; custom domains and subdomains; logo, colours, letterhead details |
| Sign-in | Email + password, 6-digit email code, **Face ID / fingerprint / Windows Hello** (passkeys); forced password change on first login; roles |
| New joiners | HR adds name, email, mobile, job details → a secure link goes out on **email + WhatsApp** |
| Self-onboarding | 7-step mobile form: personal, family & nominees, education, experience & references, bank & statutory, document upload, **live selfie** + consent. Saves after each step. Aadhaar (checksum), PAN, IFSC, account number checks; IFSC auto-fills bank and branch |
| HR review | See every section and document; **approve** or **send back** chosen sections with a comment (only those sections reopen) |
| On approval | Employee code (e.g. `DEN-PL1-0001`), portal login, digital ID card, welcome message with login details |
| ID cards | Print-ready CR80 PDF (front + back), batch printing, re-issue (old QR stops working); QR opens a public verification page showing only name, photo, code, blood group and emergency contact |
| Employee portal | Profile, ID card (view + PDF), masked bank / PAN / Aadhaar / UAN, documents |
| Automation | Daily reminders for unfinished onboarding (day 1, 3, 5); expired links closed; every message logged with its status |
| Compliance | Append-only audit trail of every change and action; documents in private storage with 15-minute links; Aadhaar stored as last 4 digits only |
| Devices | Responsive on phone, tablet, laptop, desktop; installable as an app (PWA) |

**Phase 2 — Attendance + Leave:**

| Area | What works |
| --- | --- |
| Punches | eSSL / ZKTeco devices push directly (ADMS); any other device or bridge via an API key; CSV / text export import from eTimeTrackLite, ZKTeco, Matrix, Realtime or a spreadsheet. Duplicates ignored; unknown device IDs kept and linked once HR sets the employee's device ID |
| Shifts | Fixed shifts, or automatic detection for rotating A / B / C shifts; night shifts crossing midnight; grace, break, half-day and full-day hours per shift |
| Daily attendance | Present, half day, absent, missed punch, weekly off, holiday, leave; late / early minutes; overtime. Recalculated when punches, leave or corrections arrive, and every morning |
| Screens | Daily muster, monthly register (CSV for payroll), each employee's month with every punch, HR manual punches, dashboard counts |
| Corrections | Employees ask for a correction (forgot to punch, device down); the manager or HR approves; the day is recalculated |
| Leave | Leave types with yearly or monthly credit, pro-rating for joiners, carry-forward limits, half days, notice periods, sandwich rule, loss of pay. Apply, approve, reject, cancel with credit back; HR records leave for people without logins; opening balances by CSV; year-end close |
| Balances | Kept as a ledger, so every balance can be explained line by line |

Payroll, recruitment and the QMS modules follow in Phases 3–5 (see the product spec).

### Setting up

Follow **docs/SETUP_GUIDE.md**. A new Supabase project needs just one file: `supabase/SETUP_FULL.sql`
(regenerate it with `node scripts/build-setup-sql.mjs` after changing a migration).

### Upgrading an existing Phase 1 installation

1. Supabase → SQL editor → run `supabase/migrations/0002_attendance_leave.sql` once. Existing companies get
   default shifts (G, A, B, C) and leave types (CL, SL, EL, CO, LOP) — adjust them in the app.
2. Redeploy. The daily job now also finalises attendance and adds leave credits.
3. In the app: **Attendance setup** (shifts, holidays, devices), **Leave policy** (quotas, leave year), then on
   each employee set the **Device ID**, shift and weekly off. Import opening leave balances on the **Leave** page.

---

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com) — choose the **Mumbai (ap-south-1)** region.
2. **SQL editor** → paste and run `supabase/migrations/0001_foundation.sql`.
3. **Authentication → Providers → Email**: enabled. Turn **off** "Allow new users to sign up"
   (accounts are only created by HR / admins).
4. **Authentication → Email templates → Magic Link**: make sure the body contains the code,
   e.g. `Your sign-in code is {{ .Token }}`. This powers "Email code" sign-in.
5. **Authentication → SMTP**: use Resend's SMTP (or any provider) so sign-in codes are
   delivered reliably.
6. **Authentication → URL configuration**: Site URL = your main portal address.

## 2. Deploy on Vercel

1. Push this folder to a GitHub repository and import it in Vercel.
2. Add the environment variables from `docs/env.example.txt`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `APP_ROOT_DOMAIN` | Your product domain, e.g. `hrmsuite.in` (companies get `slug.hrmsuite.in`) |
| `DEFAULT_TENANT_SLUG` | Only for single-company or preview deployments. **Leave empty in production multi-company deployments.** |
| `APP_SECRET` | Any random 32+ character string (`openssl rand -base64 48`) |
| `CRON_SECRET` | Random string; Vercel sends it to the daily reminder job |
| *(no email key)* | Each customer company connects **its own mailbox** in HRM › Settings › Company email (Gmail / Google Workspace, Microsoft 365, Zoho, GoDaddy, Hostinger or any SMTP server). HR emails go out only from that mailbox — never from a KMR address. Until it is connected, emails are not sent (WhatsApp and the portal still work). The password is stored encrypted with `APP_SECRET` — keep `APP_SECRET` unchanged, or companies must re-enter it. Run `supabase/migrations/0004_company_email.sql`. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Meta Business → WhatsApp → API setup (use a permanent System User token) |
| `WHATSAPP_MODE` | `template` in production (see `docs/whatsapp-templates.md`) |

3. In Vercel → Domains add `*.hrmsuite.in` (wildcard) and each customer domain.

## 3. Create the first company

```bash
npm install
node --env-file=.env.local scripts/create-tenant.mjs \
  --slug deno --name "DENO" --legal "DENO Manufacturing and Solutions India Pvt Ltd" \
  --prefix DEN --admin-email hr@deno.in --admin-name "Rajavelu R" \
  --plant "PL1:Bommasandra Plant 1" --domain hr.deno.in
```

It prints the admin's temporary password. Sign in, set a new password, then:

1. **Company & branding** — logo (PNG/JPG for sharp ID cards), colours, address, sender email, ID card signatory.
2. **Plants & departments** — plant codes appear in employee codes.
3. **Users & roles** — add HR, payroll and managers.
4. **Message templates** — adjust the wording if needed.
5. Submit the WhatsApp templates in `docs/whatsapp-templates.md` to Meta.

### Customer's own domain

The customer adds a DNS **CNAME** `hr.customer.com → cname.vercel-dns.com`. You add the
domain in Vercel and insert a row in `tenant_domains` (or pass `--domain` when creating the
company). Passkeys are tied to the exact address, so employees set up Face ID once per address.

### Under another site's address

To serve the HRM at a path of an existing site — for example `www.kmr-groups.com/it/hrm` —
see **`docs/kmr-groups/SETUP.md`**. The app supports this through `NEXT_PUBLIC_BASE_PATH` and
`APP_PUBLIC_URL`; the host site only needs a rewrite rule.

## 4. Roles

| Role | Access |
| --- | --- |
| Company Admin | Everything, including company settings and users |
| HR Manager | All HR work, message templates, audit trail |
| HR Executive | Onboarding, employees, ID cards |
| Payroll | Employee list, bank and statutory details |
| Reporting Manager | Their own team (direct and indirect reports) |
| Employee | Their own portal only |

Access is enforced in the database (row-level security), not just in the screens.

## 5. Tests

```bash
npm run typecheck
npm test                      # unit tests: ID validation, messages, tokens, ID card PDF
```

`supabase/tests/rls_test.sql` and `rls_test_phase2.sql` check company isolation and role access on a plain Postgres.
`tests/integration/` runs the attendance and leave services and the device endpoints against Postgres + PostgREST
(`npx vitest run --config vitest.integration.config.ts`, see its README).
`tests/e2e/` holds the full browser walkthrough (HR on desktop, new joiner on a phone,
passkey and email-code sign-in, QR verification, deactivation) — it runs against a local
Supabase Auth + PostgREST stack; see `tests/e2e/reset.sh` for the setup.

## Project layout

```
app/                    pages and API routes (Next.js App Router)
  login/ account/       sign-in, password, Face ID set-up
  app/                  HR screens (dashboard, employees, onboarding, ID cards, settings, audit)
  onboard/[token]/      new joiner's self-onboarding form (public, token-protected)
  v/[token]/            public ID card verification (QR target)
  me/                   employee portal
  api/                  passkeys, onboarding uploads, ID card PDF, cron, app icon
lib/                    auth, tenant resolution, notifications, validation, ID card PDF
supabase/migrations/    database schema + security policies
scripts/                create-tenant
docs/                   WhatsApp template texts
```
