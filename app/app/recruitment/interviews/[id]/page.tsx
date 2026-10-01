import { notFound } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDateTime } from "@/components/ui";
import { p } from "@/lib/base-path";
import { fmtWhen, lakh, modeLabel } from "@/lib/recruit/format";
import { saveFeedback } from "../../actions";
import { RecruitTabs } from "../../ui";

export const metadata = { title: "Interview scorecard" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const RECO: [string, string][] = [["strong_hire", "Strong hire"], ["hire", "Hire"], ["hold", "Hold"], ["no_hire", "No hire"]];
const LEVELS = "1 = no evidence · 2 = below the need · 3 = meets the need · 4 = strong · 5 = outstanding";

function Rating({ name, value }: { name: string; value?: number }) {
  return <span className="rating">{[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name={name} value={n} defaultChecked={value === n} /><span>{n}</span></label>)}</span>;
}

/** The interviewer's scorecard: each must-have competency of the JD, an overall rating and a recommendation */
export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager", "interviewer"]);
  const hr = hasRole(session.user, ["hr_manager", "hr_executive"]);
  const { id } = await params;
  const db = await createClient();
  const { data: iv } = await db.from("interviews").select("*, application:applications(id, requisition_id, candidate:candidates(id,full_name,total_exp,current_company,current_designation,expected_ctc,notice_days,resume_path))").eq("id", id).maybeSingle();
  if (!iv) notFound();
  type Cand = { id: string; full_name: string; total_exp: number | null; current_company: string | null; current_designation: string | null; expected_ctc: number | null; notice_days: number | null; resume_path: string | null };
  const app = one(iv.application as unknown as { id: string; requisition_id: string; candidate: Cand | Cand[] });
  const cand = one<Cand>(app?.candidate);
  const [{ data: req }, { data: fb }] = await Promise.all([
    db.from("requisitions").select("title, jd:job_descriptions(must_have, good_to_have)").eq("id", app!.requisition_id).maybeSingle(),
    db.from("interview_feedback").select("*").eq("interview_id", id),
  ]);
  const jd = one(req?.jd as unknown as { must_have: { name: string }[]; good_to_have: { name: string }[] });
  const comps = [...(jd?.must_have ?? []), ...(jd?.good_to_have ?? []).slice(0, 3)].map((c) => c.name);
  const mine = (fb ?? []).find((f) => f.panelist_id === session.user.id);
  const onPanel = (iv.panel as string[]).includes(session.user.id);
  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>{cand?.full_name}</h1><p>{req?.title} · round {iv.round} ({iv.title}) · {fmtWhen(iv.starts_at)} · {modeLabel(iv.mode)}</p></div>
        {cand?.resume_path && <a className="btn secondary" target="_blank" rel="noreferrer" href={p(`/api/recruitment/resume/${cand.id}`)}>Open the resume</a>}</div>
      <RecruitTabs active="interviews" hr={hr} />
      <div className="grid two">
        <div className="card">
          <h2>Candidate</h2>
          <dl className="kv">
            <dt>Experience</dt><dd>{cand?.total_exp != null ? `${cand.total_exp} years` : "—"}</dd>
            <dt>Now</dt><dd>{[cand?.current_designation, cand?.current_company].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Expects</dt><dd>{lakh(cand?.expected_ctc)}</dd>
            <dt>Notice</dt><dd>{cand?.notice_days != null ? `${cand.notice_days} days` : "—"}</dd>
            <dt>Where</dt><dd>{iv.mode === "video" ? <a href={iv.video_link} target="_blank" rel="noreferrer">{iv.video_link}</a> : iv.venue ?? "—"}</dd>
            <dt>Panel</dt><dd>{(iv.panel_names as string[]).join(", ")}</dd>
          </dl>
          {hr && <p><a href={p(`/app/recruitment/candidates/${app!.id}`)}>Open the full candidate record →</a></p>}
        </div>
        <div className="card">
          <h2>{onPanel ? "Your scorecard" : "Scorecards"}</h2>
          {onPanel ? (
            <ActionForm action={saveFeedback} submitLabel={mine ? "Update my scorecard" : "Submit my scorecard"} hidden={{ interview_id: iv.id }}>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{LEVELS}</p>
              {comps.map((c) => <div key={c} className="spread" style={{ gap: 12 }}><span style={{ fontSize: 14 }}>{c}</span><Rating name={`score:${c}`} value={(mine?.scores as Record<string, number> | undefined)?.[c]} /></div>)}
              <div className="spread" style={{ gap: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}><b>Overall</b><Rating name="overall" value={mine?.overall} /></div>
              <label className="field">Recommendation<select name="recommendation" defaultValue={mine?.recommendation ?? ""} required><option value="" disabled>Choose…</option>{RECO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field">Strengths<textarea name="strengths" rows={2} defaultValue={mine?.strengths ?? ""} maxLength={1500} /></label>
              <label className="field">Concerns<textarea name="concerns" rows={2} defaultValue={mine?.concerns ?? ""} maxLength={1500} /></label>
            </ActionForm>) : !(fb ?? []).length ? <Empty>No scorecards yet.</Empty> : null}
          {hr && (fb ?? []).length > 0 && <ul className="timeline" style={{ marginTop: 12 }}>{(fb ?? []).map((f) => <li key={f.id}><span><b>{f.panelist_name}</b> — {RECO.find(([k]) => k === f.recommendation)?.[1]}<div className="muted" style={{ fontSize: 12 }}>{Object.entries(f.scores as Record<string, number>).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>{f.strengths ? <div>+ {f.strengths}</div> : null}{f.concerns ? <div>− {f.concerns}</div> : null}</span><span>{f.overall}/5<div className="muted" style={{ fontSize: 11 }}>{fmtDateTime(f.submitted_at)}</div></span></li>)}</ul>}
        </div>
      </div>
    </AppShell>
  );
}
