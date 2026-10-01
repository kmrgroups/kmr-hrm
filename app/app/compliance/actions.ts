"use server";
// Policies & compliance — controlled documents (draft → approved → obsolete, acknowledgements) and the statutory
// compliance register (occurrences done with reference and proof).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, HR_ROLES, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { currentOrigin } from "@/lib/tenant";
import { istToday } from "@/lib/attendance/time";
import { DOCS_BUCKET } from "@/lib/storage";
import { DOC_KINDS, FREQS, KINDS, nextDocNo, reviewDue } from "@/lib/compliance/rules";
import { ensureTasks, sendPolicy } from "@/lib/compliance/service";
import { draftDocument } from "@/lib/compliance/ai";
import type { ActionState } from "@/app/app/employees/actions";
import type { Role } from "@/lib/types";

const HR = HR_ROLES;
const REG: Role[] = [...HR_ROLES, "payroll"];
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const done = async (ok: string): Promise<ActionState> => { await setFlash({ ok }); return { ok, flashed: true }; };
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 500) => str(f, k, max) || null;
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const uuid = (f: FormData, k: string) => { const v = str(f, k, 40); return isId(v) ? v : null; };
const isDate = (d: string | null): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const err = (e: { message: string } | null) => { if (e) throw new Error(e.message.includes("duplicate") ? "That number / code is already used." : e.message); };
const actorOf = (s: Session) => ({ tenantId: s.tenant.id, userId: s.user.id, userName: s.user.full_name });
const refresh = (...p: string[]) => { for (const x of ["/app/compliance", "/app/compliance/documents", "/app/compliance/register", "/me/policies", "/me", ...p]) revalidatePath(x); };
const FILE_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

async function upload(tenantId: string, folder: string, f: FormData, key: string): Promise<{ path: string; name: string } | null | string> {
  const file = f.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = FILE_TYPES[file.type]; if (!ext) return "The file must be a PDF, JPG or PNG.";
  if (file.size > 5 * 1024 * 1024) return "The file must be under 5 MB.";
  const path = `${tenantId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await createAdminClient().storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return `Upload failed: ${error.message}`;
  return { path, name: file.name.slice(0, 160) };
}

function docFields(f: FormData) {
  const kind = str(f, "kind", 20) in DOC_KINDS ? str(f, "kind", 20) : "policy";
  const a = str(f, "audience", 20);
  const aud = a === "department" ? { audience: a, department_id: uuid(f, "department_id"), plant_id: null } : a === "plant" ? { audience: a, department_id: null, plant_id: uuid(f, "plant_id") } : { audience: "all", department_id: null, plant_id: null };
  const rm = Number(str(f, "review_months", 3)) || 12;
  return { kind, title: str(f, "title", 160), owner_department_id: uuid(f, "owner_department_id"), owner_name: opt(f, "owner_name", 120),
    employee_access: f.get("employee_access") === "on", needs_ack: f.get("needs_ack") === "on", review_months: Math.min(60, Math.max(1, rm)), ...aud };
}

// ================================================================== documents
export async function createDocument(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  try {
    const s = await assertRole(HR);
    const d = docFields(f);
    if (d.title.length < 2) return { error: "Give the document a title." };
    if ((d.audience === "department" && !d.department_id) || (d.audience === "plant" && !d.plant_id)) return { error: "Choose who it is for." };
    const db = await createClient();
    const { data: ex } = await db.from("documents").select("doc_no");
    const docNo = str(f, "doc_no", 40) || nextDocNo((ex ?? []).map((x) => x.doc_no), d.kind);
    const useAi = f.get("ai") === "1";
    let body = "", model: string | null = null;
    if (useAi) {
      const r = await draftDocument(db as never, actorOf(s), { title: d.title, kind: d.kind, points: str(f, "points", 3000), company: s.tenant.legal_name || s.tenant.name });
      if ("error" in r) return { error: r.error };
      body = r.body; model = r.model;
    }
    const { data, error } = await db.from("documents").insert({ tenant_id: s.tenant.id, doc_no: docNo, ...d, created_by: s.user.id, created_by_name: s.user.full_name }).select("id").single(); err(error);
    id = data!.id;
    const { error: e2 } = await db.from("document_versions").insert({ tenant_id: s.tenant.id, document_id: id, revision: 0, body: body || null, change_note: "First issue", status: "draft",
      prepared_by: s.user.id, prepared_by_name: s.user.full_name, ai_model: model }); err(e2);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "document.created", entity: "documents", entityId: id, data: { doc_no: docNo, ai: !!model } });
    await setFlash({ ok: model ? `${docNo} created — the AI drafted the text. Read and correct every line, then have it approved.` : `${docNo} created. Write the text (or attach the PDF), then have it approved.` });
  } catch (e) { return fail(e); }
  redirect(`/app/compliance/documents/${id}`);
}

export async function saveDocument(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const d = docFields(f);
    if (d.title.length < 2) return { error: "Give the document a title." };
    if ((d.audience === "department" && !d.department_id) || (d.audience === "plant" && !d.plant_id)) return { error: "Choose who it is for." };
    const db = await createClient();
    const docNo = str(f, "doc_no", 40);
    const { error } = await db.from("documents").update({ ...d, ...(docNo ? { doc_no: docNo } : {}) }).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "document.saved", entity: "documents", entityId: id });
    refresh(`/app/compliance/documents/${id}`);
    return { ok: "Saved." };
  } catch (e) { return fail(e); }
}

/** the draft revision's text / PDF / change note (a new draft is started from the current revision when there is none) */
export async function saveDraft(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const docId = uuid(f, "document_id"); if (!docId) return { error: "Not found." };
    const db = await createClient();
    const { data: vs } = await db.from("document_versions").select("id,revision,status,body,file_path,file_name").eq("document_id", docId).order("revision", { ascending: false });
    let draft = (vs ?? []).find((v) => v.status === "draft");
    const body = str(f, "body", 60000), note = opt(f, "change_note", 1000);
    const up = await upload(s.tenant.id, "documents", f, "file");
    if (typeof up === "string") return { error: up };
    if (!draft) {
      const cur = (vs ?? []).find((v) => v.status === "approved");
      const { data, error } = await db.from("document_versions").insert({ tenant_id: s.tenant.id, document_id: docId, revision: ((vs ?? [])[0]?.revision ?? -1) + 1,
        body: cur?.body ?? null, file_path: cur?.file_path ?? null, file_name: cur?.file_name ?? null, status: "draft", prepared_by: s.user.id, prepared_by_name: s.user.full_name })
        .select("id,revision,status,body,file_path,file_name").single(); err(error);
      draft = data!;
      if (f.get("start") === "1") { refresh(`/app/compliance/documents/${docId}`); return done(`Revision ${draft.revision} started as a draft from the current text. Change it, say what changed, then have it approved.`); }
    }
    const fields: Record<string, unknown> = { body: body || null, change_note: note, prepared_by: s.user.id, prepared_by_name: s.user.full_name };
    if (up) { fields.file_path = up.path; fields.file_name = up.name; }
    if (f.get("remove_file") === "on") { fields.file_path = null; fields.file_name = null; }
    const { error } = await db.from("document_versions").update(fields).eq("id", draft.id); err(error);
    refresh(`/app/compliance/documents/${docId}`);
    return { ok: `Draft revision ${draft.revision} saved.` };
  } catch (e) { return fail(e); }
}

export async function approveRevision(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const vid = uuid(f, "version_id"); if (!vid) return { error: "Not found." };
    const db = await createClient();
    const { data: v } = await db.from("document_versions").select("*, document:documents(*)").eq("id", vid).single();
    if (!v || v.status !== "draft") return { error: "Only a draft can be approved." };
    if (!v.body && !v.file_path) return { error: "Write the text or attach the PDF first." };
    if (v.body && /\[to be filled\]/i.test(v.body)) return { error: "The text still has [to be filled] in it — fill those in (and save the draft) before approving." };
    const doc = (Array.isArray(v.document) ? v.document[0] : v.document) as { id: string; doc_no: string; title: string; review_months: number; needs_ack: boolean; employee_access: boolean; audience: string; department_id: string | null; plant_id: string | null; sample: boolean };
    const eff = str(f, "effective_from", 10) || istToday();
    if (!isDate(eff)) return { error: "Choose the effective date." };
    await db.from("document_versions").update({ status: "obsolete" }).eq("document_id", doc.id).eq("status", "approved");
    const { error } = await db.from("document_versions").update({ status: "approved", approved_by: s.user.id, approved_by_name: s.user.full_name, approved_at: new Date().toISOString(),
      effective_from: eff, review_due: reviewDue(eff, doc.review_months), review_notified_at: null, change_note: v.change_note ?? (v.revision === 0 ? "First issue" : null) }).eq("id", vid); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "document.approved", entity: "document_versions", entityId: vid, data: { doc_no: doc.doc_no, revision: v.revision } });
    let msg = `${doc.doc_no} revision ${v.revision} approved, effective ${eff}. Earlier revisions are now obsolete.`;
    if (v.prepared_by && v.prepared_by === s.user.id) msg += " (You both prepared and approved it — a second person approving is better practice.)";
    if (doc.needs_ack && doc.employee_access && !doc.sample && f.get("notify") !== "off") {
      const r = await sendPolicy(s.tenant, doc, { id: vid, revision: v.revision, effective_from: eff, change_note: v.change_note }, `${await currentOrigin()}/me/policies/${doc.id}`);
      msg += r.sent || r.left ? ` ${r.sent} ${r.sent === 1 ? "person was" : "people were"} asked to read and acknowledge it${r.left ? `; ${r.left} more tonight` : ""}.` : "";
    }
    refresh(`/app/compliance/documents/${doc.id}`);
    return done(msg);
  } catch (e) { return fail(e); }
}

export async function discardDraft(_: ActionState, f: FormData): Promise<ActionState> {
  let gone: string | null = null;
  try {
    const s = await assertRole(HR);
    const vid = uuid(f, "version_id"); if (!vid) return { error: "Not found." };
    const db = await createClient();
    const { data: v } = await db.from("document_versions").select("id,status,document_id,revision").eq("id", vid).single();
    if (!v || v.status !== "draft") return { error: "Only a draft can be discarded." };
    const { count } = await db.from("document_versions").select("id", { count: "exact", head: true }).eq("document_id", v.document_id);
    if (count === 1) { const { error } = await db.from("documents").delete().eq("id", v.document_id); err(error); gone = "/app/compliance/documents"; }
    else { const { error } = await db.from("document_versions").delete().eq("id", vid); err(error); }
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "document.draft_discarded", entity: "document_versions", entityId: vid });
    if (gone) await setFlash({ ok: "The document (never approved) is deleted." });
    else { refresh(`/app/compliance/documents/${v.document_id}`); return done(`Draft revision ${v.revision} discarded.`); }
  } catch (e) { return fail(e); }
  redirect(gone!);
}

export async function setDocumentActive(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const on = f.get("on") === "1";
    const db = await createClient();
    const { error } = await db.from("documents").update({ active: on }).eq("id", id); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: on ? "document.reinstated" : "document.withdrawn", entity: "documents", entityId: id });
    refresh(`/app/compliance/documents/${id}`);
    return done(on ? "Back in use." : "Withdrawn — no longer in use (kept with its history).");
  } catch (e) { return fail(e); }
}

/** a draft's text written by the free AI from HR's points (replaces the draft text; HR reviews it) */
export async function aiRedraft(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const docId = uuid(f, "document_id"); if (!docId) return { error: "Not found." };
    const db = await createClient();
    const { data: d } = await db.from("documents").select("title,kind").eq("id", docId).single();
    const { data: dr } = await db.from("document_versions").select("id").eq("document_id", docId).eq("status", "draft").maybeSingle();
    if (!d || !dr) return { error: "Start a draft revision first." };
    const r = await draftDocument(db as never, actorOf(s), { title: d.title, kind: d.kind, points: str(f, "points", 3000), company: s.tenant.legal_name || s.tenant.name });
    if ("error" in r) return { error: r.error };
    const { error } = await db.from("document_versions").update({ body: r.body, ai_model: r.model, prepared_by: s.user.id, prepared_by_name: s.user.full_name }).eq("id", dr.id); err(error);
    refresh(`/app/compliance/documents/${docId}`);
    return done("The AI wrote the draft text. Read and correct every line before it is approved.");
  } catch (e) { return fail(e); }
}

// ================================================================== compliance register
export async function saveItem(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id");
    const code = str(f, "code", 30).toUpperCase(), title = str(f, "title", 160), kind = str(f, "kind", 20), freq = str(f, "frequency", 20);
    if (!code) return { error: "Give it a short code (e.g. PF)." };
    if (title.length < 2) return { error: "Give it a title." };
    if (!(kind in KINDS)) return { error: "Choose the kind." };
    if (!(freq in FREQS)) return { error: "Choose how often it falls due." };
    const months = f.getAll("due_months").map(Number).filter((m) => m >= 1 && m <= 12);
    if (["quarterly", "half_yearly", "yearly"].includes(freq) && !months.length) return { error: "Tick the month(s) it falls due." };
    const day = Number(str(f, "due_day", 2));
    if (freq !== "once" && !(day >= 1 && day <= 31)) return { error: "Due day: 1 to 31 (31 = the last day of the month)." };
    const valid = opt(f, "valid_until", 10);
    if (valid && !isDate(valid)) return { error: "Valid until: choose a date." };
    const email = opt(f, "owner_email", 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Reminder e-mail is not valid." };
    const row = { tenant_id: s.tenant.id, code, title, law: opt(f, "law", 200), kind, frequency: freq, due_months: freq === "monthly" || freq === "once" ? [] : months, due_day: freq === "once" ? 1 : day,
      state: opt(f, "state", 40), licence_no: opt(f, "licence_no", 80), valid_until: valid, renew_days: Math.min(365, Math.max(0, Number(str(f, "renew_days", 3)) || 60)),
      remind_days: Math.min(90, Math.max(0, Number(str(f, "remind_days", 2)) || 7)), owner_name: opt(f, "owner_name", 120), owner_email: email, notes: opt(f, "notes", 1000), active: f.get("active") !== "off" };
    const db = await createClient();
    const { error } = id ? await db.from("compliance_items").update(row).eq("id", id) : await db.from("compliance_items").insert(row); err(error);
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: id ? "compliance.item_saved" : "compliance.item_added", entity: "compliance_items", entityId: id ?? code });
    await ensureTasks(s.tenant.id);
    refresh("/app/compliance/items");
    return id ? { ok: "Saved." } : { ok: `${code} added to the register.` };
  } catch (e) { return fail(e); }
}

export async function completeTask(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(REG);
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: t } = await db.from("compliance_tasks").select("id,status,due_on,item:compliance_items(id,kind,frequency,title,valid_until)").eq("id", id).single();
    if (!t) return { error: "Not found." };
    const it = (Array.isArray(t.item) ? t.item[0] : t.item) as { id: string; kind: string; frequency: string; title: string; valid_until: string | null };
    const how = str(f, "how", 10);
    if (how === "na") {
      const note = opt(f, "note", 1000); if (!note) return { error: "Say why it does not apply." };
      const { error } = await db.from("compliance_tasks").update({ status: "not_applicable", note, done_by: s.user.id, done_by_name: s.user.full_name, done_on: istToday() }).eq("id", id); err(error);
    } else if (how === "reopen") {
      const { error } = await db.from("compliance_tasks").update({ status: "open", done_on: null, done_by: null, done_by_name: null }).eq("id", id); err(error);
    } else {
      const on = str(f, "done_on", 10) || istToday();
      if (!isDate(on) || on > istToday()) return { error: "Done on: a date, not in the future." };
      const reference = opt(f, "reference", 120);
      const up = await upload(s.tenant.id, "compliance", f, "evidence");
      if (typeof up === "string") return { error: up };
      if (!reference && !up) return { error: "Give the reference no. (challan / acknowledgement) or attach the proof." };
      let newValid: string | null = null;
      if (it.frequency === "once") {
        newValid = opt(f, "new_valid_until", 10);
        if (!isDate(newValid) || (it.valid_until && newValid <= it.valid_until)) return { error: "Enter the new valid-until date of the renewed licence." };
      }
      const { error } = await db.from("compliance_tasks").update({ status: "done", done_on: on, reference, note: opt(f, "note", 1000), done_by: s.user.id, done_by_name: s.user.full_name,
        ...(up ? { evidence_path: up.path, evidence_name: up.name } : {}) }).eq("id", id); err(error);
      if (newValid) { await createAdminClient().from("compliance_items").update({ valid_until: newValid }).eq("id", it.id); await ensureTasks(s.tenant.id); }
    }
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: `compliance.task_${how || "done"}`, entity: "compliance_tasks", entityId: id });
    refresh();
    return done(how === "na" ? `${it.title}: marked not applicable.` : how === "reopen" ? `${it.title}: open again.` : `${it.title}: done${t.due_on < istToday() && (str(f, "done_on", 10) || istToday()) > t.due_on ? " (late)" : ""}.`);
  } catch (e) { return fail(e); }
}
