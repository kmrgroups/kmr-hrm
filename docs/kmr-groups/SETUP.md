# Running the HRM at www.kmr-groups.com/it/hrm

The HRM stays a **separate project** (its own Vercel project and Supabase database).
The KMR site forwards every address under `/it/hrm` to it, so people only ever see
`www.kmr-groups.com/it/hrm`. The KMR code itself is not changed apart from one
config snippet.

```
Browser ── www.kmr-groups.com/it/hrm/... ──► KMR Vercel project ──(rewrite)──► HRM Vercel project
           www.kmr-groups.com/anything else ─► KMR pages as today
```

## 1. Supabase (new project for the HRM)

1. Create a project in the **Mumbai** region, e.g. `kmr-hrm`.
2. SQL editor → run `supabase/migrations/0001_foundation.sql`.
3. Authentication → URL configuration → **Site URL** = `https://www.kmr-groups.com/it/hrm`.
4. Authentication → Providers → Email: enabled, **sign-ups off**.
5. Authentication → Email templates → Magic Link: include `{{ .Token }}` (for "Email code" sign-in).

## 2. HRM project on Vercel

Import the HRM repository as a **new** Vercel project (e.g. `kmr-hrm`) with these
environment variables (plus the Supabase / Resend / WhatsApp ones from `.env.example`):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_BASE_PATH` | `/it/hrm` |
| `APP_PUBLIC_URL` | `https://www.kmr-groups.com/it/hrm` |
| `DEFAULT_TENANT_SLUG` | `kmr` |
| `APP_ROOT_DOMAIN` | *(leave empty)* |
| `ALLOWED_ORIGINS` | `kmr-groups.com` *(only if the site is also reachable without www)* |

In `vercel.json`, change the reminder job path to include the sub-path:

```json
{ "crons": [ { "path": "/it/hrm/api/cron/reminders", "schedule": "30 3 * * *" } ] }
```

Deploy. The HRM now answers at `https://kmr-hrm.vercel.app/it/hrm`.

## 3. KMR site — one config change

Copy the `rewrites` and `redirects` from `next.config.rewrite.js` (next to this file) into the
KMR project's `next.config.js`, set `HRM_URL` to the HRM project's Vercel address, and deploy
KMR. Now `https://www.kmr-groups.com/it/hrm` opens the HRM, and `/it/hrm.html` redirects there.

## 4. Create the company and first admin

```bash
node --env-file=.env.local scripts/create-tenant.mjs \
  --slug kmr --name "KMR" --legal "KMR Group of Companies" \
  --prefix KMR --admin-email hr@kmr-groups.com --admin-name "Rajavelu R" \
  --plant "HO:Head Office"
```

Sign in at `https://www.kmr-groups.com/it/hrm/login` with the printed temporary password.

## What stays separate from the KMR site

- **Login**: the HRM uses its own cookie (`hrm-auth`) limited to `/it/hrm`, so signing in or out
  of the HRM never affects a KMR admin session, and the other way round.
- **Face ID / fingerprint** is registered for `www.kmr-groups.com`, so it keeps working if the
  HRM later moves to a different Vercel project.
- **Data**: its own Supabase project; nothing is written to the KMR database.

## Alternative: hrm.kmr-groups.com (no change to the KMR site at all)

Leave `NEXT_PUBLIC_BASE_PATH` and `APP_PUBLIC_URL` empty, add `hrm.kmr-groups.com` under the HRM
project's Domains in Vercel, add a DNS `CNAME hrm → cname.vercel-dns.com`, and create the company
with `--domain hrm.kmr-groups.com`.
