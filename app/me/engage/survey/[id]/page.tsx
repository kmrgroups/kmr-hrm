import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { RATING_LABELS, surveyOpen, type Question } from "@/lib/engage/rules";
import { answerSurvey } from "../../actions";

export const metadata = { title: "Survey" };

export default async function AnswerSurvey({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.user.employee_id) redirect("/account");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const [{ data: s }, { data: done }] = await Promise.all([
    db.from("surveys").select("id,title,intro,status,opens_on,closes_on,anonymous,questions").eq("id", id).maybeSingle(),
    db.from("survey_participants").select("survey_id").eq("survey_id", id).eq("employee_id", session.user.employee_id).maybeSingle(),
  ]);
  if (!s) notFound();
  const open = surveyOpen(s, istToday());
  const qs = s.questions as Question[];

  return (
    <AppShell session={session} active="/me/engage">
      <div className="pagehead"><div><h1>{s.title}</h1>{s.intro && <p>{s.intro}</p>}</div><a className="btn secondary" href={p("/me/engage")}>Back</a></div>
      {done ? <div className="card"><p style={{ margin: 0 }}>You have answered this survey. Thank you!</p></div>
        : !open ? <div className="card"><p style={{ margin: 0 }}>This survey is closed.</p></div> : (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>{s.anonymous ? "Anonymous: your answers are saved without your name, and results are shown only for groups of 5 or more people." : "This survey is not anonymous — HR will see your name with your answers."}</p>
          <ActionForm action={answerSurvey} submitLabel="Send my answers" pendingLabel="Sending…" hidden={{ survey_id: id }}>
            {qs.map((q, i) => (
              <fieldset key={q.id} style={{ border: 0, borderTop: "1px solid var(--border)", padding: "12px 0", margin: 0 }}>
                <legend style={{ fontWeight: 600, padding: 0, marginBottom: 8 }}>{i + 1}. {q.text}{q.required && <span style={{ color: "var(--danger)" }}> *</span>}</legend>
                {q.type === "rating" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{RATING_LABELS.map((l, k) => (
                  <label key={k} className="chip" style={{ cursor: "pointer", padding: "6px 12px" }}><input type="radio" name={q.id} value={k + 1} required={q.required} /> {l}</label>))}</div>}
                {q.type === "enps" && <><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{Array.from({ length: 11 }, (_, k) => (
                  <label key={k} className="chip" style={{ cursor: "pointer", padding: "6px 10px" }}><input type="radio" name={q.id} value={k} required={q.required} /> {k}</label>))}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>0 = not at all likely · 10 = extremely likely</div></>}
                {q.type === "yesno" && <div style={{ display: "flex", gap: 8 }}>{[["yes", "Yes"], ["no", "No"]].map(([v, l]) => (
                  <label key={v} className="chip" style={{ cursor: "pointer", padding: "6px 14px" }}><input type="radio" name={q.id} value={v} required={q.required} /> {l}</label>))}</div>}
                {q.type === "choice" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(q.options ?? []).map((o) => (
                  <label key={o} className="chip" style={{ cursor: "pointer", padding: "6px 12px" }}><input type="radio" name={q.id} value={o} required={q.required} /> {o}</label>))}</div>}
                {q.type === "text" && <textarea name={q.id} rows={3} maxLength={2000} required={q.required} placeholder={s.anonymous ? "Please do not write names." : ""} style={{ width: "100%" }} />}
              </fieldset>))}
          </ActionForm>
        </div>)}
    </AppShell>
  );
}
