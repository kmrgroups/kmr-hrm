import { p } from "@/lib/base-path";
import { notFound } from "next/navigation";
import { requireRole, HR_ROLES, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMasters } from "@/lib/masters";
import { signedDocUrls } from "@/lib/storage";
import { currentOrigin, logoUrl } from "@/lib/tenant";
import { missingItems } from "@/lib/onboarding";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { EmployeeFields } from "@/components/EmployeeFields";
import { IdCardPreview } from "@/components/IdCardPreview";
import { StatusBadge, Avatar, fullName, fmtDate, fmtDateTime, one } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { DOCUMENT_TYPES, ONBOARDING_SECTIONS, type EmployeeStatus, type OnboardingProfile } from "@/lib/types";
import { approve, resendLink, sendBack, setActive, reissueCard, updateJobDetails, setDocumentStatus } from "../actions";
import { saveEmployeeAttendance } from "../../attendance/actions";

export const metadata = { title: "Employee" };

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return <p className="muted">Not filled in yet.</p>;
  return <dl className="kv">{shown.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function mask(s: string | null | undefined, keep = 4) {
  if (!s) return null;
  return s.length <= keep ? s : "•".repeat(Math.max(0, s.length - keep)) + s.slice(-keep);
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole([...HR_ROLES, "manager", "payroll"]);
  const hr = hasRole(session.user, HR_ROLES);
  const supabase = await createClient();

  const { data: emp } = await supabase
    .from("employees")
    .select("*, designation:designations(name), department:departments(name), plant:plants(name)")
    .eq("id", id)
    .maybeSingle();
  if (!emp) notFound();

  const [{ data: priv }, { data: docs }, { data: invite }, { data: card }, { data: activity }, masters] = await Promise.all([
    supabase.from("employee_private").select("*").eq("employee_id", id).maybeSingle(),
    supabase.from("employee_documents").select("*").eq("employee_id", id).order("uploaded_at"),
    supabase.from("onboarding_invites").select("*").eq("employee_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("id_cards").select("*").eq("employee_id", id).eq("status", "active").maybeSingle(),
    supabase.from("audit_log").select("id,action,created_at,actor_id,new_data").eq("entity_id", id).like("action", "%.%").order("created_at", { ascending: false }).limit(20),
    hr ? loadMasters() : Promise.resolve(null),
  ]);
  const { data: shiftList } = hr ? await supabase.from("shifts").select("id,code,name,start_time,end_time").eq("active", true).order("start_time") : { data: null };

  const paths = [emp.photo_path, ...(docs ?? []).map((d) => d.file_path)].filter(Boolean) as string[];
  const urls = await signedDocUrls(paths, 900);
  const photoUrl = emp.photo_path ? urls[emp.photo_path] : null;
  const profile = (emp.profile ?? {}) as OnboardingProfile;
  const status = emp.status as EmployeeStatus;
  const name = fullName(emp);
  const des = one(emp.designation)?.name;
  const dep = one(emp.department)?.name;
  const plant = one(emp.plant)?.name;
  const { data: mgr } = emp.reporting_manager_id
    ? await supabase.from("employees").select("id,first_name,last_name").eq("id", emp.reporting_manager_id).maybeSingle()
    : { data: null };
  const origin = await currentOrigin();
  const missing = missingItems(emp, !!priv, (docs ?? []).map((d) => d.doc_type));
  const pers = profile.personal ?? {};

  return (
    <AppShell session={session} active="/app/employees">
      <div className="pagehead">
        <div className="namecell">
          <Avatar name={name} src={photoUrl} size="lg" />
          <div>
            <h1 style={{ marginBottom: 2 }}>{name}</h1>
            <div className="row" style={{ gap: 8 }}>
              <StatusBadge status={status} />
              {emp.employee_code && <span className="mono">{emp.employee_code}</span>}
              <span className="muted">{[des, dep, plant].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Status-driven action panel ---------- */}
      {hr && status === "submitted" && (
        <div className="card" style={{ borderTop: "3px solid var(--accent)" }}>
          <h2>Review onboarding</h2>
          <p className="muted">Submitted {fmtDateTime(invite?.submitted_at)}. Check the details and documents below, then approve or send back.</p>
          {missing.length > 0 && <div className="alert warn" style={{ marginBottom: 12 }}>Missing: {missing.join(", ")}</div>}
          <div className="grid two">
            <ActionForm action={approve} submitLabel="Approve & create employee ID" pendingLabel="Approving…" hidden={{ id }}
              confirm="Approve this onboarding? An employee ID, login and ID card will be created and sent to the employee.">
              <label className="field">Date of joining<input type="date" name="date_of_joining" defaultValue={emp.date_of_joining ?? new Date().toISOString().slice(0, 10)} /></label>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>Creates the employee code, portal login and ID card, and sends a welcome message on email and WhatsApp.</p>
            </ActionForm>
            <ActionForm action={sendBack} submitLabel="Send back for correction" variant="secondary" hidden={{ id }}>
              <div className="field">Sections to correct
                <div className="row" style={{ gap: "6px 14px", fontWeight: 400 }}>
                  {ONBOARDING_SECTIONS.map((s) => <label key={s.key} className="check"><input type="checkbox" name="sections" value={s.key} /> {s.label}</label>)}
                </div>
              </div>
              <label className="field">Comment to employee<textarea name="comment" placeholder="e.g. PAN card image is blurred, please upload again" /></label>
            </ActionForm>
          </div>
        </div>
      )}

      {hr && ["invited", "onboarding", "sent_back"].includes(status) && (
        <div className="card">
          <h2>Onboarding in progress</h2>
          <KV rows={[
            ["Link status", invite?.status?.replace("_", " ")],
            ["Link expires", fmtDateTime(invite?.expires_at)],
            ["Reminders sent", String(invite?.reminders_sent ?? 0)],
            ["Still missing", missing.length ? missing.join(", ") : "Nothing — waiting for the employee to submit"],
            ...(status === "sent_back" ? [["HR comment", invite?.hr_comment] as [string, string]] : []),
          ]} />
          <div className="row" style={{ marginTop: 14, alignItems: "flex-start" }}>
            <ActionForm action={resendLink} submitLabel="Send reminder" hidden={{ id, reminder: "1" }} />
            <ActionForm action={resendLink} submitLabel="Send a new link" variant="secondary" hidden={{ id }} />
          </div>
        </div>
      )}

      {status === "active" && (
        <div className="card">
          <h2>ID card
            {hr && <a className="btn secondary small" href={p(`/api/id-cards?ids=${id}`)} target="_blank"><Icon name="download" /> Print-ready PDF</a>}
          </h2>
          <IdCardPreview
            company={session.tenant.legal_name || session.tenant.name} logoUrl={logoUrl(session.tenant)} photoUrl={photoUrl}
            name={name} code={emp.employee_code ?? ""} designation={des} department={dep} bloodGroup={emp.blood_group}
            emergencyName={emp.emergency_contact_name} emergencyPhone={emp.emergency_contact_phone}
            verifyUrl={`${origin}/v/${emp.verify_token}`} address={session.tenant.address} validUntil={card?.valid_until ? fmtDate(card.valid_until) : null}
          />
          {hr && (
            <div className="row" style={{ marginTop: 16, alignItems: "flex-start" }}>
              <ActionForm action={reissueCard} submitLabel="Re-issue card" variant="secondary" className="row" hidden={{ id }}
                confirm="Issue a new card? The QR code on the old card will stop verifying.">
                <select name="reason" style={{ width: "auto" }}><option value="lost">Lost</option><option value="damaged">Damaged</option><option value="details changed">Details changed</option></select>
              </ActionForm>
              <ActionForm action={setActive} submitLabel="Deactivate employee" variant="danger" hidden={{ id, active: "0" }}
                confirm="Deactivate? The employee can no longer sign in and the ID card will show as inactive." />
            </div>
          )}
        </div>
      )}

      {hr && status === "inactive" && (
        <div className="card">
          <h2>Inactive</h2>
          <ActionForm action={setActive} submitLabel="Reactivate" hidden={{ id, active: "1" }} />
        </div>
      )}

      {/* ---------- Details ---------- */}
      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Personal</h2>
          <KV rows={[
            ["Date of birth", emp.date_of_birth ? fmtDate(emp.date_of_birth) : null],
            ["Gender", emp.gender], ["Blood group", emp.blood_group], ["Marital status", pers.marital_status],
            ["Father / spouse", pers.father_name], ["Mobile", emp.mobile], ["Email", emp.email], ["Personal email", pers.personal_email],
            ["Permanent address", pers.permanent_address], ["Present address", pers.present_address],
            ["Emergency contacts", pers.emergency_contacts?.map((c) => `${c.name} (${c.relation}) ${c.phone}`).join("; ")],
          ]} />
        </div>
        <div className="card">
          <h2>Bank &amp; statutory</h2>
          {priv ? (
            <KV rows={[
              ["PAN", priv.pan], ["Aadhaar", priv.aadhaar_last4 ? `XXXX XXXX ${priv.aadhaar_last4}` : null],
              ["UAN", priv.uan], ["Previous PF no.", priv.previous_pf_no], ["ESI IP no.", priv.esi_ip_no],
              ["Bank", [priv.bank_name, priv.bank_branch].filter(Boolean).join(", ")], ["Account holder", priv.account_holder],
              ["Account no.", hr ? priv.account_number : mask(priv.account_number)], ["IFSC", priv.ifsc],
              ["Tax regime", priv.tax_regime === "old" ? "Old regime" : "New regime"],
            ]} />
          ) : <p className="muted">{hr || hasRole(session.user, ["payroll"]) ? "Not filled in yet." : "Visible to HR and payroll only."}</p>}
        </div>
        <div className="card">
          <h2>Family &amp; nominees</h2>
          <KV rows={[
            ["Family", profile.family?.members?.map((m) => `${m.name} (${m.relation})`).join(", ")],
            ["Nominees", profile.family?.nominees?.map((n) => `${n.name} (${n.relation}) ${n.share}% – ${n.for}`).join("; ")],
          ]} />
        </div>
        <div className="card">
          <h2>Education &amp; experience</h2>
          <KV rows={[
            ["Education", profile.academic?.education?.map((e) => `${e.qualification}, ${e.institute} (${e.year}${e.score ? `, ${e.score}` : ""})`).join("; ")],
            ["Certifications", profile.academic?.certifications],
            ["Experience", profile.professional?.total_experience_years ? `${profile.professional.total_experience_years} years` : null],
            ["Employers", profile.professional?.employers?.map((x) => `${x.designation}, ${x.company} (${x.from} – ${x.to})`).join("; ")],
            ["References", profile.professional?.references?.map((r) => `${r.name}, ${r.company} – ${r.phone}`).join("; ")],
          ]} />
        </div>
      </div>

      {hr && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Documents</h2>
          {docs?.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>{DOCUMENT_TYPES.find((t) => t.key === d.doc_type)?.label ?? (d.doc_type === "selfie" ? "Selfie" : d.doc_type)}</td>
                      <td>{urls[d.file_path] ? <a href={urls[d.file_path]} target="_blank" rel="noreferrer">{d.file_name || "View"}</a> : d.file_name}</td>
                      <td>{fmtDateTime(d.uploaded_at)}</td>
                      <td><span className={`badge ${d.status === "approved" ? "ok" : d.status === "rejected" ? "danger" : ""}`}>{d.status}</span></td>
                      <td>
                        <form action={setDocumentStatus} className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                          <input type="hidden" name="doc_id" value={d.id} />
                          <button className="btn ghost small" name="status" value="approved" title="Mark verified"><Icon name="check" size={16} /></button>
                          <button className="btn ghost small" name="status" value="rejected" title="Reject"><Icon name="x" size={16} /></button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No documents uploaded yet.</p>}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Links expire after 15 minutes. Document views are private to HR.</p>
        </div>
      )}

      {(emp.status === "active" || emp.status === "inactive") && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>
            <span>Attendance</span>
            <a className="btn secondary small" href={p(`/app/attendance/employee/${id}`)}>View attendance</a>
          </h2>
          {hr && shiftList ? (
            <ActionForm action={saveEmployeeAttendance} submitLabel="Save attendance settings" className="formgrid" hidden={{ id }}>
              <label className="field">Device ID<input name="attendance_id" defaultValue={emp.attendance_id ?? ""} placeholder={emp.employee_code ?? "e.g. 101"} maxLength={30} /><span className="help">User / enrol number on the biometric device. Empty = employee code.</span></label>
              <label className="field">Shift
                <select name="shift_id" defaultValue={emp.shift_id ?? ""}>
                  <option value="">Detect from punches (rotating shifts)</option>
                  {shiftList.map((sh) => <option key={sh.id} value={sh.id}>{sh.code} — {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})</option>)}
                </select>
              </label>
              <div className="field full">Weekly off
                <div className="row" style={{ fontWeight: 400 }}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <label key={d} className="check" style={{ alignItems: "center" }}><input type="checkbox" name="weekly_offs" value={i} defaultChecked={(emp.weekly_offs ?? [0]).includes(i)} /> {d}</label>
                  ))}
                </div>
              </div>
            </ActionForm>
          ) : <p className="muted">Device ID {emp.attendance_id ?? emp.employee_code ?? "not set"}.</p>}
        </div>
      )}

      {hr && masters && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Job details</h2>
          <ActionForm action={updateJobDetails} submitLabel="Save job details" hidden={{ id }}>
            <EmployeeFields masters={masters} excludeId={id} v={{ ...emp }} />
          </ActionForm>
          {mgr && <p className="muted" style={{ marginTop: 10 }}>Reports to <a href={p(`/app/employees/${mgr.id}`)}>{fullName(mgr)}</a></p>}
        </div>
      )}

      {hr && (activity?.length ?? 0) > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Activity</h2>
          <ul className="timeline">
            {activity!.map((a) => <li key={a.id}><span>{a.action.replace(/[._]/g, " ")}</span><small>{fmtDateTime(a.created_at)}</small></li>)}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
