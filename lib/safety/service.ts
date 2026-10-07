import "server-only";
// Safety on the server: who hears about a new report, the action owner's e-mail, and the safety officer's daily e-mail.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { fullName } from "@/components/ui";
import { addDays, istDate, istToday, weekday } from "@/lib/attendance/time";
import { baseUrl } from "@/lib/engage/send";
import type { Tenant } from "@/lib/types";
import { KINDS, ppeFor, type PpeItem, type PpeIssue } from "./rules";

const when = (t: string) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const dmy = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** the safety officer (settings), else the company's HR managers */
export async function safetyPeople(db: SupabaseClient, tenantId: string): Promise<{ name: string; email: string }[]> {
  const { data: st } = await db.from("safety_settings").select("officer_name,officer_email").eq("tenant_id", tenantId).maybeSingle();
  if (st?.officer_email) return [{ name: st.officer_name ?? "Safety Officer", email: st.officer_email }];
  const { data } = await db.from("app_users").select("full_name,email,role").eq("tenant_id", tenantId).eq("active", true).in("role", ["hr_manager", "company_admin"]);
  const hr = (data ?? []).filter((u) => u.role === "hr_manager");
  return (hr.length ? hr : data ?? []).filter((u) => u.email).map((u) => ({ name: u.full_name, email: u.email }));
}

export async function notifyReported(tenant: Tenant, inc: { id: string; ref: string; kind: string; area: string | null; description: string; immediate_action: string | null; occurred_at: string; reported_by_name: string | null; sample: boolean }, origin: string) {
  if (inc.sample) return 0;
  const db = createAdminClient();
  const to = await safetyPeople(db, tenant.id);
  for (const p of to) await notify({ tenant, event: "safety_reported", to: { name: p.name, email: p.email }, channels: ["email"], related: { type: "incidents", id: inc.id },
    vars: { kind: KINDS[inc.kind] ?? inc.kind, ref: inc.ref, area: inc.area ?? "—", description: inc.description, action: inc.immediate_action ? `Immediate action: ${inc.immediate_action}` : "",
      reporter: inc.reported_by_name ?? "someone", when: when(inc.occurred_at), link: `${origin}/app/safety/incidents/${inc.id}` } });
  return to.length;
}

export async function notifyAction(tenant: Tenant, a: { id: string; action: string; due_on: string; owner_employee_id: string | null }, inc: { ref: string; kind: string; area: string | null; sample: boolean }, origin: string) {
  if (!a.owner_employee_id || inc.sample) return;
  const db = createAdminClient();
  const { data: e } = await db.from("employees").select("first_name,last_name,email,mobile").eq("id", a.owner_employee_id).eq("tenant_id", tenant.id).maybeSingle();
  if (!e) return;
  await notify({ tenant, event: "safety_action", to: { name: fullName(e), email: e.email, phone: e.mobile }, channels: ["email"], related: { type: "incident_actions", id: a.id },
    vars: { action: a.action, due: dmy(a.due_on), ref: inc.ref, kind: KINDS[inc.kind] ?? inc.kind, area: inc.area ?? "—", link: `${origin}/me/safety` } });
  await db.from("incident_actions").update({ notified_at: new Date().toISOString() }).eq("id", a.id);
}

/**
 * Daily (nightly job), one e-mail to the safety officer when there is something to do: actions past their date,
 * reports nobody has looked at for 2 days, PPE overdue or never issued, medical examinations due within 30 days.
 * Sent at most once a week when nothing new has become due (a Monday summary), daily when something new is overdue.
 */
export async function safetyDaily(db: SupabaseClient): Promise<{ digests: number }> {
  const today = istToday(), monday = weekday(today) === 1;
  const { data: tenants } = await db.from("tenants").select("*").eq("active", true);
  let digests = 0;
  for (const tenant of (tenants ?? []) as Tenant[]) {
    const [{ data: acts }, { data: fresh }, { data: items }, { data: issues }, { data: ppl }, { data: med }] = await Promise.all([
      db.from("incident_actions").select("action,due_on,owner_name,owner_employee_id,incident:incidents!inner(ref,sample)").eq("tenant_id", tenant.id).eq("status", "open").lt("due_on", today).limit(300),
      db.from("incidents").select("ref,kind,area,created_at,occurred_at,sample").eq("tenant_id", tenant.id).eq("status", "reported").eq("sample", false).lt("created_at", new Date(Date.now() - 2 * 864e5).toISOString()).limit(100),
      db.from("ppe_items").select("id,name,life_months,departments,for_all,active").eq("tenant_id", tenant.id),
      db.from("ppe_issues").select("employee_id,item_id,issued_on,next_due").eq("tenant_id", tenant.id).limit(20000),
      db.from("employees").select("id,department_id,email").eq("tenant_id", tenant.id).eq("status", "active").limit(5000),
      db.from("medical_checks").select("next_due,employee_id,sample").eq("tenant_id", tenant.id).eq("sample", false).lte("next_due", addDays(today, 30)).limit(2000),
    ]);
    const lateActs = (acts ?? []).filter((a) => !(a.incident as unknown as { sample: boolean }).sample);
    const newlyLate = lateActs.filter((a) => a.due_on === addDays(today, -1)).length;
    const realPeople = (ppl ?? []).filter((e) => !(e.email ?? "").endsWith("@demo.kmr.test"));
    let ppeOver = 0, ppeNever = 0;
    for (const e of realPeople) for (const x of ppeFor(e, (items ?? []) as PpeItem[], (issues ?? []) as PpeIssue[], today)) { if (x.state === "overdue") ppeOver++; if (x.state === "never") ppeNever++; }
    const lines = [
      ...lateActs.slice(0, 20).map((a) => `ACTION OVERDUE since ${dmy(a.due_on)}: ${a.action} (${(a.incident as unknown as { ref: string }).ref}${a.owner_name ? `, ${a.owner_name}` : ""})`),
      ...(fresh ?? []).map((f) => `NOT LOOKED AT: ${f.ref} ${KINDS[f.kind]} at ${f.area ?? "—"}, reported ${dmy(istDate(Date.parse(f.occurred_at)))}`),
      ...(ppeOver ? [`PPE overdue for replacement: ${ppeOver}`] : []), ...(ppeNever ? [`PPE never issued (people who need it): ${ppeNever}`] : []),
      ...((med?.length ?? 0) ? [`Medical examinations due within 30 days or overdue: ${med!.length}`] : []),
    ];
    if (!lines.length || (!newlyLate && !(fresh?.length) && !monday)) continue;
    const base = await baseUrl(db, tenant);
    for (const p of await safetyPeople(db, tenant.id)) {
      await notify({ tenant, event: "safety_digest", to: p, channels: ["email"],
        vars: { headline: `${lateActs.length} action${lateActs.length === 1 ? "" : "s"} overdue${fresh?.length ? `, ${fresh.length} report${fresh.length === 1 ? "" : "s"} not looked at` : ""}`, list: lines.map((l) => `• ${l}`).join("\n"), link: `${base ?? ""}/app/safety` } });
      digests++;
    }
  }
  return { digests };
}
