# HRM Suite — Phase 1: Foundation + Core HR

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

Attendance with biometric devices, leave, payroll, recruitment and the QMS modules follow
in Phases 2–5 (see the product spec).

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
2. Add the environment variables from `.env.example`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `APP_ROOT_DOMAIN` | Your product domain, e.g. `hrmsuite.in` (companies get `slug.hrmsuite.in`) |
| `DEFAULT_TENANT_SLUG` | Only for single-company or preview deployments. **Leave empty in production multi-company deployments.** |
| `APP_SECRET` | Any random 32+ character string (`openssl rand -base64 48`) |
| `CRON_SECRET` | Random string; Vercel sends it to the daily reminder job |
| `RESEND_API_KEY`, `EMAIL_FROM` | [resend.com](https://resend.com) — verify your sending domain first |
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

`supabase/tests/rls_test.sql` checks company isolation and role access on a plain Postgres.
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
