import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirectTo } from "@/lib/redirect";

// Single sign-on from the KMR Apps portal (www.kmr-groups.com/it/app/<customer>): the portal posts the person's
// current session here and the HRM adopts it, so they are not asked to sign in twice. Only the person's own
// tokens are accepted; HRM access is still checked on every page (login, company, licence).
export async function POST(req: Request) {
  const form = await req.formData();
  const access_token = String(form.get("access_token") ?? "");
  const refresh_token = String(form.get("refresh_token") ?? "");
  const back = (path: string) => redirectTo(path);
  if (!access_token || !refresh_token) return back("/login");
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return back("/login");
  // Opened from a customer's portal: only that customer's HRM users are let in
  const co = String(form.get("co") ?? "");
  if (co) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await createAdminClient().from("app_users").select("tenant_id,role,active,tenants(slug)").eq("id", user?.id ?? "").maybeSingle();
    const tn = me?.tenants as unknown as { slug: string } | { slug: string }[] | null | undefined;
    const slug = Array.isArray(tn) ? tn[0]?.slug : tn?.slug;
    if (!me?.active || (slug !== co && me.role !== "platform_admin")) { await supabase.auth.signOut(); return back(`/login?co=${encodeURIComponent(co)}`); }
  }
  return back("/app");
}
