import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { p } from "@/lib/base-path";

// Single sign-on from the KMR Apps portal (www.kmr-groups.com/it/app/<customer>): the portal posts the person's
// current session here and the HRM adopts it, so they are not asked to sign in twice. Only the person's own
// tokens are accepted; HRM access is still checked on every page (login, company, licence).
export async function POST(req: Request) {
  const form = await req.formData();
  const access_token = String(form.get("access_token") ?? "");
  const refresh_token = String(form.get("refresh_token") ?? "");
  const origin = new URL(req.url);
  const back = (path: string) => NextResponse.redirect(new URL(p(path), origin), 303);
  if (!access_token || !refresh_token) return back("/login");
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return back("/login");
  return back("/app");
}
