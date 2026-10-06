"use server";
// Safety — incidents (report, investigate, actions, close), PPE (list, issue), medical examination dates, settings.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, hasRole, HR_ROLES, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { currentOrigin } from "@/lib/tenant";
import { addDays, istToday } from "@/lib/attendance/time";
import { uploadSafetyFile } from "@/lib/safety/upload";
import { KINDS, canClose, addMonthsIso } from "@/lib/safety/rules";
import { notifyAction, notifyReported } from "@/lib/safety/service";
import { draftWhyWhy, type WhyDraft } from "@/lib/safety/ai";
import type { ActionState } from "@/app/app/employees/actions";
import type { Role } from "@/lib/types";

const HR = HR_ROLES;
const TEAM: Role[] = [...HR_ROLES, "manager"];
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const done = async (ok: string): Promise<ActionState> => { await setFlash({ ok }); return { ok, flashed: true }; };
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 500) => str(f, k, max) || null;
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const uuid = (f: FormData, k: string) => { const v = str(f, k, 40); return isId(v) ? v : null; };
const isDate = (d: string | null): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const err = (e: { message: string } | null) => { if (e) throw new Error(e.message.includes("duplicate") ? "This already exists." : e.message); };
const actorOf = (s: Session) => ({ tenantId: s.tenant.id, userId: s.user.id, userName: s.user.full_name });
const refresh = (...p: string[]) => { for (const x of ["/app/safety", "/app/safety/incidents", "/me/safety", ...p]) revalidatePath(x); };

/** when: a datetime-local in India time → ISO; not in the future */
function whenOf(f: FormData): string | null {
  const v = str(f, "occurred_at", 20);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return d.getTime() > Date.now() + 5 * 60e3 ? null : d.toISOString();
}

// ================================================================== incidents
export async function reportIncident(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const kind = str(f, "kind", 30), description = str(f, "description", 3000);
    if (!(kind in KINDS)) return { error: "Choose what happened." };
    if (description.length < 5) return { error: "Describe what happened." };
    const at = whenOf(f); if (!at) return { error: "When did it happen? (not in the future)" };
    const photo = await uploadSafetyFile(s.tenant.id, f, "photo"); if (photo && typeof photo === "object") return photo;
    const db = await createClient();
    const { data, error } = await db.from("incidents").insert({ tenant_id: s.tenant.id, kind, occurred_at: at, plant_id: uuid(f, "plant_id"), department_id: uuid(f, "department_id"), area: opt(f, "area", 160),
      description, immediate_action: opt(f, "immediate_action", 2000), injured_employee_id: uuid(f, "injured_employee_id"), injured_other: opt(f, "injured_other", 160), injury_nature: opt(f, "injury_nature", 300),
      days_lost: Math.max(0, Number(str(f, "days_lost", 4)) || 0), potential: Number(str(f, "potential", 1)) || null, photo_path: photo as string | null,
      reported_by: s.user.id, reported_by_name: s.user.full_name, reported_by_employee_id: s.user.employee_id }).select("*").single(); err(error);
    id = data!.id;
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "safety.reported", entity: "incidents", entityId: id, data: { kind } });
    const n = await notifyReported(s.tenant, data!, await currentOrigin());
    await setFlash({ ok: `${data!.ref} recorded${n ? " and the safety officer told" : ""}. Investigate it: what happened, why, and what stops it happening again.` });
  } catch (e) { return fail(e); }
  redirect(`/app/safety/incidents/${id}`);
}

export async function saveInvestigation(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: cur } = await db.from("incidents").select("status,kind").eq("id", id).single();
    if (!cur) return { error: "Not found." };
    const kind = str(f, "kind", 30);
    const why = [0, 1, 2, 3, 4].map((i) => str(f, `why_${i}`, 300)).filter(Boolean);
    const notified = opt(f, "authority_notified_on", 10);
    if (notified && !isDate(notified)) return { error: "Authority notified on: choose a date." };
    const fields: Record<string, unknown> = { kind: kind in KINDS ? kind : cur.kind, area: opt(f, "area", 160), description: str(f, "description", 3000) || undefined, immediate_action: opt(f, "immediate_action", 2000),
      injured_employee_id: uuid(f, "injured_employee_id"), injured_other: opt(f, "injured_other", 160), injury_nature: opt(f, "injury_nature", 300),
      days_lost: Math.max(0, Number(str(f, "days_lost", 4)) || 0), potential: Number(str(f, "potential", 1)) || null, investigator_name: opt(f, "investigator_name", 120) ?? s.user.full_name,
      why_why: why, root_cause: opt(f, "root_cause", 2000), reportable: f.get("reportable") === "on", authority_notified_on: notified, authority_ref: opt(f, "authority_ref", 120) };
    if (fields.kind === "lost_time" && !(Number(fields.days_lost) > 0)) return { error: "A lost-time injury has days lost — enter them." };
    if (cur.status === "reported") fields.status = "investigating";
    if (!fields.description) delete fields.description;
    const { error } = await db.from("incidents").update(fields).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "safety.investigated", entity: "incidents", entityId: id });
    refresh(`/app/safety/incidents/${id}`);
    return { ok: "Saved." };
  } catch (e) { return fail(e); }
}

export async function aiWhyWhy(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: inc } = await db.from("incidents").select("ref,kind,area,description,immediate_action,injury_nature,status").eq("id", id).single();
    if (!inc) return { error: "Not found." };
    const r = await draftWhyWhy(db as never, actorOf(s), inc);
    if ("error" in r) return { error: r.error };
    const { error } = await db.from("incidents").update({ why_why: r.draft.why, root_cause: r.draft.root_cause, ai_actions: r.draft.actions, ai_model: r.model,
      ...(inc.status === "reported" ? { status: "investigating", investigator_name: s.user.full_name } : {}) }).eq("id", id); err(error);
    refresh(`/app/safety/incidents/${id}`);
    return done("The AI drafted the why-why, the root cause and suggested actions. Check them against what really happened — correct and save; add only the actions you agree with.");
  } catch (e) { return fail(e); }
}

export async function addAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const iid = uuid(f, "incident_id"); if (!iid) return { error: "Not found." };
    const db = await createClient();
    const { data: inc } = await db.from("incidents").select("id,ref,kind,area,status,sample,ai_actions").eq("id", iid).single();
    if (!inc) return { error: "Not found." };
    if (inc.status === "closed") return { error: "The incident is closed — reopen it first." };
    const today = istToday();
    // one action typed in, or the AI suggestions ticked
    const rows: { action: string; kind: string; due_on: string; owner_employee_id: string | null; owner_name: string | null }[] = [];
    const owner = uuid(f, "owner_employee_id"), ownerName = opt(f, "owner_name", 120);
    const text = str(f, "action", 1000);
    if (text) {
      const due = str(f, "due_on", 10); if (!isDate(due)) return { error: "Choose the due date." };
      if (!owner && !ownerName) return { error: "Who will do it? Choose a person or write the position." };
      rows.push({ action: text, kind: str(f, "kind", 12) === "preventive" ? "preventive" : "corrective", due_on: due, owner_employee_id: owner, owner_name: ownerName });
    }
    const picks = f.getAll("ai_pick").map(Number).filter((n) => Number.isInteger(n));
    const sugg = (inc.ai_actions ?? []) as WhyDraft["actions"];
    for (const i of picks) { const a = sugg[i]; if (a) rows.push({ action: a.action, kind: a.kind, due_on: addDays(today, a.days), owner_employee_id: owner, owner_name: ownerName ?? (owner ? null : "To be assigned") }); }
    if (!rows.length) return { error: "Write the action, or tick a suggested one." };
    const { data: ins, error } = await db.from("incident_actions").insert(rows.map((r) => ({ tenant_id: s.tenant.id, incident_id: iid, ...r }))).select("id,action,due_on,owner_employee_id"); err(error);
    if (inc.status !== "action") await db.from("incidents").update({ status: "action" }).eq("id", iid);
    if (picks.length) await db.from("incidents").update({ ai_actions: sugg.filter((_, i) => !picks.includes(i)) }).eq("id", iid);
    const origin = await currentOrigin();
    for (const a of ins ?? []) await notifyAction(s.tenant, a, inc, origin);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "safety.action_added", entity: "incidents", entityId: iid, data: { actions: rows.length } });
    refresh(`/app/safety/incidents/${iid}`);
    return { ok: `${rows.length} action${rows.length === 1 ? "" : "s"} added${(ins ?? []).some((a) => a.owner_employee_id) ? " — the owner is told by e-mail" : ""}.` };
  } catch (e) { return fail(e); }
}

export async function actionDone(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const reopen = f.get("reopen") === "1";
    const on = str(f, "done_on", 10) || istToday();
    if (!reopen && (!isDate(on) || on > istToday())) return { error: "Done on: a date, not in the future." };
    const db = await createClient();
    const { data: a, error } = await db.from("incident_actions").update(reopen ? { status: "open", done_on: null, done_note: null } : { status: "done", done_on: on, done_note: opt(f, "done_note", 1000) }).eq("id", id).select("incident_id").single(); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: reopen ? "safety.action_reopened" : "safety.action_done", entity: "incident_actions", entityId: id });
    refresh(`/app/safety/incidents/${a!.incident_id}`);
    return done(reopen ? "Action open again." : "Action done.");
  } catch (e) { return fail(e); }
}

export async function closeIncident(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: inc } = await db.from("incidents").select("id,ref,kind,root_cause,status").eq("id", id).single();
    if (!inc) return { error: "Not found." };
    if (f.get("reopen") === "1") {
      const { error } = await db.from("incidents").update({ status: "action", closed_at: null, closed_by_name: null }).eq("id", id); err(error);
      refresh(`/app/safety/incidents/${id}`); return done(`${inc.ref} reopened.`);
    }
    const { data: acts } = await db.from("incident_actions").select("status").eq("incident_id", id);
    const why = canClose(inc, acts ?? []); if (why) return { error: why };
    const { error } = await db.from("incidents").update({ status: "closed", closed_at: new Date().toISOString(), closed_by_name: s.user.full_name }).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "safety.closed", entity: "incidents", entityId: id });
    refresh(`/app/safety/incidents/${id}`);
    return done(`${inc.ref} closed by ${s.user.full_name}.`);
  } catch (e) { return fail(e); }
}

export async function saveSafetySettings(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const email = opt(f, "officer_email", 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "E-mail is not valid." };
    const hours = Number(str(f, "hours_per_day", 5)) || 8, target = str(f, "ltifr_target", 10);
    const db = await createClient();
    const { error } = await db.from("safety_settings").upsert({ tenant_id: s.tenant.id, officer_name: opt(f, "officer_name", 120), officer_email: email,
      hours_per_day: Math.min(24, Math.max(1, hours)), ltifr_target: target === "" ? null : Number(target) }, { onConflict: "tenant_id" }); err(error);
    refresh();
    return { ok: "Saved." };
  } catch (e) { return fail(e); }
}

// ================================================================== PPE
export async function savePpeItem(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), name = str(f, "name", 80);
    if (name.length < 2) return { error: "Name the PPE." };
    const life = Number(str(f, "life_months", 3));
    if (!(life >= 1 && life <= 120)) return { error: "Replace after: 1 to 120 months." };
    const row = { tenant_id: s.tenant.id, name, life_months: life, sizes: opt(f, "sizes", 200), departments: f.getAll("departments").map(String).filter(isId), for_all: f.get("for_all") === "on", active: f.get("active") !== "off" };
    const db = await createClient();
    const { error } = id ? await db.from("ppe_items").update(row).eq("id", id) : await db.from("ppe_items").insert(row); err(error);
    refresh("/app/safety/ppe");
    return { ok: id ? "Saved." : `${name} added.` };
  } catch (e) { return fail(e); }
}

export async function issuePpe(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const emps = f.getAll("employee_id").map(String).filter(isId), item = uuid(f, "item_id"), on = str(f, "issued_on", 10) || istToday();
    if (!emps.length) return { error: "Choose the person (or people)." };
    if (!item) return { error: "Choose the PPE." };
    if (!isDate(on) || on > istToday()) return { error: "Issued on: a date, not in the future." };
    const qty = Math.min(100, Math.max(1, Number(str(f, "qty", 3)) || 1));
    const db = await createClient();
    const { data: it } = await db.from("ppe_items").select("name,life_months").eq("id", item).single();
    if (!it) return { error: "PPE not found." };
    const { error } = await db.from("ppe_issues").insert(emps.map((e) => ({ tenant_id: s.tenant.id, employee_id: e, item_id: item, issued_on: on, qty, size: opt(f, "size", 20),
      next_due: addMonthsIso(on, it.life_months), issued_by_name: s.user.full_name, note: opt(f, "note", 300) })));
    if (error) return { error: error.message.includes("row-level") ? (hasRole(s.user, HR) ? error.message : "You can issue PPE only to your team.") : error.message };
    refresh("/app/safety/ppe");
    return { ok: `${it.name} issued to ${emps.length} ${emps.length === 1 ? "person" : "people"}; due again ${addMonthsIso(on, it.life_months)}.` };
  } catch (e) { return fail(e); }
}

// ================================================================== medical examination dates
export async function saveMedical(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const emp = uuid(f, "employee_id"); if (!emp) return { error: "Choose the person." };
    const doneOn = opt(f, "done_on", 10), next = opt(f, "next_due", 10);
    if (doneOn && (!isDate(doneOn) || doneOn > istToday())) return { error: "Done on: a date, not in the future." };
    if (next && !isDate(next)) return { error: "Next due: choose a date." };
    if (!doneOn && !next) return { error: "Give the date it was done, or when it is due." };
    const cert = await uploadSafetyFile(s.tenant.id, f, "certificate"); if (cert && typeof cert === "object") return cert;
    const db = await createClient();
    const { error } = await db.from("medical_checks").insert({ tenant_id: s.tenant.id, employee_id: emp, kind: str(f, "kind", 20) || "periodic", done_on: doneOn,
      next_due: next ?? (doneOn ? addMonthsIso(doneOn, 12) : null), doctor: opt(f, "doctor", 160), certificate_path: cert as string | null, note: opt(f, "note", 300) }); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "safety.medical_recorded", entity: "medical_checks", entityId: emp });
    refresh("/app/safety/medical");
    return { ok: "Recorded." };
  } catch (e) { return fail(e); }
}
