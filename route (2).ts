import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { BASE_PATH } from "@/lib/base-path";
import { hashToken, randomToken } from "@/lib/tokens";
import { notify } from "@/lib/notify";
import { fullName, fmtDate } from "@/components/ui";
import type { Tenant } from "@/lib/types";
import { recomputeAttendance } from "@/lib/attendance/service";
import { addDays, istToday } from "@/lib/attendance/time";
import { leaveYearOf } from "@/lib/leave/rules";
import { applyCredits } from "@/lib/leave/service";

export const maxDuration = 60;

// Daily job (vercel.json, 09:00 India time):
//  • reminds new joiners who have not finished onboarding (after 1, 3 and 5 days) and marks expired links
//  • finalises attendance for the last two days (marks absentees, picks up late device uploads)
//  • adds leave credits that have fallen due (yearly at the start of the leave year, monthly accruals)
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();
  const now = new Date();

  const { data: expired } = await db.from("onboarding_invites").update({ status: "expired" })
    .in("status", ["sent", "in_progress", "sent_back"]).lt("expires_at", now.toISOString()).select("id");

  const { data: open } = await db.from("onboarding_invites")
    .select("id,tenant_id,employee_id,created_at,reminders_sent,expires_at")
    .in("status", ["sent", "in_progress", "sent_back"]).lt("reminders_sent", 3).limit(500);

  let sent = 0;
  const tenants = new Map<string, Tenant | null>();
  for (const inv of open ?? []) {
    const ageDays = (now.getTime() - new Date(inv.created_at).getTime()) / 864e5;
    const due = [1, 3, 5][inv.reminders_sent] ?? Infinity;
    if (ageDays < due) continue;

    if (!tenants.has(inv.tenant_id)) {
      const { data: t } = await db.from("tenants").select("*").eq("id", inv.tenant_id).eq("active", true).maybeSingle();
      tenants.set(inv.tenant_id, (t as Tenant) ?? null);
    }
    const tenant = tenants.get(inv.tenant_id);
    if (!tenant) continue;
    const { data: emp } = await db.from("employees").select("first_name,last_name,email,mobile").eq("id", inv.employee_id).single();
    if (!emp) continue;

    // Links are stored hashed, so a reminder carries a fresh token for the same invite.
    const token = randomToken();
    await db.from("onboarding_invites").update({
      token_hash: hashToken(token), reminders_sent: inv.reminders_sent + 1, last_reminder_at: now.toISOString(),
    }).eq("id", inv.id);
    const { data: domain } = await db.from("tenant_domains").select("domain").eq("tenant_id", tenant.id).eq("is_primary", true).maybeSingle();
    const host = domain?.domain ?? (env.rootDomain ? `${tenant.slug}.${env.rootDomain}` : null);
    const base = env.publicUrl || (host ? `https://${host}${BASE_PATH}` : null);
    if (!base) continue;
    await notify({
      tenant, event: "onboarding_reminder", to: { name: fullName(emp), email: emp.email, phone: emp.mobile },
      vars: { link: `${base}/onboard/${token}`, expires_on: fmtDate(inv.expires_at) },
      related: { type: "employee", id: inv.employee_id },
    });
    sent++;
  }
  const attendance: Record<string, unknown> = {};
  const { data: allTenants } = await db.from("tenants").select("id,slug,settings").eq("active", true);
  const today = istToday();
  for (const t of allTenants ?? []) {
    try {
      const days = await recomputeAttendance(t.id, "all", addDays(today, -2), today, { db });
      const sm = Math.min(12, Math.max(1, (t.settings as Tenant["settings"])?.leave_year_start_month ?? 1));
      const credits = await applyCredits(t.id, leaveYearOf(today, sm), today);
      attendance[t.slug] = { days, credits };
    } catch (e) {
      console.error(`[cron] attendance for ${t.slug}`, e);
      attendance[t.slug] = { error: (e as Error).message };
    }
  }
  return NextResponse.json({ expired: expired?.length ?? 0, reminders: sent, attendance });
}
