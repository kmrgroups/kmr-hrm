import "server-only";
// Sending announcements and survey invitations to everybody they are meant for — and the daily job for engagement.
// A long list is sent in turns: whoever already got the message (the message log) is skipped, so the daily job
// finishes what one click could not, and nobody gets it twice. Sample people are never messaged.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { BASE_PATH } from "@/lib/base-path";
import { notify } from "@/lib/notify";
import { isSampleRecipient } from "@/lib/notify/render";
import { fullName } from "@/components/ui";
import { addDays, istToday } from "@/lib/attendance/time";
import type { NotificationEvent } from "@/lib/notify/templates";
import type { Tenant } from "@/lib/types";

export async function baseUrl(db: SupabaseClient, t: Tenant): Promise<string | null> {
  if (env.publicUrl) return env.publicUrl;
  const { data: d } = await db.from("tenant_domains").select("domain").eq("tenant_id", t.id).eq("is_primary", true).maybeSingle();
  const host = d?.domain ?? (env.rootDomain ? `${t.slug}.${env.rootDomain}` : null);
  return host ? `https://${host}${BASE_PATH}` : null;
}

interface Aud { audience: string; department_id: string | null; plant_id: string | null }
interface Person { id: string; first_name: string; last_name: string | null; email: string | null; mobile: string | null }

/** active employees in the audience who can be messaged (sample people left out) */
export async function audiencePeople(db: SupabaseClient, tenantId: string, a: Aud): Promise<Person[]> {
  let q = db.from("employees").select("id,first_name,last_name,email,mobile").eq("tenant_id", tenantId).eq("status", "active");
  if (a.audience === "department" && a.department_id) q = q.eq("department_id", a.department_id);
  if (a.audience === "plant" && a.plant_id) q = q.eq("plant_id", a.plant_id);
  const { data } = await q.limit(5000);
  return (data ?? []).filter((e) => !isSampleRecipient(e.email) && (e.email || e.mobile));
}

/**
 * Sends one event to a list of people, skipping those already sent this message for this record.
 * Stops after `budgetMs` and returns how many are still to go (the daily job continues).
 */
export async function sendToPeople(tenant: Tenant, event: NotificationEvent, related: { type: string; id: string }, people: Person[],
  vars: (p: Person) => Record<string, string | number>, budgetMs = 40000, channels: ("email" | "whatsapp")[] = ["email", "whatsapp"]): Promise<{ sent: number; left: number }> {
  const db = createAdminClient(), started = Date.now();
  const { data: done } = await db.from("notifications").select("recipient").eq("tenant_id", tenant.id).eq("event", event).eq("related_id", related.id).limit(20000);
  const had = new Set((done ?? []).map((d) => String(d.recipient).toLowerCase()));
  const todo = people.filter((p) => !(p.email && had.has(p.email.toLowerCase())) && !(p.mobile && had.has(p.mobile.toLowerCase())));
  let sent = 0;
  for (const p of todo) {
    if (Date.now() - started > budgetMs) break;
    await notify({ tenant, event, to: { name: fullName(p), email: p.email, phone: p.mobile }, related, vars: vars(p), channels });
    sent++;
  }
  return { sent, left: todo.length - sent };
}

/** announcement to its audience; sets notified_at when everybody has it */
export async function sendAnnouncement(tenant: Tenant, a: { id: string; title: string; body: string } & Aud, link: string, budgetMs = 40000) {
  const db = createAdminClient();
  const people = await audiencePeople(db, tenant.id, a);
  const r = await sendToPeople(tenant, "announcement", { type: "announcements", id: a.id }, people, () => ({ title: a.title, body: a.body, link }), budgetMs);
  if (r.left === 0) await db.from("announcements").update({ notified_at: new Date().toISOString() }).eq("id", a.id);
  return r;
}

const privacyLine = (anonymous: boolean) => anonymous ? "Your answers are anonymous: they carry no name, and results are shown only for groups of 5 or more." : "This survey is not anonymous: HR will see your name with your answers.";

/** survey invitation to its audience (those who have answered are skipped too) */
export async function sendSurveyInvites(tenant: Tenant, s: { id: string; title: string; anonymous: boolean; closes_on: string | null } & Aud, link: string, event: "survey_invite" | "survey_reminder" = "survey_invite", budgetMs = 40000) {
  const db = createAdminClient();
  const [people, { data: answered }] = await Promise.all([audiencePeople(db, tenant.id, s), db.from("survey_participants").select("employee_id").eq("survey_id", s.id)]);
  const has = new Set((answered ?? []).map((x) => x.employee_id));
  const closes = s.closes_on ? new Date(`${s.closes_on}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "";
  const r = await sendToPeople(tenant, event, { type: "surveys", id: s.id }, people.filter((p) => !has.has(p.id)),
    () => ({ survey: s.title, until: closes ? `, open until ${closes}` : "", closes_on: closes, privacy: privacyLine(s.anonymous), link }), budgetMs,
    event === "survey_reminder" ? ["email"] : ["email", "whatsapp"]);
  if (r.left === 0) await db.from("surveys").update(event === "survey_invite" ? { notified_at: new Date().toISOString() } : { reminded_at: new Date().toISOString() }).eq("id", s.id);
  return r;
}

/**
 * Daily (nightly job): announcements whose publish date has come (and long lists not finished), surveys that open
 * today, reminders two days before a survey closes, and surveys past their closing date are closed.
 */
export async function engageDaily(db: SupabaseClient): Promise<{ announcements: number; invites: number; reminders: number; closed: number }> {
  const today = istToday();
  const tenants = new Map<string, Tenant | null>();
  const tenantOf = async (id: string) => {
    if (!tenants.has(id)) { const { data } = await db.from("tenants").select("*").eq("id", id).eq("active", true).maybeSingle(); tenants.set(id, (data as Tenant) ?? null); }
    return tenants.get(id) ?? null;
  };
  let announcements = 0, invites = 0, reminders = 0;
  const { data: anns } = await db.from("announcements").select("id,tenant_id,title,body,audience,department_id,plant_id,publish_on")
    .eq("status", "published").eq("notify", true).is("notified_at", null).eq("sample", false).or(`publish_on.is.null,publish_on.lte.${today}`).limit(50);
  for (const a of anns ?? []) {
    const t = await tenantOf(a.tenant_id); const base = t ? await baseUrl(db, t) : null; if (!t || !base) continue;
    if (!a.publish_on || a.publish_on <= today) await db.from("announcements").update({ published_at: new Date().toISOString() }).eq("id", a.id).is("published_at", null);
    announcements += (await sendAnnouncement(t, a, `${base}/me/engage`, 15000)).sent;
  }
  const { data: closed } = await db.from("surveys").update({ status: "closed" }).eq("status", "open").lt("closes_on", today).select("id");
  const { data: opening } = await db.from("surveys").select("id,tenant_id,title,anonymous,closes_on,audience,department_id,plant_id")
    .eq("status", "open").is("notified_at", null).eq("sample", false).or(`opens_on.is.null,opens_on.lte.${today}`).limit(50);
  for (const s of opening ?? []) {
    const t = await tenantOf(s.tenant_id); const base = t ? await baseUrl(db, t) : null; if (!t || !base) continue;
    invites += (await sendSurveyInvites(t, s, `${base}/me/engage/survey/${s.id}`, "survey_invite", 15000)).sent;
  }
  const { data: closing } = await db.from("surveys").select("id,tenant_id,title,anonymous,closes_on,audience,department_id,plant_id")
    .eq("status", "open").is("reminded_at", null).not("notified_at", "is", null).eq("sample", false).lte("closes_on", addDays(today, 2)).gte("closes_on", today).limit(50);
  for (const s of closing ?? []) {
    const t = await tenantOf(s.tenant_id); const base = t ? await baseUrl(db, t) : null; if (!t || !base) continue;
    reminders += (await sendSurveyInvites(t, s, `${base}/me/engage/survey/${s.id}`, "survey_reminder", 15000)).sent;
  }
  return { announcements, invites, reminders, closed: closed?.length ?? 0 };
}
