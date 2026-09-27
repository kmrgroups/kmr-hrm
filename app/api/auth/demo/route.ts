import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p } from "@/lib/base-path";

// "Try with sample data" from the KMR Apps portal: signs the visitor in to KMR's shared demo company
// (the login in HRM_DEMO_EMAIL, loaded with DEMO_DATA.sql). Off unless HRM_DEMO_EMAIL is set.
export async function GET(req: Request) {
  const back = (path: string) => NextResponse.redirect(new URL(p(path), req.url), 303);
  const email = (process.env.HRM_DEMO_EMAIL || "").toLowerCase();
  if (!email) return back("/login?demo=off");
  const admin = createAdminClient();
  const { data: user } = await admin.from("app_users").select("id,active").eq("email", email).maybeSingle();
  if (!user?.active) return back("/login?demo=off");
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.properties?.hashed_token) return back("/login?demo=off");
  const supabase = await createClient();
  const { error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (vErr) return back("/login?demo=off");
  return back("/app");
}
