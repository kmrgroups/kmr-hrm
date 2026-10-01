import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { BASE_PATH } from "@/lib/base-path";
import { hashToken } from "@/lib/tokens";
import { interviewToken } from "@/lib/recruit/links";
import { notify } from "@/lib/notify";
import { tenantById } from "@/lib/tenant";
import { fmtWhen, modeLabel } from "@/lib/recruit/format";
import type { Tenant } from "@/lib/types";

export const maxDuration = 60;
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);

// Daily recruitment job (vercel.json, about 8:30 AM India time):
//  • interview reminders to candidates — the day before, and on the morning of the interview
//  • courteous regret messages to declined candidates whose waiting days are over
//  • offers past their validity lapse (the candidate's link then says so)
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient(), now = new Date(), today = istDay(now), tomorrow = istDay(new Date(now.getTime() + 864e5));
  const origin = env.publicUrl || `${new URL(req.url).origin}${BASE_PATH}`;
  const tenants = new Map<string, Tenant | null>();
  const tenantOf = async (id: string) => { if (!tenants.has(id)) tenants.set(id, await tenantById(id)); return tenants.get(id)!; };
  let reminders = 0, regrets = 0;

  // interviews from now to the end of tomorrow (IST)
  const { data: ivs } = await db.from("interviews").select("id,tenant_id,starts_at,mode,venue,video_link,reminded_day_before,reminded_same_day,application:applications(candidate:candidates(full_name,email,phone),requisition:requisitions(title))")
    .in("status", ["scheduled", "confirmed"]).gte("starts_at", now.toISOString()).lt("starts_at", new Date(`${tomorrow}T23:59:59+05:30`).toISOString()).limit(500);
  for (const i of ivs ?? []) {
    const day = istDay(new Date(i.starts_at)), which = day === today ? "today" : day === tomorrow ? "tomorrow" : null;
    if (!which || (which === "today" ? i.reminded_same_day : i.reminded_day_before)) continue;
    const t = await tenantOf(i.tenant_id); if (!t) continue;
    const a = one(i.application as unknown as { candidate: { full_name: string; email: string | null; phone: string | null }; requisition: { title: string } });
    const c = one(a?.candidate);
    // the same confirm / reschedule link as in the invitation
    const token = interviewToken(i.id);
    await db.from("interviews").update({ token_hash: hashToken(token), ...(which === "today" ? { reminded_same_day: true } : { reminded_day_before: true }) }).eq("id", i.id);
    await notify({ tenant: t, event: "interview_reminder", to: { name: c?.full_name, email: c?.email, phone: c?.phone }, related: { type: "interviews", id: i.id },
      vars: { role: one(a?.requisition)?.title, day: which, when: fmtWhen(i.starts_at), mode: modeLabel(i.mode), where: i.mode === "video" ? `Join: ${i.video_link}` : i.mode === "phone" ? "We will call you." : `Venue: ${i.venue}`, link: `${origin}/interview/${token}` } });
    reminders++;
  }

  // regret messages that are due
  const { data: due } = await db.from("applications").select("id,tenant_id,candidate:candidates(full_name,email,phone),requisition:requisitions(title)")
    .eq("status", "declined").lte("regret_due", today).is("regret_sent_at", null).limit(300);
  for (const a of due ?? []) {
    const t = await tenantOf(a.tenant_id); if (!t) continue;
    const c = one(a.candidate as unknown as { full_name: string; email: string | null; phone: string | null });
    await db.from("applications").update({ regret_sent_at: new Date().toISOString() }).eq("id", a.id);
    await notify({ tenant: t, event: "recruit_regret", to: { name: c?.full_name, email: c?.email, phone: c?.phone }, related: { type: "applications", id: a.id },
      vars: { role: one(a.requisition as unknown as { title: string })?.title } });
    regrets++;
  }

  // offers past their date
  const { data: lapsed } = await db.from("offers").update({ status: "expired" }).eq("status", "sent").lt("valid_until", today).select("application_id");
  for (const o of lapsed ?? []) await db.from("applications").update({ status: "selected" }).eq("id", o.application_id).eq("status", "offered");

  return NextResponse.json({ ok: true, reminders, regrets, offers_lapsed: lapsed?.length ?? 0 });
}
