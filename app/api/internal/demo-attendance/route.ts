import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeAttendance } from "@/lib/attendance/service";
import { addDays, istToday } from "@/lib/attendance/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by KMR Console › Test data after it loads the HRM sample data for the demo company: turns the sample
 * punches into attendance days. Only the Console can call it — the key is derived from the Supabase service key,
 * which both apps hold and which never leaves the servers.
 */
export async function POST(req: Request) {
  const expected = createHash("sha256").update(`kmr-internal:${env.serviceRoleKey}`).digest();
  const given = Buffer.from(req.headers.get("x-kmr-key") ?? "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tenant } = (await req.json().catch(() => ({}))) as { tenant?: string };
  if (!tenant || !/^[0-9a-f-]{36}$/.test(tenant)) return NextResponse.json({ error: "tenant required" }, { status: 400 });
  const { data } = await createAdminClient().from("tenants").select("id").eq("id", tenant).maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  await recomputeAttendance(tenant, "all", addDays(istToday(), -31), addDays(istToday(), -1));
  return NextResponse.json({ ok: true });
}
