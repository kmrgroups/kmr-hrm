"use client";
import { p } from "@/lib/base-path";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { BLOOD_GROUPS, isValidIfsc } from "@/lib/validators";
import { DOCUMENT_TYPES, ONBOARDING_SECTIONS, type SectionKey } from "@/lib/types";

export interface WizardInitial {
  token: string;
  company: string;
  name: string;
  designation: string | null;
  department: string | null;
  joiningDate: string | null;
  email: string | null;
  mobile: string | null;
  profile: Record<string, unknown>;
  privateData: Record<string, string | null> | null;
  docs: Doc[];
  selfieUrl: string | null;
  status: string;
  sentBack: string[];
  hrComment: string | null;
  step: number;
  expiresOn: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}
interface Doc { id: string; doc_type: string; file_name: string | null; uploaded_at: string }
type Errors = Record<string, string>;
type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- helpers
async function api(token: string, payload: object) {
  const res = await fetch(p(`/api/onboard/${token}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong"), { fields: data.fields as Errors | undefined });
  return data;
}

function getIn(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Obj)[k]), obj);
}
function setIn<T extends Obj>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const root: Obj = Array.isArray(obj) ? ([...obj] as unknown as Obj) : { ...obj };
  let cur: Obj = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    const copy = Array.isArray(next) ? [...next] : { ...((next as Obj) ?? {}) };
    cur[k] = copy;
    cur = copy as Obj;
  }
  cur[keys[keys.length - 1]] = value;
  return root as T;
}

async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 1_200_000) return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
}

// ---------------------------------------------------------------- field
function Field(props: {
  label: string; path: string; value: Obj; set: (p: string, v: unknown) => void; errors: Errors;
  type?: string; required?: boolean; options?: readonly string[]; help?: string; full?: boolean;
  placeholder?: string; inputMode?: "numeric" | "text" | "tel" | "email"; upper?: boolean; onBlur?: () => void; maxLength?: number;
}) {
  const v = (getIn(props.value, props.path) as string | undefined) ?? "";
  const err = props.errors[props.path];
  const common = {
    id: props.path, name: props.path, className: err ? "invalid" : undefined, "aria-invalid": !!err,
    onBlur: props.onBlur,
  };
  return (
    <label className={`field${props.full ? " full" : ""}`} htmlFor={props.path}>
      <span>{props.label}{props.required && <span className="req"> *</span>}</span>
      {props.options ? (
        <select {...common} value={v} onChange={(e) => props.set(props.path, e.target.value)}>
          <option value="">Select…</option>
          {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : props.type === "textarea" ? (
        <textarea {...common} value={v} onChange={(e) => props.set(props.path, e.target.value)} />
      ) : (
        <input
          {...common} type={props.type || "text"} value={v} placeholder={props.placeholder} inputMode={props.inputMode} maxLength={props.maxLength}
          onChange={(e) => props.set(props.path, props.upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      )}
      {props.help && <span className="help">{props.help}</span>}
      {err && <span className="fielderror">{err}</span>}
    </label>
  );
}

function Repeater({ title, path, value, set, errors, blank, max, render }: {
  title: string; path: string; value: Obj; set: (p: string, v: unknown) => void; errors: Errors;
  blank: Obj; max: number; render: (prefix: string, i: number) => React.ReactNode;
}) {
  const list = (getIn(value, path) as Obj[] | undefined) ?? [];
  return (
    <div className="full stack">
      <div className="spread"><h3 style={{ margin: 0 }}>{title}</h3>
        {list.length < max && <button type="button" className="btn secondary small" onClick={() => set(path, [...list, { ...blank }])}>+ Add</button>}
      </div>
      {errors[path] && <div className="fielderror">{errors[path]}</div>}
      {list.map((_, i) => (
        <div className="repeater" key={i}>
          <div className="formgrid">{render(`${path}.${i}`, i)}</div>
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <button type="button" className="btn ghost small" onClick={() => set(path, list.filter((__, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      {list.length === 0 && <p className="muted" style={{ fontSize: 14, margin: 0 }}>None added.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- main
export function Wizard({ initial }: { initial: WizardInitial }) {
  const sentBack = initial.status === "sent_back" ? initial.sentBack : null;
  const editable = (k: SectionKey) => !sentBack || sentBack.includes(k);
  const firstEditable = sentBack ? Math.max(0, ONBOARDING_SECTIONS.findIndex((s) => sentBack.includes(s.key))) : Math.min(initial.step, 6);

  const [step, setStep] = useState(firstEditable);
  const [done, setDone] = useState<Set<string>>(() => {
    const s = new Set<string>((initial.profile._done as string[]) ?? []);
    if (initial.privateData) s.add("statutory");
    return s;
  });
  const [docs, setDocs] = useState<Doc[]>(initial.docs);
  const [selfieUrl, setSelfieUrl] = useState(initial.selfieUrl);
  const [submitted, setSubmitted] = useState(false);

  const docsDone = DOCUMENT_TYPES.filter((d) => d.required).every((d) => docs.some((x) => x.doc_type === d.key));
  const isDone = (k: SectionKey) => (k === "documents" ? docsDone : k === "selfie" ? !!selfieUrl : done.has(k));
  const section = ONBOARDING_SECTIONS[step];
  const go = (i: number) => { setStep(i); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const next = () => go(Math.min(step + 1, ONBOARDING_SECTIONS.length - 1));
  const markDone = (k: string) => setDone((s) => new Set(s).add(k));

  if (submitted) {
    return (
      <div className="card">
        <h1>Thank you, {initial.name.split(" ")[0]}!</h1>
        <p>Your details have been submitted to HR at {initial.company}. You will receive your employee ID and portal login by email and WhatsApp once HR approves them.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h1 style={{ fontSize: "1.3rem" }}>Welcome, {initial.name.split(" ")[0]}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {[initial.designation, initial.department].filter(Boolean).join(" · ")}
          {initial.joiningDate ? ` · Joining ${initial.joiningDate}` : ""}
        </p>
        <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>Your progress is saved after each step. This link is valid until {initial.expiresOn}.</p>
        {sentBack && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            <b>HR has asked you to update:</b> {ONBOARDING_SECTIONS.filter((s) => sentBack.includes(s.key)).map((s) => s.label).join(", ")}
            {initial.hrComment ? <><br />“{initial.hrComment}”</> : null}
          </div>
        )}
      </div>

      <div className="stepper" role="tablist">
        {ONBOARDING_SECTIONS.map((s, i) => (
          <button key={s.key} type="button" onClick={() => go(i)}
            className={[i === step ? "current" : "", isDone(s.key) ? "done" : "", sentBack?.includes(s.key) ? "flag" : ""].join(" ")}>
            <span className="n">{isDone(s.key) && i !== step ? "✓" : i + 1}</span><span className="l">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <h2>{step + 1}. {section.label}</h2>
        {!editable(section.key) && section.key !== "selfie" ? (
          <>
            <div className="alert info">No changes were requested in this section.</div>
            <div className="navbtns"><button className="btn secondary" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>Back</button><button className="btn" onClick={next}>Next</button></div>
          </>
        ) : section.key === "documents" ? (
          <DocumentsStep token={initial.token} docs={docs} setDocs={setDocs} sb={{ url: initial.supabaseUrl, key: initial.supabaseAnonKey }} onBack={() => go(step - 1)} onNext={next} />
        ) : section.key === "selfie" ? (
          <SelfieStep
            token={initial.token} selfieUrl={selfieUrl} setSelfieUrl={setSelfieUrl} canRetake={editable("selfie")}
            sb={{ url: initial.supabaseUrl, key: initial.supabaseAnonKey }} company={initial.company}
            onBack={() => go(step - 1)} onSubmitted={() => setSubmitted(true)}
            goTo={(label) => {
              let i = ONBOARDING_SECTIONS.findIndex((s) => label === s.label);
              if (i < 0 && DOCUMENT_TYPES.some((d) => d.label === label)) i = ONBOARDING_SECTIONS.findIndex((s) => s.key === "documents");
              if (i < 0 && /selfie/i.test(label)) i = ONBOARDING_SECTIONS.findIndex((s) => s.key === "selfie");
              if (i >= 0) go(i);
            }}
          />
        ) : (
          <SectionForm
            key={section.key}
            token={initial.token}
            section={section.key as "personal" | "family" | "academic" | "professional" | "statutory"}
            initial={initialValue(section.key, initial)}
            hasAadhaar={!!initial.privateData?.aadhaar_last4}
            aadhaarLast4={initial.privateData?.aadhaar_last4 ?? null}
            step={step}
            onBack={step > 0 ? () => go(step - 1) : undefined}
            onSaved={() => { markDone(section.key); next(); }}
          />
        )}
      </div>
    </div>
  );
}

function initialValue(key: SectionKey, init: WizardInitial): Obj {
  const p = init.profile as Obj;
  const [first, ...rest] = init.name.split(" ");
  switch (key) {
    case "personal":
      return (p.personal as Obj) ?? {
        first_name: first, last_name: rest.join(" "), mobile: init.mobile ?? "", personal_email: init.email ?? "",
        nationality: "Indian", emergency_contacts: [{ name: "", relation: "", phone: "" }],
      };
    case "family": return (p.family as Obj) ?? { members: [], nominees: [] };
    case "academic": return (p.academic as Obj) ?? { education: [{ qualification: "", institute: "", year: "", score: "" }] };
    case "professional": return (p.professional as Obj) ?? { employers: [], references: [] };
    case "statutory": {
      const d = init.privateData ?? {};
      return { ...d, aadhaar: "", account_number_confirm: d.account_number ?? "", tax_regime: d.tax_regime ?? "new" };
    }
    default: return {};
  }
}

// ---------------------------------------------------------------- form sections
function SectionForm({ token, section, initial, onSaved, onBack, step, hasAadhaar, aadhaarLast4 }: {
  token: string; section: "personal" | "family" | "academic" | "professional" | "statutory"; initial: Obj;
  onSaved: () => void; onBack?: () => void; step: number; hasAadhaar: boolean; aadhaarLast4: string | null;
}) {
  const [value, setValue] = useState<Obj>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (p: string, v: unknown) => setValue((cur) => setIn(cur, p, v));
  const f = { value, set, errors };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErrors({}); setMsg(null);
    try {
      await api(token, { action: "save", section, data: value, step: step + 1 });
      onSaved();
    } catch (err) {
      const fe = (err as { fields?: Errors }).fields;
      if (fe) setErrors(fe);
      setMsg((err as Error).message);
      setTimeout(() => document.querySelector(".invalid, .fielderror")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    } finally { setSaving(false); }
  }

  async function lookupIfsc() {
    const code = String(value.ifsc || "").toUpperCase();
    if (!isValidIfsc(code)) return;
    try {
      const r = await fetch(`https://ifsc.razorpay.com/${code}`);
      if (!r.ok) { setErrors((e) => ({ ...e, ifsc: "IFSC not found — please check" })); return; }
      const j = await r.json();
      setValue((cur) => ({ ...cur, bank_name: cur.bank_name || j.BANK, bank_branch: cur.bank_branch || j.BRANCH }));
    } catch { /* lookup is a convenience only */ }
  }

  const copyAddress = () => set("present_address", value.permanent_address ?? "");

  return (
    <form onSubmit={save} noValidate>
      <div className="formgrid">
        {section === "personal" && (<>
          <Field label="First name" path="first_name" required {...f} />
          <Field label="Last name / surname" path="last_name" {...f} />
          <Field label="Father's / spouse's name" path="father_name" {...f} />
          <Field label="Date of birth" path="date_of_birth" type="date" required {...f} />
          <Field label="Gender" path="gender" options={["Male", "Female", "Other"]} required {...f} />
          <Field label="Marital status" path="marital_status" options={["Single", "Married", "Widowed", "Divorced", "Separated"]} {...f} />
          <Field label="Blood group" path="blood_group" options={BLOOD_GROUPS} required help="Printed on your ID card" {...f} />
          <Field label="Nationality" path="nationality" {...f} />
          <Field label="Mobile (WhatsApp)" path="mobile" type="tel" inputMode="tel" required {...f} />
          <Field label="Personal email" path="personal_email" type="email" inputMode="email" {...f} />
          <Field label="Permanent address" path="permanent_address" type="textarea" required full {...f} />
          <div className="full">
            <Field label="Present address" path="present_address" type="textarea" required {...f} />
            <button type="button" className="btn ghost small" onClick={copyAddress}>Same as permanent address</button>
          </div>
          <Repeater title="Emergency contacts" path="emergency_contacts" max={3} blank={{ name: "", relation: "", phone: "" }} {...f}
            render={(p, i) => (<>
              <Field label="Name" path={`${p}.name`} required {...f} />
              <Field label="Relation" path={`${p}.relation`} required placeholder="Father, Spouse…" {...f} />
              <Field label="Phone" path={`${p}.phone`} type="tel" inputMode="tel" required help={i === 0 ? "Printed on your ID card" : undefined} {...f} />
            </>)} />
        </>)}

        {section === "family" && (<>
          <Repeater title="Family members" path="members" max={12} blank={{ name: "", relation: "", date_of_birth: "", occupation: "" }} {...f}
            render={(p) => (<>
              <Field label="Name" path={`${p}.name`} required {...f} />
              <Field label="Relation" path={`${p}.relation`} required {...f} />
              <Field label="Date of birth" path={`${p}.date_of_birth`} type="date" {...f} />
              <Field label="Occupation" path={`${p}.occupation`} {...f} />
            </>)} />
          <Repeater title="Nominees (PF, gratuity, ESI)" path="nominees" max={8} blank={{ name: "", relation: "", share: 100, for: "All" }} {...f}
            render={(p) => (<>
              <Field label="Nominee name" path={`${p}.name`} required {...f} />
              <Field label="Relation" path={`${p}.relation`} required {...f} />
              <Field label="Share %" path={`${p}.share`} type="number" inputMode="numeric" required {...f} />
              <Field label="Nominated for" path={`${p}.for`} options={["All", "PF", "Gratuity", "ESI"]} required {...f} />
            </>)} />
          <p className="full muted" style={{ fontSize: 13 }}>Shares for each purpose must add up to 100%.</p>
        </>)}

        {section === "academic" && (<>
          <Repeater title="Education (highest first)" path="education" max={8} blank={{ qualification: "", institute: "", year: "", score: "" }} {...f}
            render={(p) => (<>
              <Field label="Qualification" path={`${p}.qualification`} required placeholder="B.E. Mechanical, Diploma, ITI, 12th…" {...f} />
              <Field label="Institute / board" path={`${p}.institute`} required {...f} />
              <Field label="Year of passing" path={`${p}.year`} inputMode="numeric" maxLength={4} required {...f} />
              <Field label="% / CGPA" path={`${p}.score`} {...f} />
            </>)} />
          <Field label="Certifications & licences" path="certifications" type="textarea" full help="e.g. Six Sigma Green Belt, IATF 16949 Internal Auditor, forklift licence" {...f} />
        </>)}

        {section === "professional" && (<>
          <Field label="Total experience (years)" path="total_experience_years" inputMode="numeric" help="Leave blank if you are a fresher" {...f} />
          <div />
          <Repeater title="Previous employers (latest first)" path="employers" max={10} blank={{ company: "", designation: "", from: "", to: "", last_ctc: "", reason: "" }} {...f}
            render={(p) => (<>
              <Field label="Company" path={`${p}.company`} required {...f} />
              <Field label="Designation" path={`${p}.designation`} required {...f} />
              <Field label="From" path={`${p}.from`} type="month" required {...f} />
              <Field label="To" path={`${p}.to`} type="month" required {...f} />
              <Field label="Last CTC (₹ per year)" path={`${p}.last_ctc`} inputMode="numeric" {...f} />
              <Field label="Reason for leaving" path={`${p}.reason`} {...f} />
            </>)} />
          <Repeater title="References" path="references" max={3} blank={{ name: "", company: "", designation: "", phone: "", email: "" }} {...f}
            render={(p) => (<>
              <Field label="Name" path={`${p}.name`} required {...f} />
              <Field label="Company" path={`${p}.company`} required {...f} />
              <Field label="Designation" path={`${p}.designation`} {...f} />
              <Field label="Phone" path={`${p}.phone`} type="tel" inputMode="tel" required {...f} />
              <Field label="Email" path={`${p}.email`} type="email" {...f} />
            </>)} />
        </>)}

        {section === "statutory" && (<>
          <Field label="PAN" path="pan" required upper maxLength={10} placeholder="ABCDE1234F" {...f} />
          <Field label="Aadhaar number" path="aadhaar" inputMode="numeric" maxLength={14} required={!hasAadhaar}
            help={hasAadhaar ? `Saved (XXXX XXXX ${aadhaarLast4}). Leave blank to keep it.` : "Only the last 4 digits are stored; upload the card in Documents."} {...f} />
          <Field label="UAN (if you had PF before)" path="uan" inputMode="numeric" maxLength={12} {...f} />
          <Field label="Previous PF number" path="previous_pf_no" {...f} />
          <Field label="ESI IP number (if any)" path="esi_ip_no" inputMode="numeric" {...f} />
          <Field label="Income tax regime" path="tax_regime" options={["new", "old"]} help="New regime is the default" {...f} />
          <h3 className="full" style={{ marginTop: 8 }}>Salary bank account</h3>
          <Field label="IFSC" path="ifsc" required upper maxLength={11} placeholder="SBIN0001234" onBlur={lookupIfsc} help="Bank and branch fill in automatically" {...f} />
          <Field label="Bank name" path="bank_name" required {...f} />
          <Field label="Branch" path="bank_branch" {...f} />
          <Field label="Account holder name" path="account_holder" required help="As printed on the cheque / passbook" {...f} />
          <Field label="Account number" path="account_number" inputMode="numeric" required {...f} />
          <Field label="Re-enter account number" path="account_number_confirm" inputMode="numeric" required {...f} />
        </>)}
      </div>
      {msg && <div className="alert error" style={{ marginTop: 14 }}>{msg}</div>}
      <div className="navbtns">
        {onBack ? <button type="button" className="btn secondary" onClick={onBack}>Back</button> : <span />}
        <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save & continue"}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- documents
// one storage client for the whole page (only used for signed uploads, no session)
let uploadClient: ReturnType<typeof createClient> | null = null;
function useUploader(token: string, sb: { url: string; key: string }) {
  const client = useMemo(() => {
    uploadClient ??= createClient(sb.url, sb.key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: "hrm-onboard-upload" } });
    return uploadClient;
  }, [sb.url, sb.key]);
  return async (docType: string, blob: Blob, fileName: string) => {
    const mime = blob.type || "image/jpeg";
    const u = await api(token, { action: "upload-url", doc_type: docType, mime, size: blob.size, file_name: fileName });
    const { error } = await client.storage.from("employee-docs").uploadToSignedUrl(u.path, u.token, blob, { contentType: mime });
    if (error) throw new Error("Upload failed. Please check your connection and try again.");
    const c = await api(token, { action: "confirm-upload", doc_type: docType, path: u.path, mime, size: blob.size, file_name: fileName });
    return c.doc as Doc;
  };
}

function DocumentsStep({ token, docs, setDocs, sb, onBack, onNext }: {
  token: string; docs: Doc[]; setDocs: React.Dispatch<React.SetStateAction<Doc[]>>; sb: { url: string; key: string };
  onBack: () => void; onNext: () => void;
}) {
  const upload = useUploader(token, sb);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(docType: string, files: FileList | null) {
    if (!files?.length) return;
    setBusy(docType); setError(null);
    try {
      for (const file of Array.from(files)) {
        const blob = await compressImage(file);
        const doc = await upload(docType, blob, file.name);
        setDocs((d) => [...d, doc]);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function remove(id: string) {
    setError(null);
    try { await api(token, { action: "delete-doc", id }); setDocs((d) => d.filter((x) => x.id !== id)); }
    catch (e) { setError((e as Error).message); }
  }

  const missing = DOCUMENT_TYPES.filter((d) => d.required && !docs.some((x) => x.doc_type === d.key));
  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>Take a clear photo with your phone or upload a PDF. JPG, PNG or PDF, up to 10 MB each. You can add several files for one item.</p>
      <div className="doclist">
        {DOCUMENT_TYPES.map((d) => {
          const mine = docs.filter((x) => x.doc_type === d.key);
          return (
            <div className="docrow" key={d.key}>
              <div>
                <b>{d.label}</b>{d.required && <span className="req" style={{ color: "var(--danger)" }}> *</span>}
                <div className="files" style={{ marginTop: mine.length ? 6 : 0 }}>
                  {mine.map((x) => (
                    <span className="chip" key={x.id}>{(x.file_name || "file").slice(0, 28)}<button type="button" aria-label="Remove" onClick={() => remove(x.id)}>×</button></span>
                  ))}
                </div>
              </div>
              <label className={`btn ${mine.length ? "secondary" : ""} small`} style={{ cursor: "pointer" }}>
                {busy === d.key ? "Uploading…" : mine.length ? "Add more" : "Upload"}
                <input type="file" accept="image/*,application/pdf" multiple hidden disabled={!!busy} onChange={(e) => { onFiles(d.key, e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          );
        })}
      </div>
      {error && <div className="alert error">{error}</div>}
      {missing.length > 0 && <div className="alert info">Still needed: {missing.map((m) => m.label).join(", ")}</div>}
      <div className="navbtns">
        <button type="button" className="btn secondary" onClick={onBack}>Back</button>
        <button type="button" className="btn" onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- selfie + consent + submit
function SelfieStep({ token, selfieUrl, setSelfieUrl, sb, onBack, onSubmitted, company, canRetake, goTo }: {
  token: string; selfieUrl: string | null; setSelfieUrl: (u: string) => void; sb: { url: string; key: string };
  onBack: () => void; onSubmitted: () => void; company: string; canRetake: boolean; goTo: (label: string) => void;
}) {
  const upload = useUploader(token, sb);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  // attach the stream once the <video> element has rendered
  useEffect(() => {
    const v = videoRef.current;
    if (camera && v && streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [camera]);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      setCamera(true);
    } catch {
      setError("Camera not available. Use “Choose a photo” instead, or allow camera access in your browser settings.");
    }
  }

  function stopCamera() { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCamera(false); }

  async function save(blob: Blob) {
    setBusy(true); setError(null);
    try {
      await upload("selfie", blob, "selfie.jpg");
      setSelfieUrl(URL.createObjectURL(blob));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setError("Camera is still starting — try again in a moment."); return; }
    // centre crop to 3:4 portrait, 600 x 800
    const targetRatio = 3 / 4;
    let sw = v.videoWidth, sh = v.videoHeight;
    if (sw / sh > targetRatio) sw = sh * targetRatio; else sh = sw / targetRatio;
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(600, 0); ctx.scale(-1, 1); // un-mirror the front camera
    ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, 600, 800);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    stopCamera();
    if (blob) await save(blob);
  }

  async function submit() {
    setBusy(true); setError(null); setMissing([]);
    try { await api(token, { action: "submit", consent }); onSubmitted(); }
    catch (e) {
      setError((e as Error).message);
      const m = (e as Error).message.replace(/^Please complete: /, "");
      if (m !== (e as Error).message) setMissing(m.split(", "));
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>This photo is used on your ID card. Face the camera in good light, without cap or sunglasses.</p>
      <div className="camera">
        {camera ? <video ref={videoRef} playsInline muted style={{ transform: "scaleX(-1)" }} /> : selfieUrl ? <img src={selfieUrl} alt="Your selfie" /> : null}
        {camera && <div className="oval" />}
      </div>
      {canRetake && (
        <div className="row" style={{ justifyContent: "center" }}>
          {camera ? (<>
            <button type="button" className="btn" onClick={capture} disabled={busy}>Capture</button>
            <button type="button" className="btn secondary" onClick={stopCamera}>Cancel</button>
          </>) : (<>
            <button type="button" className="btn" onClick={startCamera} disabled={busy}>{selfieUrl ? "Retake selfie" : "Open camera"}</button>
            <label className="btn secondary" style={{ cursor: "pointer" }}>
              Choose a photo
              <input type="file" accept="image/*" capture="user" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await save(await compressImage(f)); e.target.value = ""; }} />
            </label>
          </>)}
        </div>
      )}
      {busy && <p className="muted" style={{ textAlign: "center" }}>Please wait…</p>}

      <hr />
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I confirm that the information and documents I have provided are true and complete. I consent to {company} storing and
          processing my personal data, including identity documents and bank details, for employment, payroll, statutory compliance
          and verification purposes, in line with the Digital Personal Data Protection Act, 2023.
        </span>
      </label>
      {error && <div className="alert error">{error}</div>}
      {missing.length > 0 && (
        <div className="row">{missing.map((m) => <button key={m} type="button" className="btn secondary small" onClick={() => goTo(m)}>{m}</button>)}</div>
      )}
      <div className="navbtns">
        <button type="button" className="btn secondary" onClick={onBack}>Back</button>
        <button type="button" className="btn accent" onClick={submit} disabled={!consent || busy || !selfieUrl}>Submit to HR</button>
      </div>
    </div>
  );
}
