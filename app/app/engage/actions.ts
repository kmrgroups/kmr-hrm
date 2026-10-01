"use server";
// Engagement — HR and managers: announcements, recognition, suggestions (review), surveys.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, hasRole, HR_ROLES, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { notify } from "@/lib/notify";
import { currentOrigin } from "@/lib/tenant";
import { fullName } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { isSampleRecipient } from "@/lib/notify/render";
import { cleanQuestions, questionResults, REC_CATEGORIES, SUG_NEXT, SUG_STATUS, type Question, type QType } from "@/lib/engage/rules";
import { SURVEY_TEMPLATES } from "@/lib/engage/templates";
import { sendAnnouncement, sendSurveyInvites } from "@/lib/engage/send";
import { draftAnnouncement, summariseComments } from "@/lib/engage/ai";
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
const isMonth = (m: string | null): m is string => !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const err = (e: { message: string } | null) => { if (e) throw new Error(e.message.includes("duplicate") ? "This already exists." : e.message.includes("row-level security") ? "You cannot do this for that person." : e.message); };
const actorOf = (s: Session) => ({ tenantId: s.tenant.id, userId: s.user.id, userName: s.user.full_name });
const refresh = (...extra: string[]) => { for (const x of ["/app/engage", "/me/engage", "/me", ...extra]) revalidatePath(x); };

function audience(f: FormData): { audience: string; department_id: string | null; plant_id: string | null } | string {
  const a = str(f, "audience", 20);
  if (a === "department") { const d = uuid(f, "department_id"); return d ? { audience: a, department_id: d, plant_id: null } : "Choose the department."; }
  if (a === "plant") { const p = uuid(f, "plant_id"); return p ? { audience: a, department_id: null, plant_id: p } : "Choose the plant."; }
  return { audience: "all", department_id: null, plant_id: null };
}

// ================================================================== announcements
export async function saveAnnouncement(_: ActionState, f: FormData): Promise<ActionState> {
  let id = uuid(f, "id");
  try {
    const s = await assertRole(HR);
    const title = str(f, "title", 160), body = str(f, "body", 5000), category = str(f, "category", 20);
    if (title.length < 2) return { error: "Give it a title." };
    if (body.length < 2) return { error: "Write the message." };
    const aud = audience(f); if (typeof aud === "string") return { error: aud };
    const publish = opt(f, "publish_on", 10), expires = opt(f, "expires_on", 10);
    if (publish && !isDate(publish)) return { error: "Publish date: choose a date." };
    if (expires && !isDate(expires)) return { error: "Remove-on date: choose a date." };
    if (publish && expires && expires < publish) return { error: "The remove-on date is before the publish date." };
    const row = { tenant_id: s.tenant.id, title, body, category: ["general", "safety", "quality", "production", "hr", "event", "policy"].includes(category) ? category : "general", ...aud,
      pinned: f.get("pinned") === "on", needs_ack: f.get("needs_ack") === "on", notify: f.get("notify") === "on", publish_on: publish, expires_on: expires };
    const db = await createClient();
    if (id) {
      const { data: cur } = await db.from("announcements").select("status").eq("id", id).single();
      if (!cur) return { error: "Not found." };
      const { error } = await db.from("announcements").update(row).eq("id", id); err(error);
      refresh(`/app/engage/announcements/${id}`);
      return { ok: cur.status === "published" ? "Saved. (People who already got the message are not sent it again.)" : "Saved." };
    }
    const { data, error } = await db.from("announcements").insert({ ...row, status: "draft", created_by: s.user.id, created_by_name: s.user.full_name }).select("id").single(); err(error);
    id = data!.id;
    await setFlash({ ok: "Draft saved. Check it, then publish." });
  } catch (e) { return fail(e); }
  redirect(`/app/engage/announcements/${id}`);
}

/** the free AI writes the wording from HR's points into a new draft (HR checks and edits it before publishing) */
export async function aiAnnouncement(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  try {
    const s = await assertRole(HR);
    const points = str(f, "points", 3000), category = str(f, "category", 20) || "general";
    if (points.length < 10) return { error: "Write the points the announcement must say (a few lines)." };
    const aud = audience(f); if (typeof aud === "string") return { error: aud };
    const db = await createClient();
    const r = await draftAnnouncement(db as never, actorOf(s), { points, category, audience: aud.audience === "all" ? "everybody" : `one ${aud.audience}`, needsAck: f.get("needs_ack") === "on" });
    if ("error" in r) return { error: r.error };
    const { data, error } = await db.from("announcements").insert({ tenant_id: s.tenant.id, title: r.title, body: r.body, category, ...aud, needs_ack: f.get("needs_ack") === "on",
      status: "draft", ai_model: r.model, created_by: s.user.id, created_by_name: s.user.full_name }).select("id").single(); err(error);
    id = data!.id;
    await setFlash({ ok: "The AI drafted the announcement from your points. Check every line and edit it — then publish." });
  } catch (e) { return fail(e); }
  redirect(`/app/engage/announcements/${id}`);
}

export async function publishAnnouncement(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: a } = await db.from("announcements").select("*").eq("id", id).single();
    if (!a) return { error: "Not found." };
    if (a.status === "published") return { error: "Already published." };
    const today = istToday(), later = a.publish_on && a.publish_on > today;
    const { error } = await db.from("announcements").update({ status: "published", published_at: later ? null : new Date().toISOString() }).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "announcement.published", entity: "announcements", entityId: id });
    let msg = later ? `Scheduled — it appears on ${a.publish_on}${a.notify ? " and the message goes out that day" : ""}.` : "Published on everybody's portal.";
    if (!later && a.notify && !a.sample) {
      const r = await sendAnnouncement(s.tenant, a, `${await currentOrigin()}/me/engage`);
      msg += r.sent || r.left ? ` Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}${r.left ? `; ${r.left} more tonight` : ""}.` : " Nobody to message (sample people are never messaged).";
    }
    refresh(`/app/engage/announcements/${id}`);
    return done(msg);
  } catch (e) { return fail(e); }
}

export async function setAnnouncementStatus(_: ActionState, f: FormData): Promise<ActionState> {
  let gone = false;
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"), to = str(f, "to", 20); if (!id) return { error: "Not found." };
    const db = await createClient();
    if (to === "delete") {
      const { data: a } = await db.from("announcements").select("status").eq("id", id).single();
      if (a?.status !== "draft") return { error: "Only a draft can be deleted — archive a published one." };
      const { error } = await db.from("announcements").delete().eq("id", id); err(error); gone = true;
      await setFlash({ ok: "Draft deleted." });
    } else if (to === "archived" || to === "pin" || to === "unpin") {
      const { error } = await db.from("announcements").update(to === "archived" ? { status: "archived" } : { pinned: to === "pin" }).eq("id", id); err(error);
      await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: `announcement.${to}`, entity: "announcements", entityId: id });
      refresh(`/app/engage/announcements/${id}`);
      return done(to === "archived" ? "Archived — off the board." : to === "pin" ? "Pinned to the top." : "Unpinned.");
    } else return { error: "Unknown action." };
  } catch (e) { return fail(e); }
  if (gone) redirect("/app/engage/announcements");
  return {};
}

// ================================================================== recognition
export async function giveRecognition(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM);
    const emp = uuid(f, "employee_id"), category = str(f, "category", 30), message = str(f, "message", 1000);
    if (!emp) return { error: "Choose the person." };
    if (!(category in REC_CATEGORIES)) return { error: "Choose what it is for." };
    if (message.length < 3) return { error: "Write a line about what they did." };
    if (emp === s.user.employee_id) return { error: "You cannot recognise yourself." };
    const hr = hasRole(s.user, HR);
    let month: string | null = null;
    if (category === "employee_of_month") {
      if (!hr) return { error: "Employee of the month is chosen by HR." };
      month = str(f, "month", 7) || istToday().slice(0, 7);
      if (!isMonth(month)) return { error: "Choose the month." };
    }
    const db = await createClient();
    const { data: e } = await db.from("employees").select("id,first_name,last_name,email,mobile,status").eq("id", emp).maybeSingle();
    // a manager recognises his team (RLS shows him only them); anyone else he thanks as a colleague
    const kind = hr ? "hr" : e ? "manager" : "peer";
    const { data: rec, error } = await db.from("recognitions").insert({ tenant_id: s.tenant.id, employee_id: emp, category, message, month, given_by: s.user.id, given_by_name: s.user.full_name,
      given_by_employee_id: s.user.employee_id, kind }).select("id").single(); err(error);
    const to = e ?? (await createAdminClient().from("employees").select("first_name,last_name,email,mobile").eq("id", emp).eq("tenant_id", s.tenant.id).maybeSingle()).data;
    if (to && f.get("notify") !== "off") await notify({ tenant: s.tenant, event: "recognition_received", to: { name: fullName(to), email: to.email, phone: to.mobile }, channels: ["email"],
      related: { type: "recognitions", id: rec!.id }, vars: { giver: s.user.full_name, category: REC_CATEGORIES[category]!, message, link: `${await currentOrigin()}/me/engage` } });
    refresh("/app/engage/recognition");
    return { ok: `${to ? fullName(to) : "They"} ${category === "employee_of_month" ? "is Employee of the month" : "is recognised"} — it is on the wall${to?.email && !isSampleRecipient(to.email) ? " and they got an e-mail" : ""}.` };
  } catch (e) { return fail(e); }
}

export async function toggleRecognition(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: r } = await db.from("recognitions").select("visible").eq("id", id).single();
    if (!r) return { error: "Not found." };
    const { error } = await db.from("recognitions").update({ visible: !r.visible }).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: r.visible ? "recognition.hidden" : "recognition.shown", entity: "recognitions", entityId: id });
    refresh("/app/engage/recognition");
    return { ok: r.visible ? "Taken off the wall." : "Back on the wall." };
  } catch (e) { return fail(e); }
}

// ================================================================== suggestions
/** HR or the manager enters a suggestion for someone without a login (a worker who told it on the shop floor) */
export async function addSuggestionFor(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM);
    const emp = uuid(f, "employee_id"); if (!emp) return { error: "Whose idea is it?" };
    const title = str(f, "title", 160), problem = str(f, "problem", 2000), idea = str(f, "idea", 2000);
    if (title.length < 3 || problem.length < 3 || idea.length < 3) return { error: "Fill in the title, the problem and the idea." };
    const db = await createClient();
    const { data: e } = await db.from("employees").select("id").eq("id", emp).maybeSingle();       // HR: anybody; a manager: his team
    if (!e) return { error: "You can enter suggestions only for your team." };
    const { data, error } = await createAdminClient().from("suggestions").insert({ tenant_id: s.tenant.id, employee_id: emp, title, problem, idea, area: opt(f, "area", 120),
      category: str(f, "category", 20) || "productivity", team: opt(f, "team", 300), status: "submitted" }).select("id,ref").single(); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "suggestion.entered", entity: "suggestions", entityId: data!.id });
    refresh("/app/engage/suggestions");
    return { ok: `Suggestion ${data!.ref} entered.` };
  } catch (e) { return fail(e); }
}

export async function reviewSuggestion(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(TEAM);
    const id = uuid(f, "id"), to = str(f, "status", 20); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: sg } = await db.from("suggestions").select("*").eq("id", id).maybeSingle();
    if (!sg) return { error: "Not found (or not your team's)." };
    const note = opt(f, "review_note", 1000);
    const fields: Record<string, unknown> = { review_note: note ?? sg.review_note };
    if (to && to !== sg.status) {
      if (!(SUG_NEXT[sg.status] ?? []).includes(to)) return { error: `It cannot go from “${SUG_STATUS[sg.status]}” to “${SUG_STATUS[to] ?? to}”.` };
      if (to === "not_taken" && !note) return { error: "Say why it is not taken up — the person will read it." };
      fields.status = to; fields.reviewed_by = s.user.id; fields.reviewed_by_name = s.user.full_name;
      if (["accepted", "implemented", "not_taken"].includes(to)) fields.decided_at = sg.decided_at ?? new Date().toISOString();
    }
    if ((fields.status ?? sg.status) === "implemented") {
      const benefit = opt(f, "benefit", 1000), saving = str(f, "saving_per_year", 20).replace(/[,₹\s]/g, ""), on = opt(f, "implemented_on", 10);
      if (!benefit) return { error: "Write what it gave (quality, safety, time, cost …)." };
      if (saving && !(Number(saving) >= 0)) return { error: "Saving: rupees a year, a number." };
      if (on && !isDate(on)) return { error: "Implemented on: choose a date." };
      Object.assign(fields, { benefit, saving_per_year: saving ? Number(saving) : null, implemented_on: on ?? istToday(), before_text: opt(f, "before_text", 1000), after_text: opt(f, "after_text", 1000) });
    }
    const { error } = await db.from("suggestions").update(fields).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "suggestion.reviewed", entity: "suggestions", entityId: id, data: { from: sg.status, to: fields.status ?? sg.status } });
    const admin = createAdminClient();
    let extra = "";
    // implemented → the author is recognised on the wall (once)
    if (fields.status === "implemented") {
      const { data: had } = await admin.from("recognitions").select("id").eq("suggestion_id", id).limit(1);
      if (!had?.length) {
        const sv = fields.saving_per_year as number | null;
        await admin.from("recognitions").insert({ tenant_id: s.tenant.id, employee_id: sg.employee_id, category: "kaizen", kind: "auto", suggestion_id: id, sample: sg.sample,
          message: `Kaizen implemented: ${sg.title}${sv ? ` — saves ₹${sv.toLocaleString("en-IN")} a year` : ""}`, given_by: s.user.id, given_by_name: s.user.full_name, given_by_employee_id: s.user.employee_id });
        extra = " The author is recognised on the wall.";
      }
    }
    if (fields.status && ["accepted", "implemented", "not_taken", "on_hold"].includes(fields.status as string)) {
      const { data: e } = await admin.from("employees").select("first_name,last_name,email,mobile").eq("id", sg.employee_id).single();
      if (e) await notify({ tenant: s.tenant, event: "suggestion_update", to: { name: fullName(e), email: e.email, phone: e.mobile }, channels: ["email"], related: { type: "suggestions", id },
        vars: { ref: sg.ref ?? "", title: sg.title, status: SUG_STATUS[fields.status as string]!, note: note ?? "", link: `${await currentOrigin()}/me/engage` } });
    }
    refresh("/app/engage/suggestions", `/app/engage/suggestions/${id}`);
    return done(`${sg.ref}: ${SUG_STATUS[(fields.status as string) ?? sg.status]}.${extra}`);
  } catch (e) { return fail(e); }
}

// ================================================================== surveys
function questionRows(f: FormData) {
  const rows: { text: string; type: string; options: string; required: boolean }[] = [];
  for (let i = 0; i < 40; i++) {
    if (!f.has(`q_text_${i}`)) continue;
    rows.push({ text: str(f, `q_text_${i}`, 300), type: str(f, `q_type_${i}`, 10), options: str(f, `q_options_${i}`, 900), required: f.get(`q_req_${i}`) === "on" });
  }
  return rows;
}

export async function newSurvey(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  try {
    const s = await assertRole(HR);
    const key = str(f, "template", 30), src = uuid(f, "copy_of");
    const db = await createClient();
    let base: { title: string; intro: string | null; kind: string; anonymous: boolean; questions: Question[] };
    if (src) {
      const { data: o } = await db.from("surveys").select("title,intro,kind,anonymous,questions").eq("id", src).single();
      if (!o) return { error: "Survey not found." };
      base = { ...o, title: `${o.title} (copy)`.slice(0, 160), questions: o.questions as Question[] };
    } else {
      const t = SURVEY_TEMPLATES.find((x) => x.key === key);
      base = t ? { title: t.title, intro: t.intro, kind: t.kind, anonymous: true, questions: t.questions }
        : { title: "New survey", intro: "Your answers are anonymous.", kind: "custom", anonymous: true, questions: [{ id: "q1", text: "", type: "rating", required: true } as Question].filter((q) => q.text) };
    }
    const { data, error } = await db.from("surveys").insert({ tenant_id: s.tenant.id, ...base, status: "draft", created_by: s.user.id, created_by_name: s.user.full_name }).select("id").single(); err(error);
    id = data!.id;
    await setFlash({ ok: "Survey drafted. Change the questions as you like, then open it." });
  } catch (e) { return fail(e); }
  redirect(`/app/engage/surveys/${id}`);
}

export async function saveSurvey(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: cur } = await db.from("surveys").select("status").eq("id", id).single();
    if (!cur) return { error: "Not found." };
    const title = str(f, "title", 160); if (title.length < 2) return { error: "Give the survey a title." };
    const aud = audience(f); if (typeof aud === "string") return { error: aud };
    const opens = opt(f, "opens_on", 10), closes = opt(f, "closes_on", 10);
    if ((opens && !isDate(opens)) || (closes && !isDate(closes))) return { error: "Choose the dates." };
    if (opens && closes && closes < opens) return { error: "It closes before it opens." };
    const fields: Record<string, unknown> = { title, intro: opt(f, "intro", 2000), closes_on: closes, opens_on: opens };
    if (cur.status === "draft") {
      const q = cleanQuestions(questionRows(f));
      if (typeof q === "string") return { error: q };
      Object.assign(fields, { questions: q, anonymous: f.get("anonymous") === "on", kind: str(f, "kind", 20) || "custom", ...aud });
    }
    const { error } = await db.from("surveys").update(fields).eq("id", id); err(error);
    revalidatePath(`/app/engage/surveys/${id}`);
    return { ok: cur.status === "draft" ? "Saved." : "Saved. (The questions cannot change once people have started answering.)" };
  } catch (e) { return fail(e); }
}

export async function setSurveyStatus(_: ActionState, f: FormData): Promise<ActionState> {
  let gone = false;
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"), to = str(f, "to", 20); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: sv } = await db.from("surveys").select("*").eq("id", id).single();
    if (!sv) return { error: "Not found." };
    const today = istToday();
    if (to === "open") {
      if (sv.status !== "draft" && sv.status !== "closed") return { error: "Already open." };
      if (!(sv.questions as Question[]).length) return { error: "Add the questions first." };
      if (sv.closes_on && sv.closes_on < today) return { error: "The closing date has passed — change it first." };
      const opens = sv.opens_on && sv.opens_on > today ? sv.opens_on : sv.opens_on ?? today;
      const { error } = await db.from("surveys").update({ status: "open", opens_on: opens }).eq("id", id); err(error);
      await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "survey.opened", entity: "surveys", entityId: id });
      let msg = opens > today ? `Scheduled — it opens on ${opens} and the invitation goes out that day.` : "Open — people see it in their portal.";
      if (opens <= today && !sv.sample && f.get("notify") !== "off") {
        const r = await sendSurveyInvites(s.tenant, sv, `${await currentOrigin()}/me/engage/survey/${id}`);
        msg += r.sent || r.left ? ` Invitation sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}${r.left ? `; ${r.left} more tonight` : ""}.` : " Nobody to message (sample people are never messaged).";
      }
      refresh(`/app/engage/surveys/${id}`);
      return done(msg);
    }
    if (to === "closed") {
      const { error } = await db.from("surveys").update({ status: "closed", closes_on: sv.closes_on && sv.closes_on < today ? sv.closes_on : today }).eq("id", id); err(error);
      await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "survey.closed", entity: "surveys", entityId: id });
      refresh(`/app/engage/surveys/${id}`);
      return done("Closed. The results are final.");
    }
    if (to === "delete") {
      const { count } = await db.from("survey_responses").select("id", { count: "exact", head: true }).eq("survey_id", id);
      if (count) return { error: "People have answered it — close it instead of deleting." };
      const { error } = await db.from("surveys").delete().eq("id", id); err(error); gone = true;
      await setFlash({ ok: "Survey deleted." });
    } else return { error: "Unknown action." };
  } catch (e) { return fail(e); }
  if (gone) redirect("/app/engage/surveys");
  return {};
}

/** the free AI reads the written answers and suggests themes and actions (HR checks it against the comments) */
export async function summariseSurvey(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const [{ data: sv }, { data: resp }] = await Promise.all([
      db.from("surveys").select("title,questions").eq("id", id).single(),
      db.from("survey_responses").select("answers").eq("survey_id", id).limit(5000),
    ]);
    if (!sv) return { error: "Not found." };
    const res = questionResults(sv.questions as Question[], (resp ?? []) as { answers: Record<string, unknown> }[]);
    const groups = res.filter((r) => r.type === ("text" as QType)).map((r) => ({ question: r.text, comments: r.comments ?? [] }));
    const r = await summariseComments(db as never, actorOf(s), sv, groups);
    if ("error" in r) return { error: r.error };
    const { error } = await db.from("surveys").update({ ai_summary: r.summary, ai_model: r.model, ai_summary_at: new Date().toISOString(), summary_reviewed_by_name: null, summary_reviewed_at: null }).eq("id", id); err(error);
    revalidatePath(`/app/engage/surveys/${id}`);
    return done("The AI summarised the comments. Check it against the comments below, then mark it checked.");
  } catch (e) { return fail(e); }
}

export async function checkSummary(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const discard = f.get("discard") === "1";
    const { error } = await db.from("surveys").update(discard ? { ai_summary: null, ai_model: null, ai_summary_at: null, summary_reviewed_by_name: null, summary_reviewed_at: null }
      : { summary_reviewed_by_name: s.user.full_name, summary_reviewed_at: new Date().toISOString() }).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: discard ? "survey.summary_discarded" : "survey.summary_checked", entity: "surveys", entityId: id });
    revalidatePath(`/app/engage/surveys/${id}`);
    return done(discard ? "Summary removed." : "Marked as checked.");
  } catch (e) { return fail(e); }
}
