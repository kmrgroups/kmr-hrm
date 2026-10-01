import { notFound } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentOrigin } from "@/lib/tenant";
import { AppShell } from "@/components/AppShell";
import { ActionForm, CopyLink } from "@/components/ActionForm";
import { Empty, fmtDate } from "@/components/ui";
import { p } from "@/lib/base-path";
import { lakh } from "@/lib/recruit/format";
import { jdText } from "@/lib/recruit/jd";
import { FAMILIES } from "@/lib/recruit/vocab";
import { REQ_STATUS_LABEL, type JdRow } from "@/lib/recruit/service";
import { approveJd, rescoreAll, saveJd, setPublished, setRequisitionStatus, updateRequisition, writeJd, addCandidate } from "../../actions";
import { RecruitTabs, ReqStatus, ScoreBar, RecoBadge, AppStatus } from "../../ui";
import { RequisitionFields } from "../../forms";
import { masters } from "../../data";
import { ResumeUploader } from "../../ResumeUploader";

export const metadata = { title: "Requisition" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function RequisitionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager", "interviewer"]);
  const hr = hasRole(session.user, ["hr_manager", "hr_executive"]);
  const { id } = await params, { f } = await searchParams;
  const db = await createClient();
  const { data: r } = await db.from("requisitions").select("*, designation:designations(name), department:departments(name), plant:plants(name)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: jd }, { data: apps }, m, origin] = await Promise.all([
    r.jd_id ? db.from("job_descriptions").select("*").eq("id", r.jd_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("applications").select("id,status,score,recommendation,flags,created_at,source,candidate:candidates(full_name,total_exp,notice_days,expected_ctc,location,parse_status)").eq("requisition_id", id).order("score", { ascending: false, nullsFirst: false }),
    masters(db), currentOrigin(),
  ]);
  const j = jd as JdRow | null;
  const editable = hr || (r.raised_by === session.user.id && ["draft", "pending"].includes(r.status));
  const careers = `${origin}/careers/${r.id}`;
  const filter = f && ["new", "shortlisted", "interview", "selected", "declined", "on_hold"].includes(f) ? f : null;
  const list = (apps ?? []).filter((a) => !filter || a.status === filter || (filter === "shortlisted" && a.status === "interview"));
  const counts = (s: string) => (apps ?? []).filter((a) => a.status === s).length;
  const step = (to: string, label: string, variant?: "secondary" | "danger" | "accent", confirm?: string, children?: React.ReactNode) =>
    <ActionForm key={to} action={setRequisitionStatus} submitLabel={label} variant={variant} hidden={{ id: r.id, to }} confirm={confirm} className="stack">{children}</ActionForm>;

  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>{r.title}</h1><p><span className="mono">{r.ref_no}</span> · {r.headcount} post{r.headcount > 1 ? "s" : ""} · raised by {r.raised_by_name ?? "—"} on {fmtDate(r.created_at)} · <ReqStatus status={r.status} published={r.published} /></p></div></div>
      <RecruitTabs active="reqs" hr={hr} />

      {hr && <div className="card">
        <h2>Next step</h2>
        <div className="toolbar" style={{ alignItems: "flex-start" }}>
          {["pending", "draft"].includes(r.status) && step("approved", "Approve the requisition")}
          {["approved", "on_hold", "closed"].includes(r.status) && step("open", r.status === "approved" ? "Open the role" : "Re-open the role", "accent", undefined,
            <label className="check"><input type="checkbox" name="publish" defaultChecked /> Show it on our careers page</label>)}
          {r.status === "open" && <ActionForm action={setPublished} submitLabel={r.published ? "Take off the careers page" : "Show on the careers page"} variant="secondary" hidden={{ id: r.id, on: r.published ? "0" : "1" }} />}
          {["open", "approved"].includes(r.status) && step("on_hold", "Put on hold", "secondary")}
          {["open", "on_hold", "approved"].includes(r.status) && step("closed", "Close (filled)", "secondary", "Close this requisition? It leaves the careers page; candidates are kept.")}
          {["draft", "pending", "approved", "on_hold"].includes(r.status) && step("cancelled", "Cancel", "danger", "Cancel this requisition?")}
        </div>
        {r.status === "approved" && j?.status !== "approved" && <p className="muted">Approve the job description below first — candidates are scored against it.</p>}
        {r.status === "open" && <>
          <p className="muted" style={{ marginBottom: 6 }}>{r.published ? "Share the apply link — on WhatsApp, in a newspaper ad or on Naukri / LinkedIn / Indeed:" : "This role is open but not on the careers page. You can still share the apply link:"}</p>
          <CopyLink link={careers} />
          <a className="btn secondary small" style={{ marginTop: 8 }} target="_blank" rel="noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(`We are hiring: ${r.title}${r.location ? `, ${r.location}` : ""}. Apply here: ${careers}`)}`}>Share on WhatsApp</a>
        </>}
      </div>}

      <div className="grid two">
        <div className="card">
          <h2>Requisition</h2>
          <dl className="kv">
            <dt>Status</dt><dd>{REQ_STATUS_LABEL[r.status]}</dd>
            <dt>Designation</dt><dd>{one(r.designation as { name: string } | null)?.name ?? "—"}</dd>
            <dt>Department</dt><dd>{one(r.department as { name: string } | null)?.name ?? "—"}</dd>
            <dt>Plant / location</dt><dd>{[one(r.plant as { name: string } | null)?.name, r.location].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Experience</dt><dd>{r.exp_min ?? "?"} – {r.exp_max ?? "?"} years</dd>
            <dt>Salary budget</dt><dd>{r.ctc_max ? `${lakh(r.ctc_min)} – ${lakh(r.ctc_max)} a year` : "—"}</dd>
            <dt>Notice accepted</dt><dd>{r.notice_max_days != null ? `up to ${r.notice_max_days} days` : "—"}</dd>
            <dt>Needed by</dt><dd>{r.required_by ? fmtDate(r.required_by) : "—"}</dd>
            <dt>Reason</dt><dd>{{ new: "New position", replacement: `Replacement${r.replacement_for ? ` for ${r.replacement_for}` : ""}`, project: "Project / temporary" }[r.reason as string]}</dd>
            {r.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{r.notes}</dd></>}
          </dl>
          {editable && <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>Change the requisition</summary>
            <ActionForm action={updateRequisition} submitLabel="Save" className="formgrid" hidden={{ id: r.id }}>
              <RequisitionFields d={r} desigs={m.desigs} depts={m.depts} plants={m.plants} />
            </ActionForm></details>}
        </div>

        <div className="card">
          <h2>Job description {j && <span className={`badge ${j.status === "approved" ? "ok" : "warn"}`}>{j.status === "approved" ? `Approved · v${j.version}` : `Draft · v${j.version}`}</span>}</h2>
          {!j ? (hr ? <>
            <p className="muted">The system writes a complete JD from this requisition — purpose, responsibilities, KPIs, must-have competencies and qualification. You edit and approve it.</p>
            <ActionForm action={writeJd} submitLabel="Write the JD" hidden={{ requisition_id: r.id }} className="formgrid">
              <label className="field">Kind of role<select name="family" defaultValue=""><option value="">Work it out from the title</option>{FAMILIES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
            </ActionForm></> : <Empty>HR will write the job description.</Empty>) : (
            <div className="stack">
              <p style={{ margin: 0 }}>{j.purpose}</p>
              <div><b>Must-have</b><div className="toolbar" style={{ margin: "6px 0 0" }}>{j.must_have.map((c) => <span key={c.name} className="chip">{c.name}{c.weight > 1 ? ` ×${c.weight}` : ""}</span>)}</div></div>
              {hr && <>
                {j.status !== "approved" && <ActionForm action={approveJd} submitLabel="Approve this JD" variant="accent" hidden={{ id: j.id, requisition_id: r.id }} />}
                <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit the JD</summary>
                  <ActionForm action={saveJd} submitLabel={j.status === "approved" ? "Save as a new version" : "Save"} className="formgrid" hidden={{ id: j.id, requisition_id: r.id }}>
                    <label className="field full">Title<input name="title" defaultValue={j.title} maxLength={120} /></label>
                    <label className="field full">Purpose of the role<textarea name="purpose" rows={3} defaultValue={j.purpose ?? ""} /></label>
                    <label className="field full">Responsibilities (one per line)<textarea name="responsibilities" rows={7} defaultValue={j.responsibilities.join("\n")} /></label>
                    <label className="field full">Must-have competencies (one per line; add “| 3” for very important, “| 1” for less)<textarea name="must_have" rows={5} defaultValue={j.must_have.map((c) => `${c.name} | ${c.weight}`).join("\n")} />
                      <span className="help">The match score is built on these. Names from the list below are recognised in resumes with their everyday words (e.g. “reduced rejection” = Quality improvement).</span></label>
                    <label className="field full">Good to have (one per line)<textarea name="good_to_have" rows={3} defaultValue={j.good_to_have.map((c) => c.name).join("\n")} /></label>
                    <label className="field full">KPIs — how success is measured (one per line)<textarea name="kpis" rows={4} defaultValue={j.kpis.join("\n")} /></label>
                    <label className="field full">Results the role must deliver (one per line)<textarea name="outcomes" rows={2} defaultValue={j.outcomes.join("\n")} /></label>
                    <label className="field">Qualification<input name="qualifications" defaultValue={j.qualifications ?? ""} /></label>
                    <label className="field">Experience<input name="experience" defaultValue={j.experience ?? ""} /></label>
                    <label className="field">Reports to<input name="reporting_to" defaultValue={j.reporting_to ?? ""} /></label>
                    <label className="field">Operating context<input name="context" defaultValue={j.context ?? ""} /><span className="help">Industry, plant type, standards — candidates from a similar setting score higher</span></label>
                  </ActionForm></details>
                <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>Text for Naukri / LinkedIn / Indeed</summary>
                  <textarea readOnly rows={14} style={{ width: "100%", marginTop: 8, fontSize: 13 }} defaultValue={jdText(j, { company: session.tenant.name, location: r.location ?? undefined, ctc: r.ctc_max ? `${lakh(r.ctc_min)} – ${lakh(r.ctc_max)} a year` : undefined })} /></details>
                <ActionForm action={writeJd} submitLabel="Write a fresh draft instead" variant="secondary" hidden={{ requisition_id: r.id, fresh: "1" }} confirm="Replace this JD with a fresh draft written from the requisition?" />
              </>}
            </div>)}
        </div>
      </div>

      <div className="card">
        <h2>Candidates ({(apps ?? []).length})
          {hr && (apps ?? []).length > 0 && <ActionForm action={rescoreAll} submitLabel="Score all again" variant="secondary" hidden={{ requisition_id: r.id }} />}</h2>
        {hr && !["closed", "cancelled"].includes(r.status) && (
          <div className="grid two" style={{ marginBottom: 14 }}>
            <ResumeUploader requisitionId={r.id} />
            <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>Add a candidate by hand (no resume file, or a referral)</summary>
              <ActionForm action={addCandidate} submitLabel="Add and score" className="formgrid" hidden={{ requisition_id: r.id }}>
                <label className="field">Name<input name="full_name" required maxLength={120} /></label>
                <label className="field">Mobile<input name="phone" inputMode="tel" /></label>
                <label className="field">E-mail<input name="email" type="email" /></label>
                <label className="field">Total experience (years)<input name="total_exp" inputMode="decimal" /></label>
                <label className="field">Expected salary (lakhs a year)<input name="expected_ctc" inputMode="decimal" /></label>
                <label className="field">Notice period (days)<input name="notice_days" inputMode="numeric" /></label>
                <label className="field">Source<select name="source" defaultValue="manual"><option value="manual">Walk-in / direct</option><option value="referral">Employee referral</option></select></label>
                <label className="field full">Experience summary or resume text<textarea name="resume_text" rows={4} placeholder="Paste the resume text, or describe what they have done — it is scored like a resume." /></label>
              </ActionForm></details>
          </div>)}
        <div className="toolbar">
          <a className={`btn small${filter ? " secondary" : ""}`} href={p(`/app/recruitment/requisitions/${r.id}`)}>All</a>
          {([["new", "New"], ["shortlisted", "Shortlisted"], ["on_hold", "On hold"], ["selected", "Selected"], ["declined", "Declined"]] as [string, string][]).map(([k, l]) =>
            <a key={k} className={`btn small${filter === k ? "" : " secondary"}`} href={p(`/app/recruitment/requisitions/${r.id}?f=${k}`)}>{l} ({k === "shortlisted" ? counts("shortlisted") + counts("interview") : counts(k)})</a>)}
        </div>
        {!list.length ? <Empty>{(apps ?? []).length ? "No candidates with this status." : "No candidates yet — upload resumes or share the apply link."}</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Candidate</th><th>Score</th><th>Recommendation</th><th className="num">Exp.</th><th className="num">Notice</th><th className="num">Expects</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.map((a) => { const c = one(a.candidate as unknown as { full_name: string; total_exp: number | null; notice_days: number | null; expected_ctc: number | null; location: string | null; parse_status: string } | null); return (
              <tr key={a.id}>
                <td><b>{c?.full_name}</b>{c?.location ? <span className="muted"> · {c.location}</span> : null}
                  {(a.flags as string[])?.length ? <div style={{ fontSize: 12, color: "var(--warn)" }}>⚠ {(a.flags as string[]).join("; ")}</div> : null}
                  {c?.parse_status === "scanned" ? <div className="muted" style={{ fontSize: 12 }}>Scanned resume — type the details on the candidate page</div> : null}</td>
                <td><ScoreBar score={a.score} /></td><td><RecoBadge reco={a.recommendation} /></td>
                <td className="num">{c?.total_exp != null ? `${c.total_exp} y` : "—"}</td><td className="num">{c?.notice_days != null ? `${c.notice_days} d` : "—"}</td>
                <td className="num">{lakh(c?.expected_ctc)}</td><td><AppStatus status={a.status} /></td>
                <td style={{ textAlign: "right" }}>{hr ? <a className="btn secondary small" href={p(`/app/recruitment/candidates/${a.id}`)}>Review</a> : null}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
