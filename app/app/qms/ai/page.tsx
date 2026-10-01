import { requireRole, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { aiProviders } from "@/lib/ai/gateway";
import { EVAL_METHODS, PROGRAM_CATEGORIES } from "@/lib/qms/rules";
import { HR_ROLES } from "@/lib/auth";
import { QmsTabs } from "../ui";
import { acceptProgram, checkAi, rejectProgram, setAiEnabled, writeProgramQuiz } from "./actions";

export const metadata = { title: "QMS — AI & review" };
export const maxDuration = 60;

const AGENTS: Record<string, string> = { jd: "Job description", sheet: "R&R sheet", programmes: "Training programmes", quiz: "Test questions", qms_agent: "QMS check", check: "Connection check" };
const when = (t: string) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function AiPage() {
  const session = await requireRole(HR_ROLES);
  const boss = hasRole(session.user, ["hr_manager"]);
  const db = await createClient();
  const [{ data: st }, { data: proposals }, { data: quizzes }, { data: testProgs }, { data: runs }, { data: drafts }] = await Promise.all([
    db.from("qms_settings").select("ai_enabled").maybeSingle(),
    db.from("training_programs").select("id,title,category,duration_hours,eval_method,eff_days,pass_mark,content,ai_topics,ai_model,sample").eq("ai_proposed", true).is("reviewed_at", null).order("title"),
    db.from("training_programs").select("id,title,quiz,quiz_model").eq("quiz_status", "ai_draft").order("title"),
    db.from("training_programs").select("id,title,quiz_status").eq("active", true).eq("eval_method", "test").order("title"),
    db.from("ai_runs").select("id,agent,subject,ok,provider,model,used,summary,error,ms,created_by_name,created_at").order("created_at", { ascending: false }).limit(40),
    db.from("job_descriptions").select("id,position_id,version,ai_model,position:positions(title)").eq("status", "draft").not("ai_model", "is", null).not("position_id", "is", null),
  ]);
  const { data: sheets } = await db.from("rr_roles").select("position_id,version,ai_model,position:positions(title)").eq("status", "draft").not("ai_model", "is", null);
  const providers = aiProviders(), on = st?.ai_enabled !== false;
  const name = (x: unknown) => ((Array.isArray(x) ? x[0] : x) as { title: string } | null)?.title ?? "—";
  const queue = (proposals?.length ?? 0) + (quizzes?.length ?? 0) + (drafts?.length ?? 0) + (sheets?.length ?? 0);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>AI &amp; review</h1>
        <p>Free AI drafts job descriptions, R&amp;R sheets, training programmes and test questions, and puts the QMS findings in order. A person reviews everything it writes — nothing is used until it is approved or accepted. Every run is logged below.</p></div></div>
      <QmsTabs active="ai" hr />

      <div className="grid two">
        <div className="card">
          <h2>Status</h2>
          {providers.length ? <p style={{ marginTop: 0 }}><span className={`badge ${on ? "ok" : ""}`}>{on ? "On" : "Off"}</span> Free services set up: <b>{providers.map((x) => ({ openrouter: "OpenRouter (free models only)", groq: "Groq", gemini: "Google Gemini (free tier)" } as Record<string, string>)[x]).join(", ")}</b>. They are tried in this order.</p>
            : <p style={{ marginTop: 0 }}><span className="badge warn">Not set up</span> No free AI key is set, so the HRM&apos;s own rule-based writer is used. Everything still works.</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {providers.length > 0 && <ActionForm action={checkAi} submitLabel="Check the connection" pendingLabel="Asking…" variant="secondary" className="inline" />}
            {boss && providers.length > 0 && <ActionForm action={setAiEnabled} submitLabel={on ? "Switch AI drafting off" : "Switch AI drafting on"} variant="secondary" className="inline" hidden={{ on: on ? "0" : "1" }} />}
          </div>
        </div>
        <div className="card">
          <h2>How to set it up (free)</h2>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Get one or more free keys: <b>OpenRouter</b> (openrouter.ai › Keys), <b>Groq</b> (console.groq.com › API Keys), <b>Google AI Studio</b> (aistudio.google.com › Get API key). No card is needed.</li>
            <li>In Vercel, open the HRM project › Settings › Environment Variables and add <code>OPENROUTER_API_KEY</code>, <code>GROQ_API_KEY</code> and/or <code>GEMINI_API_KEY</code>. Then redeploy.</li>
            <li>Never paste a key into a chat, an e-mail or this app.</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <h2>Waiting for review {queue > 0 && <span className="badge warn">{queue}</span>}</h2>
        {!queue && <Empty>Nothing waiting. AI drafts appear here until a person approves or accepts them.</Empty>}
        {((drafts?.length ?? 0) + (sheets?.length ?? 0)) > 0 && <><h3>Job descriptions and R&amp;R sheets (draft)</h3>
          <ul>{(drafts ?? []).map((d) => <li key={d.id}><a href={p(`/app/qms/positions/${d.position_id}`)}>{name(d.position)}</a> — job description v{d.version} <span className="muted">· {d.ai_model}</span></li>)}
            {(sheets ?? []).map((d) => <li key={d.position_id}><a href={p(`/app/qms/positions/${d.position_id}`)}>{name(d.position)}</a> — R&amp;R sheet rev {d.version} <span className="muted">· {d.ai_model}</span></li>)}</ul></>}
        {(proposals?.length ?? 0) > 0 && <><h3>Training programmes proposed for open needs</h3>
          <div className="tablewrap"><table>
            <thead><tr><th>Programme</th><th>For the needs</th><th>Evaluation</th><th></th></tr></thead>
            <tbody>{proposals!.map((x) => (
              <tr key={x.id}>
                <td><b>{x.title}</b>{x.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}<div className="muted" style={{ fontSize: 13 }}>{PROGRAM_CATEGORIES[x.category]} · {x.duration_hours} h{x.content ? ` · ${x.content}` : ""}</div></td>
                <td>{(x.ai_topics ?? []).join("; ") || "—"}</td>
                <td>{EVAL_METHODS[x.eval_method]}{x.eff_days ? ` after ${x.eff_days} days` : ""}{x.eval_method === "test" ? ` · pass ${x.pass_mark}%` : ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <ActionForm action={acceptProgram} submitLabel="Accept" variant="accent" className="inline" hidden={{ id: x.id }} />{" "}
                  <ActionForm action={rejectProgram} submitLabel="Reject" variant="secondary" className="inline" hidden={{ id: x.id }} confirm={`Reject and remove “${x.title}”?`} />
                </td></tr>))}</tbody>
          </table></div></>}
        {(quizzes?.length ?? 0) > 0 && <><h3>Test questions</h3>
          <ul>{quizzes!.map((q) => <li key={q.id}><a href={p(`/app/qms/ai/quiz/${q.id}`)}>{q.title}</a> — {(q.quiz as unknown[]).length} questions to check <span className="muted">· {q.quiz_model}</span></li>)}</ul></>}
      </div>

      <div className="card">
        <h2>Pre / post test question papers</h2>
        {!testProgs?.length ? <Empty>No active programme is evaluated by a test.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table><tbody>{testProgs.map((t) => (
            <tr key={t.id}><td><a href={p(`/app/qms/ai/quiz/${t.id}`)}>{t.title}</a></td>
              <td>{t.quiz_status === "accepted" ? <span className="badge ok">Ready to print</span> : t.quiz_status === "ai_draft" ? <span className="badge warn">AI draft — check</span> : <span className="muted">No questions yet</span>}</td>
              <td style={{ textAlign: "right" }}>{providers.length > 0 && on && t.quiz_status !== "accepted" && <ActionForm action={writeProgramQuiz} submitLabel={t.quiz_status ? "Write again" : "Draft questions (AI)"} pendingLabel="Writing…" variant="secondary" className="inline" hidden={{ id: t.id }} />}</td></tr>))}</tbody></table></div>)}
      </div>

      <div className="card">
        <h2>AI runs (latest 40)</h2>
        {!runs?.length ? <Empty>No runs yet.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>What</th><th>About</th><th>Result</th><th>By</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}><td style={{ whiteSpace: "nowrap" }}>{when(r.created_at)}</td><td>{AGENTS[r.agent] ?? r.agent}</td><td>{r.subject}</td>
                <td>{r.used === "ai" ? <span className="badge ok">AI</span> : r.used === "rules" ? <span className="badge">Rules</span> : <span className="badge warn">Nothing used</span>}
                  {r.model && <span className="muted" style={{ fontSize: 12 }}> {r.provider}/{r.model}{r.ms ? ` · ${(r.ms / 1000).toFixed(1)} s` : ""}</span>}
                  {r.summary && <div style={{ fontSize: 13 }}>{r.summary}</div>}{r.error && <div className="muted" style={{ fontSize: 12 }}>{r.error}</div>}</td>
                <td>{r.created_by_name ?? "—"}</td></tr>))}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
