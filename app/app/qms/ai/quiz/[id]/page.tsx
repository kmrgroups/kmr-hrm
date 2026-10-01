import { notFound } from "next/navigation";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { aiConfigured } from "@/lib/ai/gateway";
import { PROGRAM_CATEGORIES } from "@/lib/qms/rules";
import { decideQuiz, editQuizItem, writeProgramQuiz } from "../../actions";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Test questions" };
export const maxDuration = 60;
const L = ["A", "B", "C", "D"];

/** pre / post test paper of a programme: the AI drafts, HR checks every answer and accepts, then it is printed */
export default async function QuizPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { id } = await params, { key } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const [{ data: pr }, { data: st }, { data: t }] = await Promise.all([
    db.from("training_programs").select("id,title,category,duration_hours,pass_mark,content,quiz,quiz_status,quiz_model").eq("id", id).maybeSingle(),
    db.from("qms_settings").select("ai_enabled").maybeSingle(),
    db.from("tenants").select("name").maybeSingle(),
  ]);
  if (!pr) notFound();
  const quiz = (pr.quiz ?? []) as { q: string; options: string[]; answer: number }[];
  const accepted = pr.quiz_status === "accepted", canAi = aiConfigured() && st?.ai_enabled !== false;

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead noprint"><div><h1>Test questions — {pr.title}</h1>
        <p>{PROGRAM_CATEGORIES[pr.category]} · {pr.duration_hours} h · pass mark {pr.pass_mark}%{pr.quiz_model ? ` · drafted by ${pr.quiz_model}` : ""}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn secondary" href={p("/app/qms/ai")}>Back to AI &amp; review</a>
          {accepted && <><PrintButton label={key ? "Print the answer key" : "Print the question paper"} />
            <a className="btn secondary" href={p(`/app/qms/ai/quiz/${id}${key ? "" : "?key=1"}`)}>{key ? "Question paper view" : "Answer key view"}</a></>}
        </div></div>

      {!quiz.length ? (
        <div className="card noprint"><Empty>No questions yet.</Empty>
          {canAi ? <ActionForm action={writeProgramQuiz} submitLabel="Draft 10 questions (AI)" pendingLabel="Writing…" hidden={{ id, count: "10" }} />
            : <p className="muted">The free AI is not set up or is switched off — see QMS › AI &amp; review.</p>}</div>
      ) : !accepted ? (
        <div className="card noprint">
          <div className="alert warn" style={{ marginBottom: 12 }}>AI draft — check every question and its right answer. Correct or remove any that are wrong, then accept.</div>
          <ol style={{ paddingLeft: 20 }}>{quiz.map((x, i) => (
            <li key={i} style={{ marginBottom: 14 }}>
              <b>{x.q}</b>
              <ActionForm action={editQuizItem} submitLabel="Save the right answer" variant="secondary" className="stack" hidden={{ id, i: String(i), what: "answer" }}>
                {x.options.map((o, j) => <label key={j} className="field check" style={{ margin: 0 }}><input type="radio" name="answer" value={j} defaultChecked={j === x.answer} /> {L[j]}. {o}{j === x.answer ? "  ✓" : ""}</label>)}
              </ActionForm>
              <ActionForm action={editQuizItem} submitLabel="Remove this question" variant="secondary" className="inline" hidden={{ id, i: String(i), what: "remove" }} />
            </li>))}</ol>
          <div style={{ display: "flex", gap: 8 }}>
            <ActionForm action={decideQuiz} submitLabel={`Accept ${quiz.length} questions`} variant="accent" className="inline" hidden={{ id, accept: "1" }} />
            <ActionForm action={decideQuiz} submitLabel="Discard" variant="secondary" className="inline" hidden={{ id, accept: "0" }} confirm="Discard all these questions?" />
            {canAi && <ActionForm action={writeProgramQuiz} submitLabel="Write again (AI)" pendingLabel="Writing…" variant="secondary" className="inline" hidden={{ id, count: "10" }} />}
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 12 }}>
            <div><b>{t?.name}</b><div>{key ? "Answer key" : "Pre-test / Post-test"} — {pr.title}</div></div>
            <div style={{ textAlign: "right", fontSize: 13 }}>Pass mark {pr.pass_mark}% · {quiz.length} questions<div>Ref. IATF 16949 7.2 / ISO 9001 7.2(c)</div></div>
          </div>
          {!key && <p style={{ fontSize: 14 }}>Name: ______________________ &nbsp; Emp. code: __________ &nbsp; Date: __________ &nbsp; ☐ Pre-test &nbsp; ☐ Post-test &nbsp; Score: ______ / {quiz.length}</p>}
          <ol style={{ paddingLeft: 20 }}>{quiz.map((x, i) => (
            <li key={i} style={{ marginBottom: 10, breakInside: "avoid" }}><b>{x.q}</b>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px", marginTop: 4 }}>{x.options.map((o, j) =>
                <span key={j} style={key && j === x.answer ? { fontWeight: 700 } : undefined}>{key ? (j === x.answer ? "✔ " : "") : "☐ "}{L[j]}. {o}</span>)}</div></li>))}</ol>
          <div className="noprint" style={{ marginTop: 12 }}><ActionForm action={decideQuiz} submitLabel="Discard these questions" variant="secondary" className="inline" hidden={{ id, accept: "0" }} confirm="Discard the accepted questions? The paper can be drafted again." /></div>
        </div>
      )}
    </AppShell>
  );
}
