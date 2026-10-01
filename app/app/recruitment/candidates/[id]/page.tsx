import { notFound } from "next/navigation";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fmtDateTime, fullName } from "@/components/ui";
import { p } from "@/lib/base-path";
import { inr } from "@/lib/payroll/compute";
import { fmtWhen, lakh, modeLabel, toLocal } from "@/lib/recruit/format";
import { recruitSettings, RECO_LABEL } from "@/lib/recruit/service";
import type { Breakup } from "@/lib/recruit/offer";
import type { ScorePart } from "@/lib/recruit/score";
import { decide, saveOffer, scheduleInterview, sendOffer, setInterviewStatus, updateCandidate, withdrawOffer } from "../../actions";
import { RecruitTabs, ScoreBar, RecoBadge, AppStatus, MasterSelect } from "../../ui";
import { masters } from "../../data";

export const metadata = { title: "Candidate" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const RECO_IV: Record<string, string> = { strong_hire: "Strong hire", hire: "Hire", hold: "Hold", no_hire: "No hire" };

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { id } = await params;
  const db = await createClient();
  const { data: a } = await db.from("applications").select("*, candidate:candidates(*), requisition:requisitions(id,ref_no,title,designation_id,department_id,plant_id,status,location)").eq("id", id).maybeSingle();
  if (!a) notFound();
  const c = one(a.candidate as Record<string, any>)!;                   // eslint-disable-line @typescript-eslint/no-explicit-any
  const req = one(a.requisition as { id: string; ref_no: string; title: string; designation_id: string | null; department_id: string | null; plant_id: string | null; status: string; location: string | null })!;
  const [{ data: ivs }, { data: offers }, { data: others }, m, st, { data: people }, { data: managers }] = await Promise.all([
    db.from("interviews").select("*, feedback:interview_feedback(*)").eq("application_id", id).order("starts_at"),
    db.from("offers").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    db.from("applications").select("id,status,score,requisition:requisitions(title,ref_no)").eq("candidate_id", c.id).neq("id", id),
    masters(db), recruitSettings(db, session.tenant.id),
    createAdminClient().from("app_users").select("id,full_name,role").eq("tenant_id", session.tenant.id).eq("active", true).in("role", ["company_admin", "hr_manager", "hr_executive", "manager", "interviewer"]).order("full_name"),
    db.from("employees").select("id,first_name,last_name").eq("status", "active").order("first_name").limit(500),
  ]);
  const parts = (a.breakdown ?? []) as ScorePart[], evidence = (a.evidence ?? []) as { competency: string; line: string }[];
  const offer = (offers ?? [])[0] ?? null, draft = offer && ["draft", "sent"].includes(offer.status) ? offer : null;
  const bk = (draft?.breakup ?? null) as Breakup | null;
  const canInterview = !["declined", "joined", "withdrawn"].includes(a.status);
  const canOffer = ["selected", "offered"].includes(a.status) || !!draft;

  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>{c.full_name}</h1>
        <p>For <a href={p(`/app/recruitment/requisitions/${req.id}`)}>{req.title}</a> <span className="mono muted">{req.ref_no}</span> · <AppStatus status={a.status} /> · applied {fmtDate(a.created_at)}{a.source ? ` (${({ upload: "resume upload", careers: "careers page", referral: "referral", manual: "added by HR" } as Record<string, string>)[a.source] ?? a.source})` : ""}</p></div>
        {c.resume_path && <a className="btn secondary" target="_blank" rel="noreferrer" href={p(`/api/recruitment/resume/${c.id}`)}>Open the resume</a>}</div>
      <RecruitTabs active="cands" />

      <div className="grid two">
        <div className="card">
          <h2>Match score <span className="toolbar" style={{ margin: 0 }}><ScoreBar score={a.score} /><RecoBadge reco={a.recommendation} /></span></h2>
          {!parts.length ? <Empty>Not scored yet.</Empty> : (
            <div className="tablewrap" style={{ border: 0 }}><table>
              <tbody>{parts.map((x) => <tr key={x.key}><td>{x.label}<div className="muted" style={{ fontSize: 12 }}>{x.note}</div></td><td className="num"><b>{x.points}</b> / {x.max}</td></tr>)}</tbody>
            </table></div>)}
          {(a.flags as string[])?.length ? <div className="alert error" style={{ marginTop: 10 }}>{(a.flags as string[]).map((f) => <div key={f}>⚠ {f}</div>)}</div> : null}
          {evidence.length > 0 && <><h3 style={{ marginTop: 16 }}>Evidence from the resume</h3>
            <ul className="evidence">{evidence.map((e, i) => <li key={i}><small>{e.competency}</small>{e.line}</li>)}</ul></>}
          {c.parse_status === "scanned" && <p className="muted">This resume is a scan or photo with no text inside — type the key facts in “Candidate details” and the score is worked out from them.</p>}
        </div>

        <div className="card">
          <h2>Decision</h2>
          {a.decision_at && <p className="muted" style={{ marginTop: 0 }}>Last decision {fmtDateTime(a.decision_at)}{a.decision_reason ? ` — “${a.decision_reason}”` : ""}{a.overridden ? " (differs from the recommendation)" : ""}</p>}
          {a.status === "declined" && a.regret_due && <p className="muted">{a.regret_sent_at ? `Regret message sent ${fmtDateTime(a.regret_sent_at)}.` : `A courteous regret message goes out on ${fmtDate(a.regret_due)}.`}</p>}
          {!["offered", "joined"].includes(a.status) ? (
            <ActionForm action={decide} submitLabel="Save decision" className="formgrid" hidden={{ application_id: a.id }}>
              <label className="field full">Decision<select name="decision" defaultValue={a.status === "new" ? (a.recommendation === "suitable" ? "shortlist" : a.recommendation === "hold" ? "hold" : "decline") : ""} required>
                <option value="" disabled>Choose…</option>
                <option value="shortlist">Shortlist — call for interview</option><option value="hold">Keep on hold</option>
                <option value="select">Select — make an offer</option><option value="decline">Decline</option>{a.status !== "new" && <option value="reopen">Back to “new”</option>}
              </select><span className="help">Recommendation: {a.recommendation ? RECO_LABEL[a.recommendation] : "—"}. You can always decide otherwise — give a reason.</span></label>
              <label className="field full">Reason (kept in the record)<input name="reason" maxLength={500} placeholder="e.g. Strong 8D experience; notice can be bought out" /></label>
            </ActionForm>) : <p>The offer is with the candidate — see below.</p>}
          {(others ?? []).length > 0 && <><h3 style={{ marginTop: 16 }}>Also applied for</h3><ul className="timeline">{(others ?? []).map((o) => { const rq = one(o.requisition as unknown as { title: string; ref_no: string }); return <li key={o.id}><a href={p(`/app/recruitment/candidates/${o.id}`)}>{rq?.title}</a><span><ScoreBar score={o.score} /> <AppStatus status={o.status} /></span></li>; })}</ul></>}
        </div>
      </div>

      <div className="card">
        <h2>Candidate details</h2>
        <ActionForm action={updateCandidate} submitLabel="Save and score again" className="formgrid" hidden={{ candidate_id: c.id, application_id: a.id }}>
          <label className="field">Name<input name="full_name" defaultValue={c.full_name} required /></label>
          <label className="field">Mobile<input name="phone" defaultValue={c.phone ?? ""} inputMode="tel" /></label>
          <label className="field">E-mail<input name="email" type="email" defaultValue={c.email ?? ""} /></label>
          <label className="field">Location<input name="location" defaultValue={c.location ?? ""} /></label>
          <label className="field">Current company<input name="current_company" defaultValue={c.current_company ?? ""} /></label>
          <label className="field">Current designation<input name="current_designation" defaultValue={c.current_designation ?? ""} /></label>
          <label className="field">Total experience (years)<input name="total_exp" inputMode="decimal" defaultValue={c.total_exp ?? ""} /></label>
          <label className="field">Notice period (days)<input name="notice_days" inputMode="numeric" defaultValue={c.notice_days ?? ""} /></label>
          <label className="field">Current salary (lakhs a year)<input name="current_ctc" inputMode="decimal" defaultValue={c.current_ctc != null ? c.current_ctc / 1e5 : ""} /></label>
          <label className="field">Expected salary (lakhs a year)<input name="expected_ctc" inputMode="decimal" defaultValue={c.expected_ctc != null ? c.expected_ctc / 1e5 : ""} /></label>
          <label className="field">Education<input name="education" defaultValue={c.education ?? ""} /></label>
          <label className="field full">Competencies seen (comma-separated)<input name="skills" defaultValue={(c.skills ?? []).join(", ")} />
            <span className="help">{c.resume_text ? "Found in the resume. The score reads the resume itself." : "No resume text: type what the candidate has done (e.g. 8D, PPAP, CNC programming) — the score uses this."}</span></label>
        </ActionForm>
      </div>

      <div className="card">
        <h2>Interviews</h2>
        {!(ivs ?? []).length ? <Empty>No interview yet.</Empty> : (ivs ?? []).map((i) => {
          const fb = (i.feedback ?? []) as { panelist_name: string; overall: number; recommendation: string; strengths: string | null; concerns: string | null }[];
          const avg = fb.length ? Math.round((fb.reduce((s, f) => s + f.overall, 0) / fb.length) * 10) / 10 : null;
          const split = fb.length > 1 && (Math.max(...fb.map((f) => f.overall)) - Math.min(...fb.map((f) => f.overall)) >= 2 || (fb.some((f) => /hire/.test(f.recommendation) && f.recommendation !== "no_hire") && fb.some((f) => f.recommendation === "no_hire")));
          return (
            <div key={i.id} className="card" style={{ background: "var(--surface-2)" }}>
              <div className="spread"><div><b>Round {i.round} — {i.title}</b> · {fmtWhen(i.starts_at)} · {modeLabel(i.mode)}
                <div className="muted" style={{ fontSize: 13 }}>{i.mode === "video" ? i.video_link : i.venue} · panel: {(i.panel_names as string[]).join(", ")}</div>
                {i.candidate_note && <div style={{ fontSize: 13, color: "var(--warn)" }}>Candidate: “{i.candidate_note}”</div>}</div>
                <span className={`badge ${i.status === "confirmed" || i.status === "done" ? "ok" : i.status === "reschedule_requested" || i.status === "no_show" ? "warn" : i.status === "cancelled" ? "danger" : "info"}`}>
                  {({ scheduled: "Scheduled", confirmed: "Candidate confirmed", reschedule_requested: "Asked for another time", done: "Held", cancelled: "Cancelled", no_show: "Did not come" } as Record<string, string>)[i.status]}</span></div>
              {fb.length > 0 && <div style={{ marginTop: 8 }}>
                <b>Scorecards: {fb.length} · average {avg} / 5</b>{split && <span className="badge warn" style={{ marginLeft: 8 }}>Panel disagrees — discuss before deciding</span>}
                <ul className="timeline">{fb.map((f) => <li key={f.panelist_name}><span><b>{f.panelist_name}</b>{f.strengths ? ` — + ${f.strengths}` : ""}{f.concerns ? ` — − ${f.concerns}` : ""}</span><span>{f.overall}/5 · {RECO_IV[f.recommendation]}</span></li>)}</ul></div>}
              <div className="toolbar" style={{ marginTop: 8 }}>
                <a className="btn small secondary" href={p(`/app/recruitment/interviews/${i.id}`)}>Scorecards</a>
                {["scheduled", "confirmed", "reschedule_requested"].includes(i.status) && <>
                  <ActionForm action={setInterviewStatus} submitLabel="Mark as held" variant="secondary" hidden={{ id: i.id, to: "done" }} />
                  <ActionForm action={setInterviewStatus} submitLabel="Did not come" variant="secondary" hidden={{ id: i.id, to: "no_show" }} />
                  <ActionForm action={setInterviewStatus} submitLabel="Cancel" variant="danger" hidden={{ id: i.id, to: "cancelled" }} confirm="Cancel this interview? (Tell the candidate yourself.)" /></>}
              </div>
            </div>);
        })}
        {canInterview && <details style={{ marginTop: 12 }} open={["shortlisted"].includes(a.status) && !(ivs ?? []).length}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Schedule {(ivs ?? []).length ? "the next round" : "an interview"}</summary>
          <ActionForm action={scheduleInterview} submitLabel="Schedule and send the invitations" className="formgrid" hidden={{ application_id: a.id }}>
            <label className="field">Round name<input name="title" defaultValue={(ivs ?? []).length ? "HR interview" : "Technical interview"} maxLength={80} /></label>
            <label className="field">Date and time (IST)<input type="datetime-local" name="starts_at" required defaultValue={toLocal(new Date(Date.now() + 2 * 864e5)).slice(0, 11) + "10:30"} /></label>
            <label className="field">Duration (minutes)<input name="duration_min" type="number" min={10} max={480} defaultValue={45} /></label>
            <label className="field">Mode<select name="mode" defaultValue="in_person"><option value="in_person">In person</option><option value="video">Video call</option><option value="phone">Phone call</option></select></label>
            <label className="field full">Venue (for in person)<input name="venue" maxLength={300} defaultValue={req.location ? `${session.tenant.name}, ${req.location}` : session.tenant.address ?? ""} /></label>
            <label className="field full">Video link (for a video call)<input name="video_link" maxLength={500} placeholder="https://meet.google.com/…" /></label>
            <label className="field full">Please bring<input name="bring" maxLength={500} defaultValue="Updated resume, photo ID, certificates and last 3 payslips" /></label>
            <fieldset className="field full" style={{ border: 0, padding: 0 }}><legend style={{ fontWeight: 600, fontSize: 13.5 }}>Panel</legend>
              <div className="toolbar">{(people ?? []).map((u) => <label key={u.id} className="check"><input type="checkbox" name="panel" value={u.id} defaultChecked={u.id === session.user.id} /> {u.full_name}</label>)}</div>
              <span className="help">Panel members get an e-mail with a calendar invite and fill in a scorecard after the interview. Add interviewers in KMR Apps › Users &amp; access (HRM role “Interviewer”).</span></fieldset>
            <label className="check full"><input type="checkbox" name="notify" defaultChecked /> Send the invitation to the candidate (e-mail + WhatsApp) and the panel</label>
          </ActionForm></details>}
      </div>

      {(canOffer || (offers ?? []).length > 0) && <div className="card">
        <h2>Offer {offer && <span className={`badge ${offer.status === "accepted" ? "ok" : offer.status === "sent" ? "info" : offer.status === "draft" ? "warn" : "danger"}`}>{({ draft: "Draft", sent: "With the candidate", accepted: "Accepted", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn" } as Record<string, string>)[offer.status]}</span>}</h2>
        {offer && <div className="stack">
          <p style={{ margin: 0 }}><b className="mono">{offer.ref_no}</b> · CTC <b>Rs. {inr(offer.annual_ctc)}</b> a year · gross Rs. {inr(offer.monthly_gross)} a month · joining {fmtDate(offer.date_of_joining)}
            {offer.status === "sent" ? ` · valid until ${fmtDate(offer.valid_until)}` : ""}{offer.responded_at ? ` · answered ${fmtDateTime(offer.responded_at)}` : ""}</p>
          {offer.status === "accepted" && <div className="alert ok">Accepted{offer.accepted_name ? ` — signed as “${offer.accepted_name}”` : ""}. {offer.employee_id ? <>The new joiner was created and the self-onboarding link sent. <a href={p(`/app/employees/${offer.employee_id}`)}>Open the employee</a></> : "Add the new joiner under Employees."}</div>}
          {offer.status === "declined" && <div className="alert error">Declined{offer.decline_reason ? `: “${offer.decline_reason}”` : ""}.</div>}
          <div className="toolbar">
            <a className="btn secondary small" target="_blank" rel="noreferrer" href={p(`/api/recruitment/offer/${offer.id}`)}>View the offer letter (PDF)</a>
            {["draft", "sent"].includes(offer.status) && <ActionForm action={sendOffer} submitLabel={offer.status === "sent" ? "Send again (new link)" : "Send the offer"} variant={offer.status === "draft" ? "accent" : "secondary"} hidden={{ id: offer.id }}
              confirm={offer.status === "draft" ? "Send this offer to the candidate by e-mail and WhatsApp?" : "Send the offer again? The earlier link stops working."} />}
            {["draft", "sent"].includes(offer.status) && <ActionForm action={withdrawOffer} submitLabel="Withdraw" variant="danger" hidden={{ id: offer.id }} confirm="Withdraw this offer? The candidate's link stops working." />}
          </div>
          {bk && <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>Salary breakup</summary>
            <div className="tablewrap" style={{ marginTop: 8 }}><table>
              <thead><tr><th>Component</th><th className="num">Monthly</th><th className="num">Yearly</th></tr></thead>
              <tbody>
                {bk.earnings.map((e) => <tr key={e.code}><td>{e.name}</td><td className="num">{inr(e.monthly)}</td><td className="num">{inr(e.annual)}</td></tr>)}
                <tr><td><b>Gross salary</b></td><td className="num"><b>{inr(bk.monthly_gross)}</b></td><td className="num"><b>{inr(bk.monthly_gross * 12)}</b></td></tr>
                {bk.employer.map((e) => <tr key={e.code}><td className="muted">{e.name}</td><td className="num">{inr(e.monthly)}</td><td className="num">{inr(e.annual)}</td></tr>)}
                {bk.gratuity && <tr><td className="muted">Gratuity (4.81% of basic)</td><td className="num">{inr(bk.gratuity.monthly)}</td><td className="num">{inr(bk.gratuity.annual)}</td></tr>}
                <tr><td><b>Cost to company</b></td><td className="num"><b>{inr(bk.ctc_monthly)}</b></td><td className="num"><b>{inr(bk.ctc_annual)}</b></td></tr>
                {bk.deductions.map((d) => <tr key={d.code}><td className="muted">less {d.name}</td><td className="num">{inr(d.monthly)}</td><td className="num">{inr(d.annual)}</td></tr>)}
                <tr><td><b>Take-home (before income tax)</b></td><td className="num"><b>{inr(bk.net_monthly)}</b></td><td className="num"><b>{inr(bk.net_monthly * 12)}</b></td></tr>
              </tbody></table></div></details>}
        </div>}
        {(canOffer && (!offer || offer.status === "draft" || ["withdrawn", "declined", "expired"].includes(offer.status))) && (
          <details open={!offer || offer.status === "draft"} style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>{offer?.status === "draft" ? "Change the draft offer" : "Prepare the offer"}</summary>
            <ActionForm action={saveOffer} submitLabel="Work out the breakup and save the draft" className="formgrid" hidden={{ application_id: a.id }}>
              <MasterSelect name="designation_id" label="Designation" list={m.desigs} value={draft?.designation_id ?? req.designation_id} required />
              <MasterSelect name="department_id" label="Department" list={m.depts} value={draft?.department_id ?? req.department_id} />
              <MasterSelect name="plant_id" label="Plant" list={m.plants} value={draft?.plant_id ?? req.plant_id} />
              <label className="field">Reports to<select name="reporting_manager_id" defaultValue={draft?.reporting_manager_id ?? ""}><option value="">—</option>{(managers ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></label>
              <label className="field">Employment<select name="employment_type" defaultValue={draft?.employment_type ?? "probation"}>{["probation", "permanent", "fixed_term", "trainee", "apprentice", "contract"].map((t) => <option key={t} value={t}>{t.replace("_", " ").replace(/^\w/, (x) => x.toUpperCase())}</option>)}</select></label>
              <label className="field">Category<select name="category" defaultValue={draft?.category ?? "staff"}><option value="staff">Staff</option><option value="workman">Workman</option><option value="management">Management</option></select></label>
              <label className="field">Date of joining<input type="date" name="date_of_joining" required defaultValue={draft?.date_of_joining ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)} /></label>
              <label className="field">Salary given as<select name="basis" defaultValue="ctc"><option value="ctc">Yearly CTC</option><option value="gross">Monthly gross</option></select></label>
              <label className="field">Amount (rupees)<input name="amount" inputMode="numeric" required defaultValue={draft ? String(Math.round(draft.annual_ctc)) : c.expected_ctc ?? ""} placeholder="e.g. 600000" />
                <span className="help">{c.expected_ctc ? `The candidate expects ${lakh(c.expected_ctc)} a year.` : "Yearly CTC, or monthly gross if chosen above."}</span></label>
              <label className="check"><input type="checkbox" name="pf_applicable" defaultChecked={draft ? draft.pf_applicable : true} /> PF applies</label>
              <label className="check"><input type="checkbox" name="include_gratuity" defaultChecked={draft ? draft.include_gratuity : st.gratuity_in_ctc} /> Show gratuity in the CTC</label>
              <label className="field full">Terms in the letter<textarea name="terms" rows={6} defaultValue={draft?.terms ?? st.offer_terms ?? ""} /></label>
            </ActionForm></details>)}
      </div>}
    </AppShell>
  );
}
