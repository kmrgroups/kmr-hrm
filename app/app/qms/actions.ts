"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { notify } from "@/lib/notify";
import { currentOrigin } from "@/lib/tenant";
import { fullName } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { fromLocal, fmtWhen } from "@/lib/recruit/format";
import { addDaysIso, addMonths, findNeeds, planFromNeeds, QUALIFIED } from "@/lib/qms/rules";
import { isSampleRecipient } from "@/lib/notify/render";
import { smartJd } from "@/lib/qms/ai";
import { ensurePosition, writeSheetFromJd } from "@/lib/qms/positions";
import { competencyCategory } from "@/lib/qms/sheet";
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
const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter(isId);
const lines = (f: FormData, k: string, maxLines = 40, maxLen = 300) =>
  str(f, k, 20000).split(/\r?\n/).map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim()).filter(Boolean).slice(0, maxLines).map((l) => l.slice(0, maxLen));
const int = (f: FormData, k: string) => { const s = str(f, k, 20); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? Math.round(n) : NaN; };
const num = (f: FormData, k: string) => { const s = str(f, k, 30).replace(/,/g, ""); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const isMonth = (m: string | null) => !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const isDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const err = (e: { message: string } | null) => { if (e) throw new Error(e.message.includes("duplicate") ? "This already exists." : e.message); };

// ------------------------------------------------------------------ settings
export async function saveQmsSettings(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const min = int(f, "min_qualified"), eff = int(f, "eff_days"), nj = int(f, "new_joiner_days");
    if (!min || min < 1 || min > 20) return { error: "Qualified people per operation: 1 to 20." };
    if (![30, 60, 90].includes(eff ?? 0)) return { error: "Effectiveness check: after 30, 60 or 90 days." };
    if (!nj || nj < 1 || nj > 180) return { error: "New joiner period: 1 to 180 days." };
    const db = await createClient();
    const { error } = await db.from("qms_settings").upsert({ tenant_id: tenant.id, quality_policy: opt(f, "quality_policy", 3000), objectives: lines(f, "objectives", 20),
      csr: lines(f, "csr", 40), min_qualified: min, eff_days: eff, new_joiner_days: nj });
    err(error);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.settings_saved", entity: "qms_settings", entityId: tenant.id });
    revalidatePath("/app/settings/qms");
    return { ok: "Saved." };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ skill matrix and competency levels (grid)
export async function saveLevels(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const kind = str(f, "kind", 20);
    let changes: { row: string; col: string; level: number }[];
    try { changes = JSON.parse(str(f, "changes", 200000)); } catch { return { error: "Nothing to save." }; }
    changes = (Array.isArray(changes) ? changes : []).filter((c) => isId(c.row) && isId(c.col) && Number.isInteger(c.level) && c.level >= 0 && c.level <= 4).slice(0, 2000);
    if (!changes.length) return { error: "Nothing to save." };
    const db = await createClient();
    const today = istToday();
    if (kind === "skill") {
      const { data: cur } = await db.from("skill_levels").select("employee_id,operation_id,level,certified_on,valid_until").in("employee_id", [...new Set(changes.map((c) => c.row))]);
      const old = new Map((cur ?? []).map((r) => [`${r.employee_id}|${r.operation_id}`, r]));
      for (const c of changes) {
        const prev = old.get(`${c.row}|${c.col}`);
        if (c.level === 0) { const { error } = await db.from("skill_levels").delete().eq("employee_id", c.row).eq("operation_id", c.col); err(error); continue; }
        const newlyQualified = c.level >= QUALIFIED && (!prev || prev.level < QUALIFIED);
        const { error } = await db.from("skill_levels").upsert({ tenant_id: tenant.id, employee_id: c.row, operation_id: c.col, level: c.level,
          certified_on: newlyQualified ? today : c.level >= QUALIFIED ? prev?.certified_on ?? today : null,
          valid_until: newlyQualified ? addDaysIso(today, 365) : c.level >= QUALIFIED ? prev?.valid_until ?? addDaysIso(today, 365) : null,
          assessed_by: user.id, assessed_by_name: user.full_name }, { onConflict: "employee_id,operation_id" });
        err(error);
      }
      // a person newly qualified on an operation closes his open need for it
      const q = changes.filter((c) => c.level >= QUALIFIED);
      for (const c of q) await db.from("training_needs").update({ status: "closed" }).eq("employee_id", c.row).eq("operation_id", c.col).in("status", ["open", "planned"]);
      revalidatePath("/app/qms/skills");
    } else if (kind === "competency") {
      for (const c of changes) {
        const { error } = await db.from("employee_competencies").upsert({ tenant_id: tenant.id, employee_id: c.row, competency_id: c.col, level: c.level,
          assessed_on: today, assessed_by: user.id, assessed_by_name: user.full_name, method: "observation" }, { onConflict: "employee_id,competency_id" });
        err(error);
      }
      revalidatePath("/app/qms/competency");
    } else return { error: "Unknown grid." };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `qms.${kind}_levels_saved`, entity: kind === "skill" ? "skill_levels" : "employee_competencies", data: { changes: changes.length } });
    return { ok: `Saved ${changes.length} change${changes.length > 1 ? "s" : ""}.` };
  } catch (e) { return fail(e); }
}

export async function saveOperation(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), line = str(f, "line", 80), code = str(f, "code", 20).toUpperCase(), name = str(f, "name", 120);
    if (!line || !code || name.length < 2) return { error: "Line, operation code and name are needed." };
    const min = int(f, "min_qualified");
    if (min != null && (Number.isNaN(min) || min < 1 || min > 20)) return { error: "Qualified people needed: 1 to 20, or blank for the company setting." };
    const row = { tenant_id: tenant.id, plant_id: uuid(f, "plant_id"), line, code, name, machine: opt(f, "machine", 80), critical: f.get("critical") === "on",
      safety_required: f.get("safety_required") === "on", min_qualified: min, sort_order: int(f, "sort_order") || 0, active: f.get("inactive") !== "on" };
    const db = await createClient();
    const { error } = id ? await db.from("operations").update(row).eq("id", id) : await db.from("operations").insert(row);
    err(error);
    revalidatePath("/app/qms/skills");
    return id ? done(`${code} saved.`) : { ok: `${code} ${name} added to ${line}.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ competency library and role requirements
export async function saveCompetency(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), name = str(f, "name", 120), category = str(f, "category", 20);
    if (name.length < 2) return { error: "Name the competency." };
    if (!["technical", "quality", "safety", "behavioural", "management"].includes(category)) return { error: "Choose a category." };
    const row = { tenant_id: tenant.id, name, category, description: opt(f, "description", 600), active: f.get("inactive") !== "on" };
    const db = await createClient();
    const { error } = id ? await db.from("competencies").update(row).eq("id", id) : await db.from("competencies").insert(row);
    err(error);
    revalidatePath("/app/qms/competency");
    return id ? done("Saved.") : { ok: `${name} added to the library.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ training need identification
export async function findTrainingNeeds(_: ActionState, f: FormData): Promise<ActionState> {
  void f;
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const db = await createClient();
    const today = istToday();
    const [emps, req, assessed, comps, ops, skills, progs, attended, open, st] = await Promise.all([
      fetchAll<{ id: string; position_id: string | null; date_of_joining: string | null; status: string }>((a, b) =>
        db.from("employees").select("id,position_id,date_of_joining,status").in("status", ["active", "invited", "onboarding", "submitted"]).range(a, b)),
      db.from("role_competencies").select("position_id,competency_id,required_level").not("position_id", "is", null).then((r) => (r.data ?? []) as { position_id: string; competency_id: string; required_level: number }[]),
      fetchAll<{ employee_id: string; competency_id: string; level: number }>((a, b) => db.from("employee_competencies").select("employee_id,competency_id,level").range(a, b)),
      db.from("competencies").select("id,name").then((r) => r.data ?? []),
      db.from("operations").select("id,line,code,name,critical,min_qualified").eq("active", true).then((r) => r.data ?? []),
      fetchAll<{ employee_id: string; operation_id: string; level: number; valid_until: string | null }>((a, b) => db.from("skill_levels").select("employee_id,operation_id,level,valid_until").range(a, b)),
      db.from("training_programs").select("id,title,category,competency_id,operation_id,active").then((r) => r.data ?? []),
      fetchAll<{ employee_id: string; session: unknown }>((a, b) =>
        db.from("training_attendance").select("employee_id,session:training_sessions(program_id,starts_at,plan_month)").eq("attended", true).range(a, b)),
      fetchAll<{ employee_id: string; source: string; competency_id: string | null; operation_id: string | null; program_id: string | null }>((a, b) =>
        db.from("training_needs").select("employee_id,source,competency_id,operation_id,program_id").in("status", ["open", "planned"]).range(a, b)),
      db.from("qms_settings").select("min_qualified,new_joiner_days").maybeSingle().then((r) => r.data),
    ]);
    const drafts = findNeeds({
      people: emps, requirements: req, assessed, competencyNames: Object.fromEntries(comps.map((c) => [c.id, c.name])),
      ops, skills, minQualified: st?.min_qualified ?? 2, programs: progs,
      attended: attended.filter((a) => a.session).map((a) => {
        const s = (Array.isArray(a.session) ? a.session[0] : a.session) as { program_id: string; starts_at: string | null; plan_month: string } | null;
        return { employee_id: a.employee_id, program_id: s!.program_id, on: s!.starts_at ? s!.starts_at.slice(0, 10) : `${s!.plan_month}-15` };
      }),
      open, newJoinerDays: st?.new_joiner_days ?? 30,
    }, today);
    if (!drafts.length) return { ok: "No new training needs: every gap already has an open need." };
    let added = 0;
    for (const d of drafts) {       // one by one: a need already open for the same thing is skipped by the database
      const r = await db.from("training_needs").insert({ ...d, tenant_id: tenant.id, raised_by: user.id, raised_by_name: "HRM (from the records)" });
      if (!r.error) added++; else if (!r.error.message.includes("duplicate")) throw new Error(r.error.message);
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.tni_found", entity: "training_needs", data: { added } });
    revalidatePath("/app/qms/needs");
    return done(`${added} new training need${added === 1 ? "" : "s"} found from competency gaps, the skill matrix, new joiners and awareness.`);
  } catch (e) { return fail(e); }
}

export async function addNeed(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const hr = hasRole(user, HR);
    const db = await createClient();
    let emps = ids(f, "employee_id");
    const dept = uuid(f, "department_id"), desig = uuid(f, "designation_id");
    if (hr && (dept || desig)) {
      let q = db.from("employees").select("id").eq("status", "active");
      if (dept) q = q.eq("department_id", dept);
      if (desig) q = q.eq("designation_id", desig);
      const { data } = await q;
      emps = [...new Set([...emps, ...(data ?? []).map((r) => r.id)])];
    }
    if (!emps.length) return { error: "Choose the people (or, for HR, a department / designation)." };
    const program = uuid(f, "program_id");
    let topic = str(f, "topic", 200);
    if (program && !topic) { const { data } = await db.from("training_programs").select("title").eq("id", program).maybeSingle(); topic = data?.title ?? ""; }
    if (topic.length < 2) return { error: "What training is needed?" };
    const source = hr ? str(f, "source", 30) : "request";
    if (!["process_change", "customer_complaint", "audit_finding", "request", "awareness", "competency_gap", "skill_gap", "new_joiner"].includes(source)) return { error: "Choose why it is needed." };
    const target = opt(f, "target_month", 7);
    if (target && !isMonth(target)) return { error: "Choose a month." };
    const priority = ["high", "normal", "low"].includes(str(f, "priority", 10)) ? str(f, "priority", 10) : "normal";
    const { data: prog } = program ? await db.from("training_programs").select("competency_id,operation_id").eq("id", program).maybeSingle() : { data: null };
    let added = 0;
    for (const e of emps.slice(0, 500)) {
      const { error } = await db.from("training_needs").insert({ tenant_id: tenant.id, employee_id: e, program_id: program, competency_id: prog?.competency_id ?? null, operation_id: prog?.operation_id ?? null,
        topic, source, reason: opt(f, "reason", 500), priority, status: "open", target_month: target, raised_by: user.id, raised_by_name: user.full_name });
      if (!error) added++; else if (!error.message.includes("duplicate")) throw new Error(error.message);
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.need_added", entity: "training_needs", data: { topic, source, people: added } });
    revalidatePath("/app/qms/needs");
    return { ok: added ? `Training need recorded for ${added} ${added === 1 ? "person" : "people"}.` : "These people already have this need open." };
  } catch (e) { return fail(e); }
}

export async function setNeedStatus(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), status = str(f, "status", 20);
    if (!id || !["open", "closed", "cancelled"].includes(status)) return { error: "Unknown change." };
    const db = await createClient();
    const { error } = await db.from("training_needs").update({ status, ...(status !== "open" ? {} : { session_id: null }) }).eq("id", id);
    err(error);
    if (status !== "open") await db.from("training_attendance").delete().eq("need_id", id).is("attended", null);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `qms.need_${status}`, entity: "training_needs", entityId: id });
    revalidatePath("/app/qms/needs");
    return done(status === "cancelled" ? "Need cancelled." : status === "closed" ? "Need closed." : "Need reopened.");
  } catch (e) { return fail(e); }
}

/** puts the open needs into the training plan: sessions per programme per month */
export async function buildPlan(_: ActionState, f: FormData): Promise<ActionState> {
  void f;
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const db = await createClient();
    const month = istToday().slice(0, 7);
    const [needs, sess] = await Promise.all([
      fetchAll<{ id: string; employee_id: string; program_id: string | null; priority: string; target_month: string | null }>((a, b) =>
        db.from("training_needs").select("id,employee_id,program_id,priority,target_month").eq("status", "open").order("priority").order("created_at").range(a, b)),
      db.from("training_sessions").select("id,program_id,plan_month,status,training_attendance(count)").in("status", ["planned", "scheduled"]).gte("plan_month", month).then((r) => r.data ?? []),
    ]);
    const steps = planFromNeeds(needs, sess.map((s) => ({ id: s.id, program_id: s.program_id, plan_month: s.plan_month, status: s.status,
      size: (s.training_attendance as unknown as { count: number }[])?.[0]?.count ?? 0 })), month);
    if (!steps.length) return { error: needs.length ? "The open needs have no training programme linked. Link a programme to each need first." : "There are no open training needs." };
    let created = 0, placed = 0;
    const { data: mails } = await db.from("employees").select("id,email").in("id", [...new Set(steps.flatMap((x) => x.employee_ids))]);
    for (const s of steps) {
      let sid = s.session_id;
      if (!sid) {
        // a session only for sample people is sample data too (the sample flush removes it)
        const sample = s.employee_ids.every((e) => isSampleRecipient(mails?.find((m) => m.id === e)?.email));
        const { data, error } = await db.from("training_sessions").insert({ tenant_id: tenant.id, program_id: s.program_id, plan_month: s.plan_month, status: "planned", created_by: user.id, sample }).select("id").single();
        err(error); sid = data!.id; created++;
      }
      for (let i = 0; i < s.need_ids.length; i++) {
        const { error } = await db.from("training_attendance").insert({ tenant_id: tenant.id, session_id: sid, employee_id: s.employee_ids[i], need_id: s.need_ids[i] });
        if (error && !error.message.includes("duplicate")) throw new Error(error.message);
        await db.from("training_needs").update({ status: "planned", session_id: sid }).eq("id", s.need_ids[i]);
        placed++;
      }
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.plan_built", entity: "training_sessions", data: { sessions_created: created, needs_planned: placed } });
    revalidatePath("/app/qms/training");
    return done(`Training plan updated: ${placed} need${placed === 1 ? "" : "s"} placed in ${steps.length} session${steps.length === 1 ? "" : "s"} (${created} new). Give each session a date, trainer and venue, then send the invitations.`);
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ programmes and sessions
export async function saveProgram(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), title = str(f, "title", 160), category = str(f, "category", 20), method = str(f, "eval_method", 20);
    if (title.length < 2) return { error: "Name the training." };
    if (!["induction", "safety", "quality", "technical", "awareness", "core_tools", "behavioural", "ojt"].includes(category)) return { error: "Choose a category." };
    if (!["test", "observation", "kpi", "signoff"].includes(method)) return { error: "Choose how effectiveness is checked." };
    const hours = num(f, "duration_hours"), pass = int(f, "pass_mark"), eff = int(f, "eff_days");
    if (!hours || hours <= 0 || hours > 200) return { error: "Duration: hours, more than 0." };
    if (pass == null || Number.isNaN(pass) || pass < 0 || pass > 100) return { error: "Pass mark: 0 to 100." };
    const row = { tenant_id: tenant.id, title, category, competency_id: uuid(f, "competency_id"), operation_id: uuid(f, "operation_id"), duration_hours: hours,
      eval_method: method, eff_days: method === "signoff" ? null : [30, 60, 90].includes(eff ?? 0) ? eff : null, pass_mark: pass, content: opt(f, "content", 3000), active: f.get("inactive") !== "on" };
    const db = await createClient();
    const { error } = id ? await db.from("training_programs").update(row).eq("id", id) : await db.from("training_programs").insert(row);
    err(error);
    revalidatePath("/app/qms/training");
    return id ? done("Programme saved.") : { ok: `${title} added to the programmes.` };
  } catch (e) { return fail(e); }
}

export async function saveSession(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), program = uuid(f, "program_id");
    if (!program) return { error: "Choose the training programme." };
    const date = opt(f, "date", 10), st = opt(f, "start", 5), en = opt(f, "end", 5);
    let starts: Date | null = null, ends: Date | null = null;
    if (date) {
      if (!isDate(date)) return { error: "Choose a date." };
      starts = fromLocal(`${date}T${st ?? "10:00"}`); ends = fromLocal(`${date}T${en ?? "12:00"}`);
      if (!starts || !ends || ends <= starts) return { error: "The training must end after it starts." };
    }
    const month = date ? date.slice(0, 7) : str(f, "plan_month", 7);
    if (!isMonth(month)) return { error: "Choose the month (or a date)." };
    const db = await createClient();
    const row = { tenant_id: tenant.id, program_id: program, plan_month: month, starts_at: starts?.toISOString() ?? null, ends_at: ends?.toISOString() ?? null,
      venue: opt(f, "venue", 120), trainer: opt(f, "trainer", 120), trainer_employee_id: uuid(f, "trainer_employee_id"), notes: opt(f, "notes", 1000) };
    if (id) {
      const { data: cur } = await db.from("training_sessions").select("status").eq("id", id).single();
      if (cur?.status === "done" || cur?.status === "cancelled") return { error: "This session is closed." };
      const { error } = await db.from("training_sessions").update({ ...row, status: starts ? "scheduled" : "planned" }).eq("id", id); err(error);
      revalidatePath(`/app/qms/training/${id}`);
      return done(starts ? `Session set for ${fmtWhen(starts)}. Send the invitations when the list is ready.` : "Session saved.");
    }
    const { data, error } = await db.from("training_sessions").insert({ ...row, status: starts ? "scheduled" : "planned", created_by: user.id }).select("id").single(); err(error);
    const emps = ids(f, "employee_id");
    for (const e of emps) await db.from("training_attendance").insert({ tenant_id: tenant.id, session_id: data!.id, employee_id: e });
    revalidatePath("/app/qms/training");
    await setFlash({ ok: "Session added to the plan." });
    return { ok: "Session added to the plan.", link: undefined, flashed: true };
  } catch (e) { return fail(e); }
}

export async function addAttendees(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const sid = uuid(f, "session_id");
    if (!sid) return { error: "Unknown session." };
    const db = await createClient();
    const { data: s } = await db.from("training_sessions").select("program_id,status").eq("id", sid).single();
    if (!s || s.status === "cancelled") return { error: "This session is cancelled." };
    let emps = ids(f, "employee_id");
    const dept = uuid(f, "department_id");
    if (dept) { const { data } = await db.from("employees").select("id").eq("status", "active").eq("department_id", dept); emps = [...new Set([...emps, ...(data ?? []).map((r) => r.id)])]; }
    if (!emps.length) return { error: "Choose the people." };
    let n = 0;
    for (const e of emps) {
      // an open need for this programme travels with the person
      const { data: need } = await db.from("training_needs").select("id").eq("employee_id", e).eq("program_id", s.program_id).eq("status", "open").limit(1).maybeSingle();
      const { error } = await db.from("training_attendance").insert({ tenant_id: tenant.id, session_id: sid, employee_id: e, need_id: need?.id ?? null });
      if (!error) { n++; if (need) await db.from("training_needs").update({ status: "planned", session_id: sid }).eq("id", need.id); }
    }
    revalidatePath(`/app/qms/training/${sid}`);
    return { ok: n ? `${n} added.` : "They are already on the list." };
  } catch (e) { return fail(e); }
}

export async function removeAttendee(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id");
    if (!id) return { error: "Unknown person." };
    const db = await createClient();
    const { data: a } = await db.from("training_attendance").select("session_id,need_id,attended").eq("id", id).single();
    if (!a) return { error: "Not found." };
    if (a.attended) return { error: "Attendance is already recorded for this person." };
    await db.from("training_attendance").delete().eq("id", id);
    if (a.need_id) await db.from("training_needs").update({ status: "open", session_id: null }).eq("id", a.need_id);
    revalidatePath(`/app/qms/training/${a.session_id}`);
    return done("Removed from the session; the training need is open again.");
  } catch (e) { return fail(e); }
}

async function sessionInfo(db: Awaited<ReturnType<typeof createClient>>, sid: string) {
  const { data: s } = await db.from("training_sessions").select("id,status,starts_at,ends_at,venue,trainer,program:training_programs(title,eval_method,eff_days,competency_id,operation_id,pass_mark)").eq("id", sid).single();
  if (!s) throw new Error("Unknown session.");
  const program = (Array.isArray(s.program) ? s.program[0] : s.program) as { title: string; eval_method: string; eff_days: number | null; competency_id: string | null; operation_id: string | null; pass_mark: number };
  return { ...s, program };
}

export async function sendInvites(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const sid = uuid(f, "session_id");
    if (!sid) return { error: "Unknown session." };
    const db = await createClient();
    const s = await sessionInfo(db, sid);
    if (!s.starts_at) return { error: "Give the session a date and time first." };
    if (s.status === "done" || s.status === "cancelled") return { error: "This session is closed." };
    const { data: list } = await db.from("training_attendance").select("employee:employees(first_name,last_name,email,mobile)").eq("session_id", sid);
    let sent = 0, none = 0;
    for (const a of list ?? []) {
      const e = (Array.isArray(a.employee) ? a.employee[0] : a.employee) as { first_name: string; last_name: string | null; email: string | null; mobile: string | null } | null;
      if (!e) continue;
      const r = await notify({ tenant, event: "training_invite", to: { name: fullName(e), email: e.email, phone: e.mobile }, related: { type: "training_sessions", id: sid },
        vars: { training: s.program.title, when: fmtWhen(s.starts_at), venue: s.venue ?? "to be told", trainer: s.trainer ?? "—" } });
      if (r.some((x) => x.status === "sent")) sent++; else none++;
    }
    await db.from("training_sessions").update({ invited_at: new Date().toISOString(), status: "scheduled" }).eq("id", sid);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.training_invited", entity: "training_sessions", entityId: sid, data: { sent } });
    revalidatePath(`/app/qms/training/${sid}`);
    return done(`Invitations sent to ${sent} ${sent === 1 ? "person" : "people"}${none ? `; ${none} could not be reached (no e-mail / WhatsApp, or sample people)` : ""}. A reminder goes the day before.`);
  } catch (e) { return fail(e); }
}

export async function saveAttendance(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const sid = uuid(f, "session_id");
    if (!sid) return { error: "Unknown session." };
    const db = await createClient();
    const s = await sessionInfo(db, sid);
    if (s.status === "cancelled") return { error: "This session is cancelled." };
    const { data: list } = await db.from("training_attendance").select("id,attended,acknowledged_at").eq("session_id", sid);
    const now = new Date().toISOString();
    for (const a of list ?? []) {
      const present = f.get(`att_${a.id}`) === "on";
      const pre = int(f, `pre_${a.id}`), post = int(f, `post_${a.id}`);
      for (const v of [pre, post]) if (v != null && (Number.isNaN(v) || v < 0 || v > 100)) return { error: "Test scores: 0 to 100." };
      const paperAck = f.get(`ack_${a.id}`) === "on";
      const { error } = await db.from("training_attendance").update({ attended: present, method: present ? (a.attended ? undefined : "manual") : null, marked_at: now,
        pre_score: pre, post_score: post, acknowledged_at: present && paperAck ? a.acknowledged_at ?? now : present ? a.acknowledged_at : null }).eq("id", a.id);
      err(error);
    }
    void user;
    revalidatePath(`/app/qms/training/${sid}`);
    return { ok: "Attendance and scores saved." };
  } catch (e) { return fail(e); }
}

/** attendance by scanning the employee's ID card (its QR holds the card-verification link) or typing his code */
export async function scanAttendance(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const sid = uuid(f, "session_id"), code = str(f, "code", 400);
    if (!sid || !code) return { error: "Scan the ID card or type the employee code." };
    const db = await createClient();
    const s = await sessionInfo(db, sid);
    if (s.status === "cancelled" || s.status === "done") return { error: "This session is closed." };
    const token = code.match(/\/v\/([0-9a-f]{16,64})/i)?.[1];
    const q = db.from("employees").select("id,first_name,last_name").limit(1);
    const { data: e } = token ? await q.eq("verify_token", token).maybeSingle() : await q.ilike("employee_code", code).maybeSingle();
    if (!e) return { error: token ? "This ID card is not of this company." : `No employee with the code ${code}.` };
    const { data: ex } = await db.from("training_attendance").select("id,attended").eq("session_id", sid).eq("employee_id", e.id).maybeSingle();
    if (ex?.attended) return { ok: `${fullName(e)} — already marked present.` };
    const row = { attended: true, method: "scan", marked_at: new Date().toISOString() };
    const { error } = ex ? await db.from("training_attendance").update(row).eq("id", ex.id)
      : await db.from("training_attendance").insert({ tenant_id: tenant.id, session_id: sid, employee_id: e.id, ...row });
    err(error);
    revalidatePath(`/app/qms/training/${sid}`);
    return { ok: `${fullName(e)} — present${ex ? "" : " (added to the list)"}.` };
  } catch (e) { return fail(e); }
}

export async function completeSession(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const sid = uuid(f, "session_id");
    if (!sid) return { error: "Unknown session." };
    const db = await createClient();
    const s = await sessionInfo(db, sid);
    if (s.status === "done" || s.status === "cancelled") return { error: "This session is already closed." };
    if (!s.starts_at) return { error: "Give the session its date first." };
    const { data: list } = await db.from("training_attendance").select("id,employee_id,attended,need_id,post_score,employee:employees(reporting_manager_id)").eq("session_id", sid);
    if (!(list ?? []).some((a) => a.attended != null)) return { error: "Mark the attendance first." };
    const { data: st } = await db.from("qms_settings").select("eff_days").maybeSingle();
    const day = new Date(new Date(s.starts_at).getTime() + 330 * 60000).toISOString().slice(0, 10);
    const effDays = s.program.eff_days ?? st?.eff_days ?? 30;
    let present = 0, absent = 0, failed = 0;
    for (const a of list ?? []) {
      if (!a.attended) {
        absent++;
        if (a.need_id) await db.from("training_needs").update({ status: "open", session_id: null }).eq("id", a.need_id);      // to be planned again
        continue;
      }
      present++;
      if (a.need_id) await db.from("training_needs").update({ status: "trained" }).eq("id", a.need_id);
      if (s.program.eval_method === "test" && (a.post_score == null || a.post_score < s.program.pass_mark)) failed++;
      if (s.program.eval_method !== "signoff") {
        const mgr = (Array.isArray(a.employee) ? a.employee[0] : a.employee) as { reporting_manager_id: string | null } | null;
        await db.from("training_effectiveness").insert({ tenant_id: tenant.id, attendance_id: a.id, employee_id: a.employee_id, session_id: sid,
          due_on: addDaysIso(day, effDays), evaluator_id: mgr?.reporting_manager_id ?? null });
      }
    }
    const { error } = await db.from("training_sessions").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", sid); err(error);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.training_completed", entity: "training_sessions", entityId: sid, data: { present, absent } });
    revalidatePath(`/app/qms/training/${sid}`);
    return done(`Training closed: ${present} trained${absent ? `, ${absent} absent (their needs are open again)` : ""}.${failed ? ` ${failed} below the pass mark — their supervisors will see it when they evaluate.` : ""}${s.program.eval_method !== "signoff" ? ` Effectiveness is due on ${addDaysIso(day, effDays)}.` : " Each person signs off in his portal (or tick 'signed on paper')."}`);
  } catch (e) { return fail(e); }
}

export async function cancelSession(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const sid = uuid(f, "session_id");
    if (!sid) return { error: "Unknown session." };
    const db = await createClient();
    const { data: s } = await db.from("training_sessions").select("status").eq("id", sid).single();
    if (s?.status === "done") return { error: "A completed training cannot be cancelled." };
    await db.from("training_needs").update({ status: "open", session_id: null }).eq("session_id", sid).eq("status", "planned");
    const { error } = await db.from("training_sessions").update({ status: "cancelled" }).eq("id", sid); err(error);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.training_cancelled", entity: "training_sessions", entityId: sid });
    revalidatePath("/app/qms/training");
    return done("Session cancelled; its training needs are open again for the next plan.");
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ effectiveness
export async function evaluate(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), result = str(f, "result", 20);
    if (!id) return { error: "Unknown evaluation." };
    if (!["effective", "partly", "not_effective"].includes(result)) return { error: "Was the training effective?" };
    const rating = int(f, "rating"), evidence = str(f, "evidence", 600);
    if (evidence.length < 5) return { error: "Write what you observed (the evidence)." };
    const db = await createClient();
    const { data: ev } = await db.from("training_effectiveness").select("id,employee_id,session_id,result,attendance:training_attendance(need_id),session:training_sessions(program_id,program:training_programs(title,competency_id,operation_id))").eq("id", id).single();
    if (!ev) return { error: "Not found, or not your team." };
    if (ev.result) return { error: "Already evaluated." };
    const sess = (Array.isArray(ev.session) ? ev.session[0] : ev.session) as { program_id: string; program: { title: string; competency_id: string | null; operation_id: string | null } | { title: string; competency_id: string | null; operation_id: string | null }[] };
    const prog = Array.isArray(sess.program) ? sess.program[0]! : sess.program;
    const att = (Array.isArray(ev.attendance) ? ev.attendance[0] : ev.attendance) as { need_id: string | null } | null;
    let retrain: string | null = null;
    if (result === "not_effective") {
      const admin = createAdminClient();      // the need is HR's record; the supervisor's evaluation creates it
      const { data: n } = await admin.from("training_needs").insert({ tenant_id: tenant.id, employee_id: ev.employee_id, program_id: sess.program_id, competency_id: prog.competency_id,
        operation_id: prog.operation_id, topic: `${prog.title} (again)`, source: "retraining", reason: `Not effective: ${evidence.slice(0, 300)}`, priority: "high", status: "open",
        target_month: addMonths(istToday().slice(0, 7), 1), raised_by: user.id, raised_by_name: user.full_name }).select("id").single();
      retrain = n?.id ?? null;
    }
    const { error } = await db.from("training_effectiveness").update({ result, rating: rating && rating >= 1 && rating <= 5 ? rating : null, evidence,
      evaluated_by: user.id, evaluated_by_name: user.full_name, evaluated_at: new Date().toISOString(), retrain_need_id: retrain }).eq("id", id);
    err(error);
    if (att?.need_id && result === "effective") await createAdminClient().from("training_needs").update({ status: "closed" }).eq("id", att.need_id);
    // the new level the supervisor saw on the job
    const lvl = int(f, "new_level");
    if (lvl != null && lvl >= 0 && lvl <= 4) {
      const today = istToday();
      if (prog.operation_id) await db.from("skill_levels").upsert({ tenant_id: tenant.id, employee_id: ev.employee_id, operation_id: prog.operation_id, level: lvl,
        certified_on: lvl >= QUALIFIED ? today : null, valid_until: lvl >= QUALIFIED ? addDaysIso(today, 365) : null, assessed_by: user.id, assessed_by_name: user.full_name }, { onConflict: "employee_id,operation_id" });
      else if (prog.competency_id) await db.from("employee_competencies").upsert({ tenant_id: tenant.id, employee_id: ev.employee_id, competency_id: prog.competency_id, level: lvl,
        assessed_on: today, assessed_by: user.id, assessed_by_name: user.full_name, method: "training" }, { onConflict: "employee_id,competency_id" });
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.effectiveness_evaluated", entity: "training_effectiveness", entityId: id, data: { result } });
    revalidatePath("/app/qms/effectiveness");
    return done(result === "not_effective" ? "Recorded. A retraining need has been raised for next month (high priority)." : "Evaluation recorded.");
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ on-the-job training
export async function saveOjtTemplate(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), title = str(f, "title", 160);
    if (title.length < 2) return { error: "Name the checklist." };
    const items = lines(f, "items", 60, 300).map((l) => {
      const m = l.match(/^(csr|nc)\s*[:\-]\s*(.+)$/i);
      return m ? { text: m[2]!.trim(), kind: m[1]!.toLowerCase() } : { text: l, kind: "task" };
    });
    if (items.length < 2) return { error: "Write at least two points, one per line." };
    const days = int(f, "days") ?? 15;
    const row = { tenant_id: tenant.id, title, designation_id: uuid(f, "designation_id"), operation_id: uuid(f, "operation_id"), items, days: days >= 1 && days <= 180 ? days : 15, active: f.get("inactive") !== "on" };
    const db = await createClient();
    const { error } = id ? await db.from("ojt_templates").update(row).eq("id", id) : await db.from("ojt_templates").insert(row);
    err(error);
    revalidatePath("/app/qms/ojt");
    return id ? done("Checklist saved.") : { ok: `${title} added.` };
  } catch (e) { return fail(e); }
}

export async function startOjt(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const tpl = uuid(f, "template_id"), emp = uuid(f, "employee_id"), start = str(f, "started_on", 10) || istToday();
    if (!tpl || !emp) return { error: "Choose the checklist and the person." };
    if (!isDate(start)) return { error: "Choose the start date." };
    const db = await createClient();
    const { error } = await db.from("ojt_records").insert({ tenant_id: tenant.id, template_id: tpl, employee_id: emp, trainer: opt(f, "trainer", 120), started_on: start });
    err(error);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.ojt_started", entity: "ojt_records", data: { employee_id: emp } });
    revalidatePath("/app/qms/ojt");
    return { ok: "On-the-job training started." };
  } catch (e) { return fail(e); }
}

export async function saveOjtProgress(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id");
    if (!id) return { error: "Unknown record." };
    const db = await createClient();
    const { data: r } = await db.from("ojt_records").select("id,status,template:ojt_templates(items)").eq("id", id).single();
    if (!r) return { error: "Not found, or not your team." };
    if (r.status !== "in_progress") return { error: "This training is closed." };
    const items = ((Array.isArray(r.template) ? r.template[0] : r.template) as { items: unknown[] }).items;
    const doneIdx = items.map((_, i) => i).filter((i) => f.get(`item_${i}`) === "on");
    const signOff = f.get("sign_off") === "on";
    if (signOff && doneIdx.length < items.length) return { error: "Every point must be done before signing off." };
    const { error } = await db.from("ojt_records").update({ done: doneIdx, remarks: opt(f, "remarks", 500),
      ...(signOff ? { status: "completed", completed_on: istToday(), signed_off_by: user.id, signed_off_name: user.full_name } : {}) }).eq("id", id);
    err(error);
    if (signOff) await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.ojt_signed_off", entity: "ojt_records", entityId: id });
    revalidatePath("/app/qms/ojt");
    return signOff ? done("Signed off: on-the-job training completed.") : { ok: `Saved: ${doneIdx.length} of ${items.length} done.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ internal auditors
export async function saveAuditor(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const id = uuid(f, "id"), emp = uuid(f, "employee_id"), kind = str(f, "kind", 20);
    if (!emp) return { error: "Choose the employee." };
    if (!["qms", "process", "product", "supplier"].includes(kind)) return { error: "Choose the kind of auditor." };
    const trained = opt(f, "trained_on", 10), valid = opt(f, "valid_until", 10);
    if ((trained && !isDate(trained)) || (valid && !isDate(valid))) return { error: "Check the dates." };
    const per = int(f, "audits_per_year") ?? 2;
    const row = { tenant_id: tenant.id, employee_id: emp, kind, standards: f.getAll("standards").map(String).slice(0, 10), qualification: opt(f, "qualification", 200),
      trained_on: trained, certificate_no: opt(f, "certificate_no", 60), valid_until: valid, core_tools: f.getAll("core_tools").map(String).slice(0, 10),
      csr_trained: f.get("csr_trained") === "on", audits_per_year: per >= 0 && per <= 50 ? per : 2, active: f.get("inactive") !== "on", notified_at: null };
    const db = await createClient();
    const { error } = id ? await db.from("auditors").update(row).eq("id", id) : await db.from("auditors").insert(row);
    err(error);
    revalidatePath("/app/qms/auditors");
    return id ? done("Auditor saved.") : { ok: "Added to the auditor register." };
  } catch (e) { return fail(e); }
}

export async function addAudit(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const aid = uuid(f, "auditor_id"), date = str(f, "audit_date", 10), area = str(f, "area", 160);
    if (!aid || !isDate(date) || area.length < 2) return { error: "Auditor, date and area are needed." };
    const findings = int(f, "findings");
    const db = await createClient();
    const { error } = await db.from("auditor_audits").insert({ tenant_id: tenant.id, auditor_id: aid, audit_date: date, area,
      audit_type: ["system", "process", "product", "supplier", "layered"].includes(str(f, "audit_type", 20)) ? str(f, "audit_type", 20) : "system",
      role: ["lead", "auditor", "observer"].includes(str(f, "role", 10)) ? str(f, "role", 10) : "auditor", findings: findings != null && findings >= 0 ? findings : null });
    err(error);
    revalidatePath("/app/qms/auditors");
    return { ok: "Audit recorded." };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ positions and their R&R sheets
export async function addPosition(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const title = str(f, "title", 120), dept = uuid(f, "department_id");
    if (title.length < 2) return { error: "Give the position (e.g. Production Head)." };
    if (!dept) return { error: "Choose the department." };
    const db = await createClient();
    const { data: d } = await db.from("departments").select("name").eq("id", dept).maybeSingle();
    id = await ensurePosition(db, tenant.id, { title, role: opt(f, "role", 160), department_id: dept, department: d?.name }, user.id);
    if (f.get("write_jd") === "on") {
      const { data: has } = await db.from("job_descriptions").select("id").eq("position_id", id).limit(1);
      if (!has?.length) {
        const { data: pos } = await db.from("positions").select("title,role").eq("id", id).single();
        // the free AI drafts it when set up (falls back to the rule-based writer); HR reviews and approves it either way
        const { draft: jd, model } = await smartJd(db as never, { tenantId: tenant.id, userId: user.id, userName: user.full_name },
          { title: pos!.title, department: d?.name, role: pos!.role, competencies: f.getAll("competency").map(String).slice(0, 20) });
        await db.from("job_descriptions").insert({ tenant_id: tenant.id, position_id: id, status: "draft", version: 1, created_by: user.id, ...jd, ai_model: model });
      }
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.position_added", entity: "positions", entityId: id });
  } catch (e) { return fail(e); }
  redirect(`/app/qms/positions/${id}`);
}

/** R&R sheet: roles, responsibilities, authority, competency (with level) and KPIs (target, frequency, review method) */
export async function savePositionSheet(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const pid = uuid(f, "position_id");
    if (!pid) return { error: "Unknown position." };
    const resp = lines(f, "responsibilities");
    if (!resp.length) return { error: "Write the responsibilities, one per line." };
    const db = await createClient();
    const { data: pos } = await db.from("positions").select("id,department_id").eq("id", pid).single();
    if (!pos) return { error: "Position not found." };
    // competencies: rows comp_name_i / comp_level_i
    const comps: { name: string; level: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const n = str(f, `comp_name_${i}`, 120), l = Number(str(f, `comp_level_${i}`, 2));
      if (n && l >= 1 && l <= 4 && !comps.some((c) => c.name.toLowerCase() === n.toLowerCase())) comps.push({ name: n, level: l });
    }
    if (!comps.length) return { error: "List at least one competency the position needs." };
    // KPIs: rows kpi_*_i
    const kpis: Record<string, unknown>[] = [];
    for (let i = 0; i < 30; i++) {
      const name = str(f, `kpi_name_${i}`, 120);
      if (!name) continue;
      const t = num(f, `kpi_target_${i}`);
      if (t != null && Number.isNaN(t)) return { error: `Target of “${name}” must be a number.` };
      const freq = str(f, `kpi_freq_${i}`, 20);
      kpis.push({ id: uuid(f, `kpi_id_${i}`), name, unit: opt(f, `kpi_unit_${i}`, 20), target: t, direction: str(f, `kpi_dir_${i}`, 10) === "lower" ? "lower" : "higher",
        frequency: ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"].includes(freq) ? freq : "monthly", review_method: opt(f, `kpi_review_${i}`, 200),
        data_source: opt(f, `kpi_source_${i}`, 200), sort_order: kpis.length + 1 });
    }
    const fields = { purpose: opt(f, "purpose", 1500), roles: lines(f, "roles", 12, 120), responsibilities: resp, authorities: lines(f, "authorities"), interfaces: lines(f, "interfaces", 12, 120), department_id: pos.department_id };
    const { data: rr } = await db.from("rr_roles").select("id,version,status").eq("position_id", pid).maybeSingle();
    let version = 1;
    if (rr) {
      version = rr.status === "approved" ? rr.version + 1 : rr.version;
      const { error } = await db.from("rr_roles").update({ ...fields, version, status: "draft", approved_at: null, approved_by: null }).eq("id", rr.id); err(error);
    } else {
      const { count } = await db.from("rr_roles").select("id", { count: "exact", head: true });
      const { error } = await db.from("rr_roles").insert({ tenant_id: tenant.id, position_id: pid, ...fields, doc_no: `HR-RR-${String((count ?? 0) + 1).padStart(3, "0")}` }); err(error);
    }
    await db.from("role_competencies").delete().eq("position_id", pid);
    for (const c of comps) {
      let { data: lib } = await db.from("competencies").select("id").ilike("name", c.name.replace(/[%_]/g, "\\$&")).limit(1);
      if (!lib?.length) { const r = await db.from("competencies").insert({ tenant_id: tenant.id, name: c.name, category: competencyCategory(c.name) }).select("id"); lib = r.data; }
      if (lib?.[0]) await db.from("role_competencies").insert({ tenant_id: tenant.id, position_id: pid, competency_id: lib[0].id, required_level: c.level });
    }
    const { data: curK } = await db.from("kpis").select("id").eq("position_id", pid);
    const kept = new Set<string>();
    for (const k of kpis) {
      const { id, ...row } = k as { id: string | null } & Record<string, unknown>;
      if (id && (curK ?? []).some((x) => x.id === id)) { kept.add(id); const { error } = await db.from("kpis").update({ ...row, active: true }).eq("id", id); err(error); }
      else { const { error } = await db.from("kpis").insert({ tenant_id: tenant.id, position_id: pid, ...row }); err(error); }
    }
    const off = (curK ?? []).map((x) => x.id).filter((x) => !kept.has(x));
    if (off.length) await db.from("kpis").update({ active: false }).in("id", off);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.sheet_saved", entity: "rr_roles", entityId: pid, data: { version } });
    revalidatePath(`/app/qms/positions/${pid}`);
    return done(rr?.status === "approved" ? `Saved as version ${version} (draft). Approve it to publish — the holders acknowledge it again.` : "Saved. Approve the sheet to publish it to the people holding the position.");
  } catch (e) { return fail(e); }
}

export async function rewriteSheet(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const pid = uuid(f, "position_id");
    if (!pid) return { error: "Unknown position." };
    const r = await writeSheetFromJd((await createClient()) as never, tenant.id, pid, { tenantId: tenant.id, userId: user.id, userName: user.full_name });
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.sheet_written", entity: "rr_roles", entityId: pid, data: r });
    revalidatePath(`/app/qms/positions/${pid}`);
    return done(`The R&R sheet is ${r.model ? "drafted by the AI" : "written"} from the job description (version ${r.version}, draft). Review it, then approve.`);
  } catch (e) { return fail(e); }
}

export async function approveSheet(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const pid = uuid(f, "position_id");
    if (!pid) return { error: "Unknown position." };
    const db = await createClient();
    const { data: r } = await db.from("rr_roles").select("id,version,status,position:positions(title,role)").eq("position_id", pid).single();
    if (!r) return { error: "Write the sheet first." };
    if (r.status === "approved") return { error: "Already approved." };
    const { error } = await db.from("rr_roles").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", r.id); err(error);
    const { data: emps } = await db.from("employees").select("first_name,last_name,email,mobile").eq("status", "active").eq("position_id", pid);
    const origin = await currentOrigin();
    const pos = (Array.isArray(r.position) ? r.position[0] : r.position) as { title: string; role: string | null } | null;
    for (const e of emps ?? []) await notify({ tenant, event: "rr_published", to: { name: fullName(e), email: e.email, phone: e.mobile }, channels: ["email"], related: { type: "rr_roles", id: r.id },
      vars: { designation: pos ? `${pos.title}${pos.role ? ` (${pos.role})` : ""}` : "", version: r.version, link: `${origin}/me/development` } });
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.sheet_approved", entity: "rr_roles", entityId: r.id, data: { version: r.version } });
    revalidatePath(`/app/qms/positions/${pid}`);
    return done(`Approved and published (version ${r.version}). ${emps?.length ?? 0} people holding the position are asked to acknowledge it.`);
  } catch (e) { return fail(e); }
}

export async function setEmployeePosition(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR, "hrm.skill-matrix-training-safety");
    const pid = uuid(f, "position_id"), emps = ids(f, "employee_id");
    if (!pid || !emps.length) return { error: "Choose the people." };
    const db = await createClient();
    const { error } = await db.from("employees").update({ position_id: pid }).in("id", emps); err(error);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.position_assigned", entity: "employees", data: { position_id: pid, people: emps.length } });
    revalidatePath(`/app/qms/positions/${pid}`);
    return { ok: `${emps.length} ${emps.length === 1 ? "person now holds" : "people now hold"} this position.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ the employee's own sign-offs (My portal)
async function me() {
  const s = await assertRole(["employee", "manager", "hr_executive", "hr_manager", "payroll", "interviewer"], "hrm.skill-matrix-training-safety");
  if (!s.user.employee_id) throw new Error("Your login is not linked to an employee record.");
  return s;
}

export async function ackRr(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    const id = uuid(f, "id");
    if (!id) return { error: "Unknown record." };
    const admin = createAdminClient();
    const [{ data: r }, { data: e }] = await Promise.all([
      admin.from("rr_roles").select("id,tenant_id,position_id,version,status").eq("id", id).single(),
      admin.from("employees").select("position_id").eq("id", user.employee_id!).single(),
    ]);
    if (!r || r.tenant_id !== tenant.id || r.status !== "approved" || !r.position_id || r.position_id !== e?.position_id) return { error: "This is not your position." };
    const { error } = await admin.from("rr_acks").insert({ tenant_id: tenant.id, rr_id: id, employee_id: user.employee_id, version: r.version });
    if (error && !error.message.includes("duplicate")) return { error: error.message };
    revalidatePath("/me/development");
    return done("Thank you — acknowledged.");
  } catch (e) { return fail(e); }
}

export async function ackAwareness(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    const id = uuid(f, "id");
    if (!id) return { error: "Unknown record." };
    const admin = createAdminClient();
    const { data: a } = await admin.from("training_attendance").select("id,tenant_id,employee_id,attended,acknowledged_at").eq("id", id).single();
    if (!a || a.tenant_id !== tenant.id || a.employee_id !== user.employee_id) return { error: "Not found." };
    if (!a.attended) return { error: "Your attendance is not recorded for this session." };
    if (!a.acknowledged_at) await admin.from("training_attendance").update({ acknowledged_at: new Date().toISOString() }).eq("id", id);
    revalidatePath("/me/development");
    return done("Thank you — signed off.");
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ KPIs
export async function saveKpiValues(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(TEAM, "hrm.skill-matrix-training-safety");
    const month = str(f, "month", 7);
    if (!isMonth(month)) return { error: "Choose the month." };
    const db = await createClient();
    let n = 0;
    for (const [k, raw] of f.entries()) {
      const m = k.match(/^v_([0-9a-f-]{36})_([0-9a-f-]{36})$/);
      if (!m) continue;
      const s = String(raw).trim().replace(/,/g, "");
      if (s === "") { await db.from("kpi_values").delete().eq("kpi_id", m[1]).eq("employee_id", m[2]).eq("month", month); continue; }
      const v = Number(s);
      if (!Number.isFinite(v)) return { error: `"${s}" is not a number.` };
      const { error } = await db.from("kpi_values").upsert({ tenant_id: tenant.id, kpi_id: m[1], employee_id: m[2], month, actual: v, entered_by: user.id }, { onConflict: "kpi_id,employee_id,month" });
      err(error); n++;
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "qms.kpi_values_saved", entity: "kpi_values", data: { month, values: n } });
    revalidatePath("/app/qms/kpi");
    return { ok: `Saved ${n} value${n === 1 ? "" : "s"} for ${month}.` };
  } catch (e) { return fail(e); }
}
