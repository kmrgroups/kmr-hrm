import "server-only";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/supabase/cookie-options";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { DB_SCHEMA } from "@/lib/buckets";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Supabase client acting as the signed-in user (row-level security applies). */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return (createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: authCookieOptions,
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by middleware instead.
        }
      },
    },
  }) as unknown as SupabaseClient);
}
