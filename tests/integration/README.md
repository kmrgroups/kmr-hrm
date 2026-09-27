# Integration tests (attendance + leave services)

These run the real server code against Postgres + PostgREST, with both migrations applied.

1. Start Postgres, create a database, run a Supabase-like role setup, then
   `supabase/migrations/0001_foundation.sql` and `0002_attendance_leave.sql`.
2. Start PostgREST on the database, with a gateway exposing it at `http://127.0.0.1:54321/rest/v1`
   (`tests/e2e/gateway.mjs` does this).
3. Run:

```bash
IT_SUPABASE_URL=http://127.0.0.1:54321 IT_JWT_SECRET=<postgrest jwt secret> \
  npx vitest run --config vitest.integration.config.ts
```

Each run creates its own company, so it can be repeated on the same database.
