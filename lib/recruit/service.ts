import "server-only";
// Recruitment work that several screens share: taking in a resume, keeping one candidate per person, scoring,
// reference numbers. The caller decides who may do it (HR screens use the signed-in client; the careers page and
// links sent to candidates use the service client after checking their token).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseResume, type ResumeProfile } from "./resume";
import { resumeText, extOf, RESUME_TYPES, MAX_RESUME_BYTES } from "./resume-text";
import { scoreResume, type RoleIntent, type ScoreResult } from "./score";

export const RESUME_BUCKET = "hrm-resumes";

export interface RecruitSettings {
  careers_enabled: boolean; careers_intro: string | null; req_approval: boolean; suitable_score: number; hold_score: number;
  regret_auto: boolean; regret_delay_days: number; offer_valid_days: number; gratuity_in_ctc: boolean; offer_signatory: string | null; offer_terms: string | null;
}
const DEFAULTS: RecruitSettings = { careers_enabled: true, careers_intro: null, req_approval: true, suitable_score: 70, hold_score: 50, regret_auto: true,
  regret_delay_days: 3, offer_valid_days: 7, gratuity_in_ctc: true, offer_signatory: null, offer_terms: null };

export async function recruitSettings(db: SupabaseClient, tenantId: string): Promise<RecruitSettings> {
  const { data } = await db.from("recruit_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) } as RecruitSettings;
}

/** REQ-2026-007 / OFF-2026-012: the next number for this company and year */
export async function nextRef(db: SupabaseClient, tenantId: string, table: "requisitions" | "offers", prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await db.from(table).select("ref_no").eq("tenant_id", tenantId).like("ref_no", `${prefix}-${year}-%`).order("ref_no", { ascending: false }).limit(1);
  const last = Number(String(data?.[0]?.ref_no ?? "").split("-").pop()) || 0;
  return `${prefix}-${year}-${String(last + 1).padStart(3, "0")}`;
}

export interface ReqRow {
  id: string; tenant_id: string; ref_no: string; title: string; status: string; published: boolean; headcount: number;
  designation_id: string | null; department_id: string | null; plant_id: string | null; jd_id: string | null;
  exp_min: number | null; exp_max: number | null; ctc_min: number | null; ctc_max: number | null; notice_max_days: number | null; location: string | null;
}
export interface JdRow {
  id: string; title: string; family: string | null; purpose: string | null; responsibilities: string[]; kpis: string[];
  must_have: { name: string; weight: number }[]; good_to_have: { name: string; weight: number }[];
  qualifications: string | null; experience: string | null; reporting_to: string | null; context: string | null; outcomes: string[]; status: string; version: number;
}

export function roleIntent(req: ReqRow, jd: JdRow | null): RoleIntent {
  return {
    must_have: jd?.must_have ?? [], good_to_have: jd?.good_to_have ?? [], family: jd?.family ?? null, context: jd?.context ?? null, outcomes: jd?.outcomes ?? [],
    exp_min: req.exp_min, exp_max: req.exp_max, ctc_max: req.ctc_max, notice_max_days: req.notice_max_days, location: req.location,
  };
}

export async function scoreApplication(db: SupabaseClient, applicationId: string): Promise<ScoreResult | null> {
  const { data: app } = await db.from("applications").select("id,tenant_id,requisition_id,candidate:candidates(*)").eq("id", applicationId).maybeSingle();
  if (!app) return null;
  const cand = (Array.isArray(app.candidate) ? app.candidate[0] : app.candidate) as (ResumeProfile & { resume_text: string | null; skills: string[] }) | null;
  const { data: req } = await db.from("requisitions").select("*").eq("id", app.requisition_id).single();
  const jd = req?.jd_id ? (await db.from("job_descriptions").select("*").eq("id", req.jd_id).maybeSingle()).data : null;
  const st = await recruitSettings(db, app.tenant_id);
  // no resume text (a scan, or a candidate added by hand): the competencies HR typed in are scored instead
  const text = cand?.resume_text?.trim() ? cand.resume_text : (cand?.skills?.length ? `Skills: ${cand.skills.join(", ")}` : "");
  const r = scoreResume(text, { ...(cand as ResumeProfile), skills: cand?.skills ?? [] }, roleIntent(req as ReqRow, jd as JdRow | null), { suitable: st.suitable_score, hold: st.hold_score });
  await db.from("applications").update({ score: r.score, breakdown: r.breakdown, evidence: r.evidence, flags: r.flags, recommendation: r.recommendation }).eq("id", applicationId);
  return r;
}

export async function rescoreRequisition(db: SupabaseClient, reqId: string): Promise<number> {
  const { data } = await db.from("applications").select("id").eq("requisition_id", reqId);
  for (const a of data ?? []) await scoreApplication(db, a.id);
  return data?.length ?? 0;
}

export interface IntakeResult {
  ok: boolean; error?: string; candidateId?: string; applicationId?: string; name?: string; duplicate?: boolean; already?: boolean;
  status?: string; score?: number | null; recommendation?: string | null;
}

/**
 * Takes in one resume for a requisition: reads it, keeps one candidate per person (same e-mail or mobile = same person;
 * the newer resume replaces the older), stores the file privately and scores the application.
 */
export async function intakeResume(db: SupabaseClient, o: {
  tenantId: string; requisitionId: string; fileName: string; bytes: Uint8Array; source: "upload" | "careers" | "referral" | "manual" | "import";
  createdBy?: string | null; given?: Partial<ResumeProfile> & { consent?: boolean };
}): Promise<IntakeResult> {
  const ext = extOf(o.fileName);
  if (!RESUME_TYPES[ext]) return { ok: false, error: `${o.fileName}: use PDF, Word (.docx / .doc), text or a photo (JPG / PNG).` };
  if (o.bytes.length > MAX_RESUME_BYTES) return { ok: false, error: `${o.fileName}: larger than 4 MB — save it smaller (e.g. print to PDF).` };
  const { text, status } = await resumeText(o.bytes, o.fileName);
  const parsed = parseResume(text);
  // what the person typed on the careers form wins over what was read from the file
  const g = o.given ?? {};
  const prof: ResumeProfile = { ...parsed, ...Object.fromEntries(Object.entries(g).filter(([k, v]) => v != null && v !== "" && k !== "consent")) } as ResumeProfile;
  const name = prof.full_name || o.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")
    .replace(/\b(resume|cv|biodata|scan(ned)?|photo|img|image|final|updated|latest|new|copy|\d+)\b/gi, "").replace(/\s+/g, " ").trim() || "Candidate";

  // same person? (by e-mail, then mobile)
  let existing: { id: string } | null = null;
  if (prof.email) existing = (await db.from("candidates").select("id").eq("tenant_id", o.tenantId).eq("email", prof.email).maybeSingle()).data;
  if (!existing && prof.phone) existing = (await db.from("candidates").select("id").eq("tenant_id", o.tenantId).eq("phone", prof.phone).maybeSingle()).data;

  const path = `${o.tenantId}/${crypto.randomUUID()}.${ext}`;
  const admin = createAdminClient();                // the bucket is private: only the service client writes to it
  const up = await admin.storage.from(RESUME_BUCKET).upload(path, o.bytes, { contentType: RESUME_TYPES[ext], upsert: false });
  if (up.error) return { ok: false, error: `${o.fileName}: could not store the file (${up.error.message}).` };

  const row = {
    full_name: name.slice(0, 120), email: prof.email, phone: prof.phone, location: prof.location, current_company: prof.current_company, current_designation: prof.current_designation,
    total_exp: prof.total_exp, current_ctc: prof.current_ctc, expected_ctc: prof.expected_ctc, notice_days: prof.notice_days, education: prof.education,
    skills: prof.skills ?? [], resume_path: path, resume_name: o.fileName.slice(0, 200), resume_text: text || null, parse_status: status,
  };
  let candidateId: string;
  if (existing) {
    candidateId = existing.id;
    const { data: old } = await db.from("candidates").select("resume_path").eq("id", candidateId).single();
    // keep earlier facts the new file does not have
    const keep = Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));
    const { error } = await db.from("candidates").update({ ...keep, ...(g.consent ? { consent_at: new Date().toISOString() } : {}) }).eq("id", candidateId);
    if (error) return { ok: false, error: error.message };
    if (old?.resume_path && old.resume_path !== path) await admin.storage.from(RESUME_BUCKET).remove([old.resume_path]);
  } else {
    const { data, error } = await db.from("candidates").insert({ tenant_id: o.tenantId, ...row, source: o.source, created_by: o.createdBy ?? null,
      consent_at: g.consent ? new Date().toISOString() : null }).select("id").single();
    if (error) { await admin.storage.from(RESUME_BUCKET).remove([path]); return { ok: false, error: error.message }; }
    candidateId = data.id;
  }

  let applicationId: string, already = false;
  const { data: prev } = await db.from("applications").select("id,status").eq("requisition_id", o.requisitionId).eq("candidate_id", candidateId).maybeSingle();
  if (prev) { applicationId = prev.id; already = true; }
  else {
    const { data, error } = await db.from("applications").insert({ tenant_id: o.tenantId, requisition_id: o.requisitionId, candidate_id: candidateId, source: o.source }).select("id").single();
    if (error) return { ok: false, error: error.message };
    applicationId = data.id;
  }
  const r = await scoreApplication(db, applicationId);
  return { ok: true, candidateId, applicationId, name, duplicate: !!existing, already, status, score: r?.score ?? null, recommendation: r?.recommendation ?? null };
}

/** short-lived link to read a resume (call only after checking who is asking) */
export async function resumeLink(path: string | null, seconds = 300): Promise<string | null> {
  if (!path) return null;
  const { data } = await createAdminClient().storage.from(RESUME_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export const STATUS_LABEL: Record<string, string> = {
  new: "New", shortlisted: "Shortlisted", on_hold: "On hold", declined: "Declined", interview: "Interview", selected: "Selected",
  offered: "Offered", joined: "Accepted → onboarding", withdrawn: "Withdrawn",
};
export const REQ_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending: "Waiting for approval", approved: "Approved", open: "Open", on_hold: "On hold", closed: "Closed", cancelled: "Cancelled",
};
export const RECO_LABEL: Record<string, string> = { suitable: "Suitable", hold: "Maybe", not_suitable: "Not suitable" };
