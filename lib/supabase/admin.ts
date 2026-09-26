import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses row-level security, so every caller must
 * check permissions itself before using it (see lib/auth.ts requireRole).
 * Used for: tenant lookup by domain, public onboarding links, QR verification,
 * passkey login, creating auth users, and signed URLs for private documents.
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
