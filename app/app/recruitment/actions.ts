"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { currentOrigin } from "@/lib/tenant";
import { setFlash } from "@/lib/flash";
import { randomToken, hashToken } from "@/lib/tokens";
import { normalizeIndianMobile, isValidEmail } from "@/lib/validators";
import { loadSetup } from "@/lib/payroll/service";
import { inr } from "@/lib/payroll/compute";
import { draftJd } from "@/lib/recruit/jd";
import { breakupForCtc, breakupForGross } from "@/lib/recruit/offer";
import { offerLetterPdf } from "@/lib/recruit/offer-letter";
import { buildIcs } from "@/lib/recruit/ics";
import { nextRef, recruitSettings, rescoreRequisition, scoreApplication } from "@/lib/recruit/service";
import { fmtWhen, fromLocal, modeLabel } from "@/lib/recruit/format";
import { interviewToken } from "@/lib/recruit/links";
import type { ActionState } from "@/app/app/employees/actions";
import type { Role } from "@/lib/types";

const HR = HR_ROLES;
const RAISE: Role[] = [...HR_ROLES, "manager"];
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 500) => str(f, k, max) || null;
const uuid = (f: FormData, k: string) => { const v = str(f, k, 40); return /^[0-9a-f-]{36}$/.test(v) ? v : null; };
const numOrNull = (f: FormData, k: string) => { const v = str(f, k, 30).replace(/[, ]/g, ""); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const lakhs = (f: FormData, k: string) => { const n = numOrNull(f, k); return n == null || Number.isNaN(n) ? n : Math.round(n * 1e5); };
const lines = (f: FormData, k: string) => str(f, k, 6000).split("\n").map((s) => s.replace(/^[•\-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 30);
/** "Problem solving (8D) | 3" → {name, weight} */
const weighted = (f: FormData, k: string, def: number) => lines(f, k).map((l) => { const [n, w] = l.split("|").map((s) => s.trim()); return { name: n.slice(0, 80), weight: Math.min(3, Math.max(1, Number(w) || def)) }; });
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** for buttons that disappear once used: the message is shown at the top of the page instead */
const done = async (ok: string): Promise<ActionState> => { await setFlash({ ok }); return { ok, flashed: true }; };

async function names(db: Awaited<ReturnType<typeof createClient>>, ids: { designation_id?: string | null; department_id?: string | null; plant_id?: string | null }) {
  const [d, dep, pl] = await Promise.all([
    ids.designation_id ? db.from("designations").select("name").eq("id", ids.designation_id).maybeSingle() : null,
    ids.department_id ? db.from("departments").select("name").eq("id", ids.department_id).maybeSingle() : null,
    ids.plant_id ? db.from("plants").select("name").eq("id", ids.plant_id).maybeSingle() : null,
  ]);
  return { designation: d?.data?.name ?? null, department: dep?.data?.name ?? null, plant: pl?.data?.name ?? null };
}

// ================================================================== requisitions
function reqFields(f: FormData) {
  const r = {
    title: str(f, "title", 120), designation_id: uuid(f, "designation_id"), department_id: uuid(f, "department_id"), plant_id: uuid(f, "plant_id"),
    headcount: Math.max(1, Math.min(500, Number(str(f, "headcount", 4)) || 1)), grade: opt(f, "grade", 40),
    ctc_min: lakhs(f, "ctc_min"), ctc_max: lakhs(f, "ctc_max"), exp_min: numOrNull(f, "exp_min"), exp_max: numOrNull(f, "exp_max"),
    reason: ["new", "replacement", "project"].includes(str(f, "reason")) ? str(f, "reason") : "new", replacement_for: opt(f, "replacement_for", 120),
    required_by: isDay(str(f, "required_by")) ? str(f, "required_by") : null, location: opt(f, "location", 120),
    notice_max_days: numOrNull(f, "notice_max_days"), notes: opt(f, "notes", 2000),
  };
  if (r.title.length < 2) throw new Error("Give the role a title (e.g. Quality Engineer).");
  for (const k of ["ctc_min", "ctc_max", "exp_min", "exp_max", "notice_max_days"] as const) if (Number.isNaN(r[k] as number)) throw new Error("Numbers only in salary, experience and notice.");
  if (r.ctc_min != null && r.ctc_max != null && r.ctc_max < r.ctc_min) throw new Error("The salary range's maximum is below its minimum.");
  if (r.exp_min != null && r.exp_max != null && r.exp_max < r.exp_min) throw new Error("The experience range's maximum is below its minimum.");
  return r;
}

export async function createRequisition(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  try {
    const { user, tenant } = await assertRole(RAISE);
    const r = reqFields(form);
    const db = await createClient();
    const hr = hasRole(user, ["hr_manager", "hr_executive"]);
    const st = await recruitSettings(db, tenant.id);
    const status = hr ? "approved" : st.req_approval ? "pending" : "approved";
    const ref = await nextRef(createAdminClient(), tenant.id, "requisitions", "REQ");
    const { data, error } = await db.from("requisitions").insert({ tenant_id: tenant.id, ref_no: ref, ...r, status, raised_by: user.id, raised_by_name: user.full_name,
      approved_by: status === "approved" ? user.id : null, approved_at: status === "approved" ? new Date().toISOString() : null }).select("id").single();
    if (error) return { error: error.message };
    id = data.id;
    if (hr) await attachJd(db, tenant.id, user.id, id, false);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "requisition.raised", entity: "requisitions", entityId: id, data: { ref, status } });
    await setFlash({ ok: hr ? `Requisition ${ref} created. A job description was drafted for you — check it, then approve it and open the role.` : status === "pending" ? `Requisition ${ref} sent to HR for approval.` : `Requisition ${ref} raised.` });
  } catch (e) { return fail(e); }
  redirect(`/app/recruitment/requisitions/${id}`);
}

export async function updateRequisition(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(RAISE);
    const id = uuid(form, "id"); if (!id) return { error: "Missing requisition." };
    const r = reqFields(form);
    const db = await createClient();
    const { error, count } = await db.from("requisitions").update(r, { count: "exact" }).eq("id", id);
    if (error) return { error: error.message };
    if (!count) return { error: "You can change this requisition only while it is waiting for approval." };
    const n = await rescoreRequisition(db, id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "requisition.edited", entity: "requisitions", entityId: id });
    revalidatePath(`/app/recruitment/requisitions/${id}`);
    return { ok: `Saved.${n ? ` ${n} candidate${n > 1 ? "s" : ""} scored again against the changed limits.` : ""}` };
  } catch (e) { return fail(e); }
}

export async function setRequisitionStatus(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id"), to = str(form, "to");
    const db = await createClient();
    const { data: r } = await db.from("requisitions").select("id,status,jd_id,ref_no").eq("id", id!).single();
    if (!r) return { error: "Requisition not found." };
    const allowed: Record<string, string[]> = { approved: ["pending", "draft"], open: ["approved", "on_hold", "closed"], on_hold: ["open", "approved"], closed: ["open", "on_hold", "approved"], cancelled: ["draft", "pending", "approved", "on_hold"] };
    if (!allowed[to]?.includes(r.status)) return { error: "That step is not possible from the current status." };
    const patch: Record<string, unknown> = { status: to };
    if (to === "approved") { patch.approved_by = user.id; patch.approved_at = new Date().toISOString(); }
    if (to === "open") {
      const { data: jd } = r.jd_id ? await db.from("job_descriptions").select("status").eq("id", r.jd_id).single() : { data: null };
      if (jd?.status !== "approved") return { error: "Approve the job description first — candidates are scored against it." };
      patch.published = form.get("publish") === "on";
      patch.closed_at = null;
    }
    if (to === "closed" || to === "cancelled") { patch.closed_at = new Date().toISOString(); patch.published = false; }
    if (to === "on_hold") patch.published = false;
    const { error } = await db.from("requisitions").update(patch).eq("id", r.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `requisition.${to}`, entity: "requisitions", entityId: r.id });
    revalidatePath(`/app/recruitment/requisitions/${r.id}`);
    return done({ approved: "Requisition approved.", open: patch.published ? "The role is open, and shown on your careers page." : "The role is open for candidates.", on_hold: "Put on hold.", closed: "Requisition closed.", cancelled: "Requisition cancelled." }[to]!);
  } catch (e) { return fail(e); }
}

export async function setPublished(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id"), on = form.get("on") === "1";
    const db = await createClient();
    const { error } = await db.from("requisitions").update({ published: on }).eq("id", id!).eq("status", "open");
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: on ? "requisition.published" : "requisition.unpublished", entity: "requisitions", entityId: id });
    revalidatePath(`/app/recruitment/requisitions/${id}`);
    return done(on ? "Shown on your careers page." : "Taken off the careers page.");
  } catch (e) { return fail(e); }
}

// ================================================================== job descriptions
/** a JD for the requisition: the last approved JD of the same designation (reused), else a fresh draft */
async function attachJd(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, userId: string, reqId: string, fresh: boolean, family?: string | null) {
  const { data: r } = await db.from("requisitions").select("*").eq("id", reqId).single();
  if (!r) throw new Error("Requisition not found.");
  if (!fresh && r.designation_id) {
    const { data: prev } = await db.from("job_descriptions").select("id").eq("designation_id", r.designation_id).eq("status", "approved").order("version", { ascending: false }).limit(1);
    if (prev?.[0]) { await db.from("requisitions").update({ jd_id: prev[0].id }).eq("id", reqId); return "reused"; }
  }
  const n = await names(db, r);
  const { data: t } = await db.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  const d = draftJd({ title: r.title, designation: n.designation, department: n.department, plant: n.plant, company: t?.name, family, expMin: r.exp_min, expMax: r.exp_max, location: r.location });
  const { data: jd, error } = await db.from("job_descriptions").insert({ tenant_id: tenantId, designation_id: r.designation_id, created_by: userId, status: "draft", ...d }).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("requisitions").update({ jd_id: jd.id }).eq("id", reqId);
  return "drafted";
}

export async function writeJd(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const reqId = uuid(form, "requisition_id"); if (!reqId) return { error: "Missing requisition." };
    const db = await createClient();
    const how = await attachJd(db, tenant.id, user.id, reqId, form.get("fresh") === "1", opt(form, "family", 30));
    await rescoreRequisition(db, reqId);
    revalidatePath(`/app/recruitment/requisitions/${reqId}`);
    return done(how === "reused" ? "The approved JD of this designation is reused. Edit it if this opening differs." : "A new job description was drafted. Check and edit it, then approve it.");
  } catch (e) { return fail(e); }
}

export async function saveJd(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id"), reqId = uuid(form, "requisition_id");
    const db = await createClient();
    const { data: cur } = await db.from("job_descriptions").select("*").eq("id", id!).single();
    if (!cur) return { error: "Job description not found." };
    const fields = {
      title: str(form, "title", 120) || cur.title, purpose: opt(form, "purpose", 2000), responsibilities: lines(form, "responsibilities"), kpis: lines(form, "kpis"),
      must_have: weighted(form, "must_have", 2), good_to_have: weighted(form, "good_to_have", 1), qualifications: opt(form, "qualifications", 1000),
      experience: opt(form, "experience", 300), reporting_to: opt(form, "reporting_to", 120), context: opt(form, "context", 600), outcomes: lines(form, "outcomes"),
    };
    if (!fields.must_have.length) return { error: "List at least one must-have competency — the match score is built on them." };
    let jdId = cur.id;
    if (cur.status === "approved") {
      // an approved JD is a controlled document: changes make a new version (the old one stays as it was)
      const { data: nv, error } = await db.from("job_descriptions").insert({ tenant_id: tenant.id, designation_id: cur.designation_id, family: cur.family, ...fields,
        version: cur.version + 1, status: "draft", created_by: user.id }).select("id").single();
      if (error) return { error: error.message };
      jdId = nv.id;
      if (reqId) await db.from("requisitions").update({ jd_id: jdId }).eq("id", reqId);
    } else {
      const { error } = await db.from("job_descriptions").update(fields).eq("id", cur.id);
      if (error) return { error: error.message };
    }
    const n = reqId ? await rescoreRequisition(db, reqId) : 0;
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "jd.saved", entity: "job_descriptions", entityId: jdId });
    revalidatePath(`/app/recruitment/requisitions/${reqId}`);
    return { ok: `${cur.status === "approved" ? `Saved as version ${cur.version + 1} (draft) — approve it to use it.` : "Saved."}${n ? ` ${n} candidate${n > 1 ? "s" : ""} scored again.` : ""}` };
  } catch (e) { return fail(e); }
}

export async function approveJd(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id"), reqId = uuid(form, "requisition_id");
    const db = await createClient();
    const { data: jd } = await db.from("job_descriptions").select("id,designation_id,version").eq("id", id!).single();
    if (!jd) return { error: "Job description not found." };
    // the older approved versions of this designation are archived
    if (jd.designation_id) await db.from("job_descriptions").update({ status: "archived" }).eq("designation_id", jd.designation_id).eq("status", "approved").neq("id", jd.id);
    const { error } = await db.from("job_descriptions").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", jd.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "jd.approved", entity: "job_descriptions", entityId: jd.id, data: { version: jd.version } });
    revalidatePath(`/app/recruitment/requisitions/${reqId}`);
    return done(`Job description version ${jd.version} approved.`);
  } catch (e) { return fail(e); }
}

// ================================================================== candidates
export async function addCandidate(_: ActionState, form: FormData): Promise<ActionState> {
  let appId = "";
  try {
    const { user, tenant } = await assertRole(HR);
    const reqId = uuid(form, "requisition_id"); if (!reqId) return { error: "Missing requisition." };
    const db = await createClient();
    const email = str(form, "email", 120).toLowerCase() || null, phoneRaw = str(form, "phone", 20);
    const phone = phoneRaw ? normalizeIndianMobile(phoneRaw) : null;
    if (str(form, "full_name", 120).length < 2) return { error: "Enter the candidate's name." };
    if (email && !isValidEmail(email)) return { error: "That e-mail address does not look right." };
    if (phoneRaw && !phone) return { error: "Enter a 10-digit Indian mobile number." };
    if (!email && !phone) return { error: "Give an e-mail or a mobile number, so we can reach the candidate." };
    let candId: string | null = null;
    if (email) candId = (await db.from("candidates").select("id").eq("email", email).maybeSingle()).data?.id ?? null;
    if (!candId && phone) candId = (await db.from("candidates").select("id").eq("phone", phone).maybeSingle()).data?.id ?? null;
    const facts = { full_name: str(form, "full_name", 120), email, phone, location: opt(form, "location", 80), current_company: opt(form, "current_company", 120),
      current_designation: opt(form, "current_designation", 120), total_exp: numOrNull(form, "total_exp"), current_ctc: lakhs(form, "current_ctc"),
      expected_ctc: lakhs(form, "expected_ctc"), notice_days: numOrNull(form, "notice_days"), education: opt(form, "education", 200),
      skills: str(form, "skills", 1000).split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 40), resume_text: opt(form, "resume_text", 60000) };
    if ([facts.total_exp, facts.current_ctc, facts.expected_ctc, facts.notice_days].some((n) => Number.isNaN(n as number))) return { error: "Numbers only in experience, salary and notice." };
    if (candId) await db.from("candidates").update(facts).eq("id", candId);
    else {
      const { data, error } = await db.from("candidates").insert({ tenant_id: tenant.id, ...facts, source: str(form, "source") === "referral" ? "referral" : "manual", parse_status: "manual", created_by: user.id }).select("id").single();
      if (error) return { error: error.message };
      candId = data.id;
    }
    const { data: prev } = await db.from("applications").select("id").eq("requisition_id", reqId).eq("candidate_id", candId!).maybeSingle();
    if (prev) appId = prev.id;
    else {
      const { data, error } = await db.from("applications").insert({ tenant_id: tenant.id, requisition_id: reqId, candidate_id: candId, source: "manual" }).select("id").single();
      if (error) return { error: error.message };
      appId = data.id;
    }
    await scoreApplication(db, appId);
    await setFlash({ ok: "Candidate added and scored." });
  } catch (e) { return fail(e); }
  redirect(`/app/recruitment/candidates/${appId}`);
}

export async function updateCandidate(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const candId = uuid(form, "candidate_id"), appId = uuid(form, "application_id");
    const db = await createClient();
    const email = str(form, "email", 120).toLowerCase() || null, phoneRaw = str(form, "phone", 20);
    const phone = phoneRaw ? normalizeIndianMobile(phoneRaw) ?? phoneRaw : null;
    if (email && !isValidEmail(email)) return { error: "That e-mail address does not look right." };
    const facts = { full_name: str(form, "full_name", 120), email, phone, location: opt(form, "location", 80), current_company: opt(form, "current_company", 120),
      current_designation: opt(form, "current_designation", 120), total_exp: numOrNull(form, "total_exp"), current_ctc: lakhs(form, "current_ctc"),
      expected_ctc: lakhs(form, "expected_ctc"), notice_days: numOrNull(form, "notice_days"), education: opt(form, "education", 200),
      skills: str(form, "skills", 1000).split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 40) };
    if ([facts.total_exp, facts.current_ctc, facts.expected_ctc, facts.notice_days].some((n) => Number.isNaN(n as number))) return { error: "Numbers only in experience, salary and notice." };
    const { error } = await db.from("candidates").update(facts).eq("id", candId!);
    if (error) return { error: /candidates_(email|phone)/.test(error.message) ? "Another candidate already has this e-mail or mobile number." : error.message };
    const r = appId ? await scoreApplication(db, appId) : null;
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "candidate.edited", entity: "candidates", entityId: candId });
    revalidatePath(`/app/recruitment/candidates/${appId}`);
    return { ok: `Saved.${r ? ` New score: ${r.score}.` : ""}` };
  } catch (e) { return fail(e); }
}

export async function decide(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const appId = uuid(form, "application_id"), d = str(form, "decision"), reason = opt(form, "reason", 500);
    const db = await createClient();
    const { data: a } = await db.from("applications").select("id,status,recommendation,requisition_id").eq("id", appId!).single();
    if (!a) return { error: "Candidate not found." };
    const to = ({ shortlist: "shortlisted", hold: "on_hold", decline: "declined", select: "selected", reopen: "new" } as Record<string, string>)[d];
    if (!to) return { error: "Choose a decision." };
    if (["offered", "joined"].includes(a.status) && d !== "reopen") return { error: "An offer is out for this candidate — withdraw it first." };
    const overridden = (d === "shortlist" && a.recommendation === "not_suitable") || (d === "decline" && a.recommendation === "suitable");
    if (overridden && !reason) return { error: "You are going against the recommendation — please give a short reason (kept in the record)." };
    const st = await recruitSettings(db, tenant.id);
    const regret = d === "decline" && st.regret_auto ? new Date(Date.now() + st.regret_delay_days * 864e5).toISOString().slice(0, 10) : null;
    const { error } = await db.from("applications").update({ status: to, decision_by: user.id, decision_at: new Date().toISOString(), decision_reason: reason, overridden,
      regret_due: regret, ...(d === "reopen" ? { regret_due: null } : {}) }).eq("id", a.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `application.${to}`, entity: "applications", entityId: a.id, data: { reason, overridden } });
    revalidatePath(`/app/recruitment/candidates/${a.id}`); revalidatePath(`/app/recruitment/requisitions/${a.requisition_id}`);
    return { ok: { shortlisted: "Shortlisted — schedule the interview below.", on_hold: "On hold.", declined: regret ? `Declined. A courteous regret message goes to the candidate on ${regret} (unless you change your mind).` : "Declined.", selected: "Selected — make the offer below.", new: "Back to new." }[to] };
  } catch (e) { return fail(e); }
}

export async function rescoreAll(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertRole(HR);
    const reqId = uuid(form, "requisition_id");
    const n = await rescoreRequisition(await createClient(), reqId!);
    revalidatePath(`/app/recruitment/requisitions/${reqId}`);
    return { ok: `${n} candidate${n === 1 ? "" : "s"} scored again.` };
  } catch (e) { return fail(e); }
}

// ================================================================== interviews
export async function scheduleInterview(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const appId = uuid(form, "application_id");
    const db = await createClient();
    const { data: a } = await db.from("applications").select("id,status,requisition:requisitions(title),candidate:candidates(full_name,email,phone)").eq("id", appId!).single();
    if (!a) return { error: "Candidate not found." };
    const when = fromLocal(str(form, "starts_at", 20));
    if (!when) return { error: "Choose the date and time." };
    if (when.getTime() < Date.now() - 36e5) return { error: "That time is in the past." };
    const mode = ["in_person", "video", "phone"].includes(str(form, "mode")) ? str(form, "mode") : "in_person";
    const venue = opt(form, "venue", 300), video = opt(form, "video_link", 500);
    if (mode === "in_person" && !venue) return { error: "Give the venue (address or plant gate)." };
    if (mode === "video" && !/^https?:\/\//.test(video ?? "")) return { error: "Paste the video meeting link (Google Meet, Teams or Zoom)." };
    const panel = form.getAll("panel").map(String).filter((v) => /^[0-9a-f-]{36}$/.test(v));
    if (!panel.length) return { error: "Choose at least one panel member." };
    const { data: people } = await createAdminClient().from("app_users").select("id,full_name,email").eq("tenant_id", tenant.id).in("id", panel);
    const { count } = await db.from("interviews").select("id", { count: "exact", head: true }).eq("application_id", a.id);
    const row = { tenant_id: tenant.id, application_id: a.id, round: (count ?? 0) + 1, title: str(form, "title", 80) || "Interview", mode, starts_at: when.toISOString(),
      duration_min: Math.max(10, Math.min(480, Number(str(form, "duration_min", 4)) || 45)), venue, video_link: video, bring: opt(form, "bring", 500),
      panel, panel_names: (people ?? []).map((p) => p.full_name), created_by: user.id };
    const { data: iv, error } = await db.from("interviews").insert(row).select("id").single();
    if (error) return { error: error.message };
    const token = interviewToken(iv.id);
    await db.from("interviews").update({ token_hash: hashToken(token) }).eq("id", iv.id);
    if (["new", "shortlisted", "on_hold"].includes(a.status)) await db.from("applications").update({ status: "interview" }).eq("id", a.id);
    const origin = await currentOrigin();
    const cand = (Array.isArray(a.candidate) ? a.candidate[0] : a.candidate) as { full_name: string; email: string | null; phone: string | null };
    const role = ((Array.isArray(a.requisition) ? a.requisition[0] : a.requisition) as { title: string }).title;
    const where = mode === "video" ? `Join: ${video}` : mode === "phone" ? "We will call you on your mobile." : `Venue: ${venue}`;
    const vars = { role, when: fmtWhen(when), duration: row.duration_min, mode: modeLabel(mode), where, bring: row.bring || "your resume and a photo ID", round: `${row.round} — ${row.title}` };
    let sent = "";
    if (form.get("notify") === "on") {
      const r = await notify({ tenant, event: "interview_invite", to: { name: cand.full_name, email: cand.email, phone: cand.phone }, related: { type: "interviews", id: iv.id },
        vars: { ...vars, link: `${origin}/interview/${token}` } });
      sent = r.some((x) => x.status === "sent") ? " The candidate has been told." : " (The message to the candidate could not be sent — share the link below.)";
      const ics = buildIcs({ uid: `${iv.id}@hrm`, start: when, durationMin: row.duration_min, title: `Interview: ${cand.full_name} — ${role}`,
        description: `Round ${row.round} (${row.title}). Scorecard: ${origin}/app/recruitment/interviews/${iv.id}`, location: mode === "video" ? video! : venue ?? "Phone",
        attendees: (people ?? []).map((p) => ({ name: p.full_name, email: p.email })) });
      for (const p of people ?? []) {
        await notify({ tenant, event: "interview_panel", to: { name: p.full_name, email: p.email }, channels: ["email"], related: { type: "interviews", id: iv.id },
          vars: { ...vars, candidate: cand.full_name, link: `${origin}/app/recruitment/interviews/${iv.id}` }, attachments: [{ filename: "interview.ics", content: new TextEncoder().encode(ics) }] });
      }
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "interview.scheduled", entity: "interviews", entityId: iv.id });
    revalidatePath(`/app/recruitment/candidates/${a.id}`);
    const msg = { ok: `Interview round ${row.round} scheduled for ${fmtWhen(when)}.${sent}`, link: `${origin}/interview/${token}` };
    await setFlash(msg);                          // the scheduling form closes once the interview exists
    return { ...msg, flashed: true };
  } catch (e) { return fail(e); }
}

export async function setInterviewStatus(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id"), to = str(form, "to");
    if (!["done", "no_show", "cancelled", "scheduled"].includes(to)) return { error: "Unknown step." };
    const db = await createClient();
    const { data, error } = await db.from("interviews").update({ status: to }).eq("id", id!).select("application_id").single();
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `interview.${to}`, entity: "interviews", entityId: id });
    revalidatePath(`/app/recruitment/candidates/${data.application_id}`);
    return done({ done: "Interview marked as held. Panel members can fill in their scorecards.", no_show: "Marked as did not come.", cancelled: "Interview cancelled.", scheduled: "Back to scheduled." }[to]!);
  } catch (e) { return fail(e); }
}

export async function saveFeedback(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole([...HR_ROLES, "manager", "interviewer"]);
    const id = uuid(form, "interview_id");
    const db = await createClient();
    const { data: iv } = await db.from("interviews").select("id,panel,application_id").eq("id", id!).single();
    if (!iv) return { error: "Interview not found." };
    if (!(iv.panel as string[]).includes(user.id)) return { error: "Only panel members fill in a scorecard for this interview." };
    const scores: Record<string, number> = {};
    for (const [k, v] of form.entries()) if (k.startsWith("score:") && /^[1-5]$/.test(String(v))) scores[k.slice(6).slice(0, 80)] = Number(v);
    const overall = Number(str(form, "overall", 1)), reco = str(form, "recommendation");
    if (!(overall >= 1 && overall <= 5)) return { error: "Give an overall rating (1–5)." };
    if (!["strong_hire", "hire", "hold", "no_hire"].includes(reco)) return { error: "Choose your recommendation." };
    const { error } = await db.from("interview_feedback").upsert({ tenant_id: tenant.id, interview_id: iv.id, panelist_id: user.id, panelist_name: user.full_name, scores, overall,
      recommendation: reco, strengths: opt(form, "strengths", 1500), concerns: opt(form, "concerns", 1500), submitted_at: new Date().toISOString() }, { onConflict: "interview_id,panelist_id" });
    if (error) return { error: error.message };
    revalidatePath(`/app/recruitment/interviews/${iv.id}`);
    return { ok: "Scorecard saved. Thank you." };
  } catch (e) { return fail(e); }
}

// ================================================================== offers
export async function saveOffer(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const appId = uuid(form, "application_id");
    const db = await createClient();
    const { data: a } = await db.from("applications").select("id,status,requisition:requisitions(designation_id,department_id,plant_id)").eq("id", appId!).single();
    if (!a) return { error: "Candidate not found." };
    const doj = str(form, "date_of_joining");
    if (!isDay(doj)) return { error: "Choose the date of joining." };
    const basis = str(form, "basis") === "gross" ? "gross" : "ctc";
    const amount = Number(str(form, "amount", 20).replace(/[, ]/g, ""));
    if (!(amount > 0)) return { error: basis === "ctc" ? "Enter the yearly CTC in rupees (e.g. 600000)." : "Enter the monthly gross in rupees (e.g. 45000)." };
    const st = await recruitSettings(db, tenant.id);
    const { settings, components } = await loadSetup(createAdminClient(), tenant.id);
    const o = { pfApplicable: form.get("pf_applicable") === "on", includeGratuity: form.get("include_gratuity") === "on" };
    const bk = basis === "ctc" ? breakupForCtc(amount, settings, components, o) : breakupForGross(amount, settings, components, o);
    const validDays = Math.max(1, Math.min(60, Number(str(form, "valid_days", 3)) || st.offer_valid_days));
    const row = {
      designation_id: uuid(form, "designation_id"), department_id: uuid(form, "department_id"), plant_id: uuid(form, "plant_id"), reporting_manager_id: uuid(form, "reporting_manager_id"),
      employment_type: str(form, "employment_type") || "probation", category: str(form, "category") || "staff", date_of_joining: doj,
      annual_ctc: bk.ctc_annual, monthly_gross: bk.monthly_gross, breakup: bk, pf_applicable: o.pfApplicable, include_gratuity: o.includeGratuity,
      valid_until: new Date(Date.now() + validDays * 864e5).toISOString().slice(0, 10), terms: opt(form, "terms", 6000) ?? st.offer_terms,
    };
    const { data: cur } = await db.from("offers").select("id,status").eq("application_id", a.id).in("status", ["draft", "sent"]).maybeSingle();
    if (cur?.status === "sent") return { error: "This offer is already with the candidate. Withdraw it first to change it." };
    if (cur) { const { error } = await db.from("offers").update(row).eq("id", cur.id); if (error) return { error: error.message }; }
    else {
      const ref = await nextRef(db, tenant.id, "offers", "OFF");
      const { error } = await db.from("offers").insert({ tenant_id: tenant.id, application_id: a.id, ref_no: ref, ...row, status: "draft", created_by: user.id });
      if (error) return { error: error.message };
    }
    if (a.status !== "selected") await db.from("applications").update({ status: "selected" }).eq("id", a.id);
    revalidatePath(`/app/recruitment/candidates/${a.id}`);
    return { ok: `Offer saved as a draft: CTC Rs. ${inr(bk.ctc_annual)} a year (gross Rs. ${inr(bk.monthly_gross)} a month, take-home about Rs. ${inr(bk.net_monthly)}). Check the letter, then send it.` };
  } catch (e) { return fail(e); }
}

export async function sendOffer(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id");
    const db = await createClient();
    const { data: o } = await db.from("offers").select("id,status,ref_no,annual_ctc,date_of_joining,valid_until,application_id").eq("id", id!).single();
    if (!o || !["draft", "sent"].includes(o.status)) return { error: "Only a draft offer can be sent." };
    // the offer is valid for the set number of days from the day it is sent
    const st = await recruitSettings(db, tenant.id);
    o.valid_until = new Date(Date.now() + st.offer_valid_days * 864e5).toISOString().slice(0, 10);
    await db.from("offers").update({ valid_until: o.valid_until }).eq("id", o.id);
    const letter = await offerLetterPdf(db, tenant, o.id, new Date().toISOString().slice(0, 10));
    if (!letter?.candidate) return { error: "The candidate for this offer was not found." };
    const cand = letter.candidate, pdf = letter.pdf, app = { id: o.application_id as string };
    const token = randomToken(), origin = await currentOrigin();
    const { error } = await db.from("offers").update({ status: "sent", token_hash: hashToken(token), sent_at: new Date().toISOString() }).eq("id", o.id);
    if (error) return { error: error.message };
    await db.from("applications").update({ status: "offered" }).eq("id", app.id);
    const r = await notify({ tenant, event: "offer_letter", to: { name: cand.full_name, email: cand.email, phone: cand.phone }, related: { type: "offers", id: o.id },
      vars: { role: letter.role, ctc: `Rs. ${inr(o.annual_ctc)}`, doj: new Date(`${o.date_of_joining}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
        valid_until: new Date(`${o.valid_until}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), link: `${origin}/offer/${token}` },
      attachments: [{ filename: `Offer-${o.ref_no}.pdf`, content: pdf }] });
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "offer.sent", entity: "offers", entityId: o.id });
    revalidatePath(`/app/recruitment/candidates/${app.id}`);
    const ok = r.some((x) => x.status === "sent");
    const msg = { ok: ok ? `Offer ${o.ref_no} sent to ${cand.full_name}.` : `Offer ${o.ref_no} is ready, but the message could not be sent — share the link below with the candidate.`, link: `${origin}/offer/${token}` };
    await setFlash(msg);
    return { ...msg, flashed: true };
  } catch (e) { return fail(e); }
}

export async function withdrawOffer(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR);
    const id = uuid(form, "id");
    const db = await createClient();
    const { data: o, error } = await db.from("offers").update({ status: "withdrawn", token_hash: null }).eq("id", id!).in("status", ["draft", "sent"]).select("application_id").single();
    if (error || !o) return { error: "Only an offer that is not yet answered can be withdrawn." };
    await db.from("applications").update({ status: "selected" }).eq("id", o.application_id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "offer.withdrawn", entity: "offers", entityId: id });
    revalidatePath(`/app/recruitment/candidates/${o.application_id}`);
    return done("Offer withdrawn. The candidate's link no longer works.");
  } catch (e) { return fail(e); }
}

// ================================================================== settings
export async function saveRecruitSettings(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(["hr_manager"]);
    const n = (k: string, lo: number, hi: number, d: number) => { const v = Number(str(form, k, 5)); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d; };
    const row = { tenant_id: tenant.id, careers_enabled: form.get("careers_enabled") === "on", careers_intro: opt(form, "careers_intro", 2000), req_approval: form.get("req_approval") === "on",
      suitable_score: n("suitable_score", 1, 100, 70), hold_score: n("hold_score", 0, 99, 50), regret_auto: form.get("regret_auto") === "on", regret_delay_days: n("regret_delay_days", 0, 30, 3),
      offer_valid_days: n("offer_valid_days", 1, 60, 7), gratuity_in_ctc: form.get("gratuity_in_ctc") === "on", offer_signatory: opt(form, "offer_signatory", 120), offer_terms: opt(form, "offer_terms", 6000) };
    if (row.hold_score >= row.suitable_score) return { error: "The 'maybe' score must be below the 'suitable' score." };
    const { error } = await (await createClient()).from("recruit_settings").upsert(row, { onConflict: "tenant_id" });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "recruitment.settings", entity: "recruit_settings", entityId: tenant.id });
    revalidatePath("/app/settings/recruitment");
    return { ok: "Recruitment settings saved." };
  } catch (e) { return fail(e); }
}
