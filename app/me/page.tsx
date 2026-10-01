import { p } from "@/lib/base-path";
import { redirect } from "next/navigation";
import { requireSession, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedDocUrls } from "@/lib/storage";
import { currentOrigin, logoUrl } from "@/lib/tenant";
import { AppShell } from "@/components/AppShell";
import { IdCardPreview } from "@/components/IdCardPreview";
import { Avatar, fullName, fmtDate, one } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { DOCUMENT_TYPES, type OnboardingProfile } from "@/lib/types";
import { istToday, monthBounds } from "@/lib/attendance/time";

export const metadata = { title: "My portal" };

export default async function MyPortal() {
  const session = await requireSession();
  if (session.user.must_change_password) redirect("/account?first=1");
  if (!session.user.employee_id) { const h = homeFor(session.user); redirect(h === "/me" ? "/account" : h); }
  const supabase = await createClient();
  const id = session.user.employee_id;

  // Row-level security limits every query here to the employee's own records.
  const [{ data: emp }, { data: priv }, { data: docs }, { data: card }] = await Promise.all([
    supabase.from("employees").select("*, designation:designations(name), department:departments(name), plant:plants(name)").eq("id", id).single(),
    supabase.from("employee_private").select("pan,aadhaar_last4,uan,esi_ip_no,bank_name,bank_branch,account_number,ifsc,tax_regime").eq("employee_id", id).maybeSingle(),
    supabase.from("employee_documents").select("id,doc_type,file_name,file_path,status,uploaded_at").eq("employee_id", id).order("uploaded_at"),
    supabase.from("id_cards").select("valid_until,issued_at").eq("employee_id", id).eq("status", "active").maybeSingle(),
  ]);
  if (!emp) redirect("/login");

  // "Live salary": what has been earned so far this month from attendance (own salary and attendance only)
  const today = istToday(), mb = monthBounds(today.slice(0, 7));
  const [{ data: sal }, { data: att }] = await Promise.all([
    supabase.from("salary_structures").select("monthly_gross,effective_from").eq("employee_id", id).lte("effective_from", today).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("attendance_days").select("work_date,absent_days").eq("employee_id", id).gte("work_date", mb.from).lte("work_date", today),
  ]);
  let live: { earned: number; paid: number; upto: number; total: number } | null = null;
  if (sal) {
    const seen = new Set((att ?? []).map((a) => a.work_date));
    const upto = mb.days.filter((d) => d <= today && (!emp.date_of_joining || d >= emp.date_of_joining));
    const lop = (att ?? []).reduce((s, a) => s + Number(a.absent_days), 0) + upto.filter((d) => d < today && !seen.has(d)).length;
    const paid = Math.max(0, upto.length - lop);
    live = { earned: Math.round((Number(sal.monthly_gross) * paid) / mb.days.length), paid, upto: upto.length, total: Number(sal.monthly_gross) };
  }

  // notices and surveys waiting for this person (row-level security: only those meant for him)
  const [{ data: annsDue }, { data: myReads }, { data: openSurveys }, { data: answeredS }, { data: polDocs }, { data: polAcks }] = await Promise.all([
    supabase.from("announcements").select("id,needs_ack,expires_on").eq("status", "published").limit(100),
    supabase.from("announcement_reads").select("announcement_id,acknowledged_at").eq("employee_id", id),
    supabase.from("surveys").select("id,opens_on,closes_on").eq("status", "open"),
    supabase.from("survey_participants").select("survey_id").eq("employee_id", id),
    supabase.from("documents").select("id,document_versions(id,status)").eq("employee_access", true).eq("needs_ack", true),
    supabase.from("document_acks").select("version_id").eq("employee_id", id),
  ]);
  const ackedV = new Set((polAcks ?? []).map((a) => a.version_id));
  const policiesDue = (polDocs ?? []).filter((d) => (d.document_versions as { id: string; status: string }[]).some((v) => v.status === "approved" && !ackedV.has(v.id))).length;
  const readMap = new Map((myReads ?? []).map((r) => [r.announcement_id, r]));
  const newNotices = (annsDue ?? []).filter((a) => !(a.expires_on && a.expires_on < today) && (a.needs_ack ? !readMap.get(a.id)?.acknowledged_at : !readMap.has(a.id)));
  const toAck = newNotices.filter((a) => a.needs_ack).length;
  const surveysDue = (openSurveys ?? []).filter((s) => (!s.opens_on || s.opens_on <= today) && (!s.closes_on || s.closes_on >= today) && !(answeredS ?? []).some((x) => x.survey_id === s.id)).length;

  const urls = await signedDocUrls([emp.photo_path, ...(docs ?? []).map((d) => d.file_path)].filter(Boolean) as string[], 900);
  const name = fullName(emp);
  const des = one(emp.designation)?.name;
  const dep = one(emp.department)?.name;
  const plant = one(emp.plant)?.name;
  // manager's name via a security-definer lookup would widen access; the employee can only read their own row,
  // so fetch the name with the service client (name only).
  const { data: mgr } = emp.reporting_manager_id
    ? await createAdminClient().from("employees").select("first_name,last_name").eq("id", emp.reporting_manager_id).eq("tenant_id", session.tenant.id).maybeSingle()
    : { data: null };
  const pers = (emp.profile as OnboardingProfile).personal ?? {};
  const origin = await currentOrigin();
  const tenure = emp.date_of_joining ? Math.max(0, Math.floor((Date.now() - new Date(emp.date_of_joining).getTime()) / (365.25 * 864e5) * 10) / 10) : null;

  return (
    <AppShell session={session} active="/me">
      <div className="pagehead">
        <div className="namecell">
          <Avatar name={name} src={emp.photo_path ? urls[emp.photo_path] : null} size="lg" />
          <div>
            <h1 style={{ marginBottom: 2 }}>{name}</h1>
            <div className="muted"><span className="mono">{emp.employee_code}</span> · {[des, dep].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </div>

      {policiesDue > 0 && (
        <a className="alert warn" href={p("/me/policies")} style={{ display: "block", marginBottom: 12, textDecoration: "none" }}>
          <b>{policiesDue} polic{policiesDue === 1 ? "y" : "ies"}</b> to read and acknowledge. Open ›
        </a>
      )}
      {(newNotices.length > 0 || surveysDue > 0) && (
        <a className="alert info" href={p("/me/engage")} style={{ display: "block", marginBottom: 16, textDecoration: "none" }}>
          {newNotices.length > 0 && <><b>{newNotices.length} new notice{newNotices.length === 1 ? "" : "s"}</b>{toAck ? ` (${toAck} to acknowledge)` : ""}. </>}
          {surveysDue > 0 && <><b>{surveysDue} survey{surveysDue === 1 ? "" : "s"}</b> waiting for your opinion. </>}Open ›
        </a>
      )}

      {live && (
        <div className="card stat" style={{ marginBottom: 16 }}>
          <div className="spread"><div className="label">Salary earned so far this month</div><a className="btn secondary small" href={p("/me/payslips")}>My payslips</a></div>
          <div className="value">₹{live.earned.toLocaleString("en-IN")}</div>
          <div className="hint">{live.paid} paid day{live.paid === 1 ? "" : "s"} of {live.upto} so far · monthly gross ₹{live.total.toLocaleString("en-IN")} · before PF, ESI and other deductions</div>
        </div>
      )}
      <div className="grid three">
        <div className="card stat"><div className="label">Date of joining</div><div className="value" style={{ fontSize: "1.25rem" }}>{fmtDate(emp.date_of_joining)}</div><div className="hint">{emp.date_of_joining && new Date(emp.date_of_joining) > new Date() ? "Joining soon" : tenure !== null ? `${tenure} years of service` : ""}</div></div>
        <div className="card stat"><div className="label">Reporting manager</div><div className="value" style={{ fontSize: "1.25rem" }}>{mgr ? fullName(mgr) : "—"}</div><div className="hint">{plant ?? ""}</div></div>
        <div className="card stat"><div className="label">Employment</div><div className="value" style={{ fontSize: "1.25rem", textTransform: "capitalize" }}>{emp.employment_type.replace("_", " ")}</div><div className="hint" style={{ textTransform: "capitalize" }}>{emp.category}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>My ID card <a className="btn secondary small" href={p("/api/id-cards?me=1")} target="_blank"><Icon name="download" /> Download PDF</a></h2>
        <IdCardPreview
          company={session.tenant.legal_name || session.tenant.name} logoUrl={logoUrl(session.tenant)} photoUrl={emp.photo_path ? urls[emp.photo_path] : null}
          name={name} code={emp.employee_code ?? ""} designation={des} department={dep} bloodGroup={emp.blood_group}
          emergencyName={emp.emergency_contact_name} emergencyPhone={emp.emergency_contact_phone}
          verifyUrl={`${origin}/v/${emp.verify_token}`} address={session.tenant.address} validUntil={card?.valid_until ? fmtDate(card.valid_until) : null}
        />
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Personal details</h2>
          <dl className="kv">
            <dt>Date of birth</dt><dd>{fmtDate(emp.date_of_birth)}</dd>
            <dt>Blood group</dt><dd>{emp.blood_group ?? "—"}</dd>
            <dt>Mobile</dt><dd>{emp.mobile ?? "—"}</dd>
            <dt>Email</dt><dd>{emp.email ?? "—"}</dd>
            <dt>Address</dt><dd>{pers.present_address ?? "—"}</dd>
            <dt>Emergency contact</dt><dd>{emp.emergency_contact_name ?? "—"} {emp.emergency_contact_phone ?? ""}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Bank &amp; PF</h2>
          {priv ? (
            <dl className="kv">
              <dt>Bank</dt><dd>{[priv.bank_name, priv.bank_branch].filter(Boolean).join(", ")}</dd>
              <dt>Account</dt><dd className="mono">{priv.account_number ? `XXXX${priv.account_number.slice(-4)}` : "—"}</dd>
              <dt>IFSC</dt><dd className="mono">{priv.ifsc}</dd>
              <dt>PAN</dt><dd className="mono">{priv.pan ? `${priv.pan.slice(0, 2)}XXXXX${priv.pan.slice(-3)}` : "—"}</dd>
              <dt>Aadhaar</dt><dd className="mono">{priv.aadhaar_last4 ? `XXXX XXXX ${priv.aadhaar_last4}` : "—"}</dd>
              <dt>UAN</dt><dd className="mono">{priv.uan ?? "Will be linked by HR"}</dd>
              <dt>Tax regime</dt><dd>{priv.tax_regime === "old" ? "Old" : "New"}</dd>
            </dl>
          ) : <p className="muted">Not available.</p>}
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>To change bank or personal details, please contact HR.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>My documents</h2>
        {docs?.length ? (
          <div className="doclist">
            {docs.filter((d) => d.doc_type !== "selfie").map((d) => (
              <div className="docrow" key={d.id}>
                <span><b>{DOCUMENT_TYPES.find((t) => t.key === d.doc_type)?.label ?? d.doc_type}</b><br /><small>{d.file_name}</small></span>
                <span className="row">
                  <span className={`badge ${d.status === "approved" ? "ok" : d.status === "rejected" ? "danger" : ""}`}>{d.status === "approved" ? "verified" : d.status}</span>
                  {urls[d.file_path] && <a className="btn secondary small" href={urls[d.file_path]} target="_blank" rel="noreferrer">View</a>}
                </span>
              </div>
            ))}
          </div>
        ) : <p className="muted">No documents.</p>}
      </div>

      <div className="alert info" style={{ marginTop: 16 }}>
        Attendance, live salary, leave and payslips will appear here when your company switches on those modules.
      </div>
    </AppShell>
  );
}
