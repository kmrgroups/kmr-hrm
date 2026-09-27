"use client";
import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/supabase/cookie-options";
import { DB_SCHEMA } from "@/lib/buckets";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createBrowserSupabase(): SupabaseClient {
  return (createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: authCookieOptions, db: { schema: DB_SCHEMA } },
  ) as unknown as SupabaseClient);
}
