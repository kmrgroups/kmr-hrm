import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { recomputeAttendance } from "@/lib/attendance/service";
import { addDays, istToday } from "@/lib/attendance/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by KMR Apps › Grand Master right after it loads the sample data: turns the HRM sample punches into
 * attendance days. The caller sends their own sign-in token; the database answers with the company's HRM only when
 * that person is the company's administrator, so nobody else can trigger it.
 */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
  if (!token || !slug || !/^[a-z0-9-]{2,60}$/.test(slug)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const asUser = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tenant, error } = await asUser.rpc("kmr_grand_hrm_tenant", { p_slug: slug });
  if (error || !tenant) return NextResponse.json({ error: error?.message ?? "no HRM for this company" }, { status: 403 });
  const days = await recomputeAttendance(String(tenant), "all", addDays(istToday(), -31), addDays(istToday(), -1));
  return NextResponse.json({ ok: true, days });
}
