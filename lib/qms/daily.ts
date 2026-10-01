import "server-only";
// Daily QMS reminders (run by the nightly job): training reminders the day before, and training effectiveness
// evaluations that are due — one message per supervisor with his list.
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { BASE_PATH } from "@/lib/base-path";
import { notify } from "@/lib/notify";
import { fullName } from "@/components/ui";
import { addDays, istToday } from "@/lib/attendance/time";
import { fmtWhen } from "@/lib/recruit/format";
import type { Tenant } from "@/lib/types";

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

async function baseUrl(db: SupabaseClient, t: Tenant): Promise<string | null> {
  if (env.publicUrl) return env.publicUrl;
  const { data: d } = await db.from("tenant_domains").select("domain").eq("tenant_id", t.id).eq("is_primary", true).maybeSingle();
  const host = d?.domain ?? (env.rootDomain ? `${t.slug}.${env.rootDomain}` : null);
  return host ? `https://${host}${BASE_PATH}` : null;
}

export async function qmsDaily(db: SupabaseClient): Promise<{ trainingReminders: number; effectivenessNotices: number }> {
  const today = istToday(), tomorrow = addDays(today, 1);
  const tenants = new Map<string, Tenant | null>();
  const tenantOf = async (id: string) => {
    if (!tenants.has(id)) { const { data } = await db.from("tenants").select("*").eq("id", id).eq("active", true).maybeSingle(); tenants.set(id, (data as Tenant) ?? null); }
    return tenants.get(id) ?? null;
  };
  let trainingReminders = 0, effectivenessNotices = 0;

  // ---- training tomorrow (India time) ----
  const from = new Date(`${tomorrow}T00:00:00+05:30`).toISOString(), to = new Date(`${addDays(tomorrow, 1)}T00:00:00+05:30`).toISOString();
  const { data: sess } = await db.from("training_sessions").select("id,tenant_id,starts_at,venue,program:training_programs(title)")
    .eq("status", "scheduled").is("reminded_at", null).gte("starts_at", from).lt("starts_at", to).limit(200);
  for (const s of sess ?? []) {
    const tenant = await tenantOf(s.tenant_id); if (!tenant) continue;
    const { data: list } = await db.from("training_attendance").select("employee:employees(first_name,last_name,email,mobile,status)").eq("session_id", s.id);
    for (const a of list ?? []) {
      const e = one(a.employee as unknown as { first_name: string; last_name: string | null; email: string | null; mobile: string | null; status: string } | null);
      if (!e || e.status === "exited") continue;
      await notify({ tenant, event: "training_reminder", to: { name: fullName(e), email: e.email, phone: e.mobile }, related: { type: "training_sessions", id: s.id },
        vars: { training: one(s.program as unknown as { title: string } | null)?.title ?? "Training", when: fmtWhen(s.starts_at!), venue: s.venue ?? "to be told" } });
      trainingReminders++;
    }
    await db.from("training_sessions").update({ reminded_at: new Date().toISOString() }).eq("id", s.id);
  }

  // ---- effectiveness due: one message per supervisor ----
  const { data: due } = await db.from("training_effectiveness")
    .select("id,tenant_id,evaluator_id,due_on,employee:employees!training_effectiveness_employee_id_fkey(first_name,last_name),session:training_sessions(program:training_programs(title))")
    .is("result", null).is("notified_at", null).lte("due_on", today).not("evaluator_id", "is", null).limit(1000);
  const groups = new Map<string, NonNullable<typeof due>>();
  for (const d of due ?? []) groups.set(`${d.tenant_id}|${d.evaluator_id}`, [...(groups.get(`${d.tenant_id}|${d.evaluator_id}`) ?? []), d]);
  for (const [key, rows] of groups) {
    const [tid, evaluator] = key.split("|");
    const tenant = await tenantOf(tid!); if (!tenant) continue;
    const { data: sup } = await db.from("employees").select("first_name,last_name,email,mobile").eq("id", evaluator!).maybeSingle();
    const base = await baseUrl(db, tenant);
    if (sup && base) {
      const list = rows.map((r) => { const e = one(r.employee as unknown as { first_name: string; last_name: string | null } | null);
        const t = one(one(r.session as unknown as { program: { title: string } | { title: string }[] } | null)?.program);
        return `• ${e ? fullName(e) : "—"} — ${t?.title ?? "training"}`; }).join("\n");
      await notify({ tenant, event: "effectiveness_due", to: { name: fullName(sup), email: sup.email, phone: sup.mobile }, channels: ["email"], related: { type: "training_effectiveness", id: rows[0]!.id },
        vars: { count: rows.length, list, link: `${base}/app/qms/effectiveness` } });
      effectivenessNotices++;
      await db.from("training_effectiveness").update({ notified_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
    } else if (!sup) {
      await db.from("training_effectiveness").update({ notified_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));   // nobody to tell: HR sees it on the page
    }
  }
  return { trainingReminders, effectivenessNotices };
}
