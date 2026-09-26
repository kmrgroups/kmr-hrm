import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { BASE_PATH } from "@/lib/base-path";
import { hashToken, randomToken } from "@/lib/tokens";
import { notify } from "@/lib/notify";
import { fullName, fmtDate } from "@/components/ui";
import type { Tenant } from "@/lib/types";

// Daily job (vercel.json): reminds new joiners who have not finished onboarding
// (after 1, 3 and 5 days) and marks expired links.
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
  return NextResponse.json({ expired: expired?.length ?? 0, reminders: sent });
}
