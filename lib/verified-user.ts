import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's id, verified ONCE per request.
 * The middleware checks the sign-in with Supabase and passes the result in "x-kmr-uid" (it always overwrites any
 * value sent by the browser, so it cannot be faked). Pages and the company lookup reuse it instead of asking
 * Supabase again — one sign-in check per page instead of three.
 */
export const verifiedUserId = cache(async (): Promise<string | null> => {
  const hd = await headers();
  const h = hd.get("x-kmr-uid"), stamp = hd.get("x-kmr-mw");
  if (h && process.env.APP_SECRET && stamp === process.env.APP_SECRET) return h === "-" ? null : h;
  const supabase = await createClient();                 // requests the middleware did not cover
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
});
