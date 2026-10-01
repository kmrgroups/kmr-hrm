import { notFound } from "next/navigation";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { aiConfigured } from "@/lib/ai/gateway";
import { byGroup, engagementIndex, questionResults, MIN_GROUP, Q_TYPES, surveyOpen, type Question } from "@/lib/engage/rules";
import type { CommentSummary } from "@/lib/engage/ai";
import { masters, people } from "@/app/app/qms/data";
import { EngageTabs, Bar, dayLabel, when } from "../../ui";
import { checkSummary, newSurvey, saveSurvey, setSurveyStatus, summariseSurvey } from "../../actions";

export const metadata = { title: "Survey" };
export const maxDuration = 60;
const KINDS: Record<string, string> = { engagement: "Engagement", pulse: "Pulse", training: "Training feedback", canteen: "Canteen / facilities", exit: "Exit", custom: "Other" };

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: s } = await db.from("surveys").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const [m, ppl, resp, { count: answered }, { data: st }] = await Promise.all([
    masters(db), people(db),
    fetchAll<{ answers: Record<string, unknown>; department_id: string | null; plant_id: string | null }>((a, b) => db.from("survey_responses").select("answers,department_id,plant_id").eq("survey_id", id).range(a, b)),
    db.from("survey_participants").select("employee_id", { count: "exact", head: true }).eq("survey_id", id),
    db.from("qms_settings").select("ai_enabled").maybeSingle(),
  ]);
  const qs = s.questions as Question[];
  const today = istToday();
  const aud = ppl.filter((e) => s.audience === "all" || (s.audience === "department" ? e.department_id === s.department_id : e.plant_id === s.plant_id)).length;
  const enough = resp.length >= MIN_GROUP;
  const res = enough ? questionResults(qs, resp) : [];
  const index = engagementIndex(res), en = res.find((r) => r.type === "enps")?.enps;
  const depts = enough ? byGroup(qs, resp, "department_id") : [];
  const plants = enough && m.plants.length > 1 ? byGroup(qs, resp, "plant_id") : [];
  const comments = res.filter((r) => r.type === "text").reduce((n, r) => n + (r.comments?.length ?? 0), 0);
  const ai = aiConfigured() && st?.ai_enabled !== false;
  const sum = s.ai_summary as CommentSummary | null;
  const rows = [...qs.map((q) => ({ ...q, options: (q.options ?? []).join(", ") })), ...Array.from({ length: 5 }, () => ({ id: "", text: "", type: "rating", options: "", required: true }))];
  const draft = s.status === "draft";
  const live = surveyOpen(s, today);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>{s.title}</h1>
        <p>{KINDS[s.kind]} · {s.anonymous ? "anonymous" : "named — HR sees who answered what"} · {s.audience === "all" ? "everybody" : s.audience === "department" ? m.departments.find((d) => d.id === s.department_id)?.name : m.plants.find((x) => x.id === s.plant_id)?.name}
          {" · "}{draft ? "Draft" : s.status === "open" ? (live ? `Open until ${s.closes_on ? dayLabel(s.closes_on) : "closed by HR"}` : `Opens ${dayLabel(s.opens_on)}`) : `Closed ${dayLabel(s.closes_on)}`}{s.sample ? " · Sample" : ""}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(draft || s.status === "closed") && <ActionForm action={setSurveyStatus} submitLabel={draft ? "Open the survey" : "Open again"} pendingLabel="Opening…" variant="accent" className="inline" hidden={{ id, to: "open" }}
            confirm={draft ? "Open it and send the invitation to everybody it is for? The questions cannot change after this." : "Open it again?"} />}
          {s.status === "open" && <ActionForm action={setSurveyStatus} submitLabel="Close now" variant="secondary" className="inline" hidden={{ id, to: "closed" }} confirm="Close the survey?" />}
          <ActionForm action={newSurvey} submitLabel="Copy" variant="secondary" className="inline" hidden={{ copy_of: id }} />
          {!resp.length && <ActionForm action={setSurveyStatus} submitLabel="Delete" variant="danger" className="inline" hidden={{ id, to: "delete" }} confirm="Delete this survey?" />}
        </div></div>
      <EngageTabs active="sur" />

      {!draft && <div className="grid four">
        <div className="card stat"><div className="label">Answered</div><div className="value">{answered ?? 0}</div><div className="hint">of {aud} people{aud ? ` · ${Math.round(((answered ?? 0) / aud) * 100)}%` : ""}</div></div>
        <div className="card stat"><div className="label">Engagement (favourable)</div><div className="value">{index != null ? `${index}%` : "—"}</div><div className="hint">average of “agree” + “strongly agree”</div></div>
        <div className="card stat"><div className="label">eNPS</div><div className="value">{en?.score != null ? `${en.score > 0 ? "+" : ""}${en.score}` : "—"}</div><div className="hint">{en ? `${en.promoters} promoters · ${en.passives} passive · ${en.detractors} detractors` : "−100 to +100"}</div></div>
        <div className="card stat"><div className="label">Written comments</div><div className="value">{comments}</div><div className="hint">{s.anonymous ? "no names" : "named"}</div></div>
      </div>}

      {draft ? (
        <div className="card">
          <h2>Questions and settings</h2>
          <ActionForm action={saveSurvey} submitLabel="Save" className="formgrid" hidden={{ id }}>
            <label className="field full">Title<input name="title" required maxLength={160} defaultValue={s.title} /></label>
            <label className="field full">Note at the top<textarea name="intro" rows={2} maxLength={2000} defaultValue={s.intro ?? ""} /></label>
            <label className="field">Kind<select name="kind" defaultValue={s.kind}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field check"><input type="checkbox" name="anonymous" defaultChecked={s.anonymous} /> Anonymous (recommended)</label>
            <label className="field">For<select name="audience" defaultValue={s.audience}><option value="all">Everybody</option><option value="department">A department</option><option value="plant">A plant</option></select></label>
            <label className="field">Department (if for a department)<select name="department_id" defaultValue={s.department_id ?? ""}><option value="">—</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="field">Plant (if for a plant)<select name="plant_id" defaultValue={s.plant_id ?? ""}><option value="">—</option>{m.plants.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <div />
            <label className="field">Opens on <span className="help">blank = when you open it</span><input type="date" name="opens_on" defaultValue={s.opens_on ?? ""} /></label>
            <label className="field">Closes on<input type="date" name="closes_on" defaultValue={s.closes_on ?? ""} /></label>
            <div className="full tablewrap"><table>
              <thead><tr><th>#</th><th>Question</th><th>Answer type</th><th>Choices (comma separated)</th><th>Must answer</th></tr></thead>
              <tbody>{rows.map((q, i) => (
                <tr key={i}><td>{i + 1}</td>
                  <td><input name={`q_text_${i}`} defaultValue={q.text} maxLength={300} placeholder={i >= qs.length ? "Add a question…" : ""} style={{ minWidth: 280 }} /></td>
                  <td><select name={`q_type_${i}`} defaultValue={q.type}>{Object.entries(Q_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                  <td><input name={`q_options_${i}`} defaultValue={q.options} placeholder="only for “One of a list”" /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" name={`q_req_${i}`} defaultChecked={q.required !== false} /></td></tr>))}</tbody>
            </table><p className="muted" style={{ fontSize: 13 }}>Clear a question&apos;s text to remove it. Save to get five more empty rows.</p></div>
          </ActionForm>
        </div>
      ) : <>
        {!enough ? <div className="card"><Empty>Results appear when {MIN_GROUP} or more people have answered — so nobody can be picked out. {resp.length} so far.</Empty></div> : <>
          {(depts.length > 0 || plants.length > 0) && <div className="card">
            <h2>By group <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(only groups with {MIN_GROUP}+ answers; smaller ones together as “others”)</span></h2>
            <div className="tablewrap" style={{ border: 0 }}><table><thead><tr><th>Group</th><th className="num">Answers</th><th>Favourable</th><th className="num">eNPS</th></tr></thead>
              <tbody>{[...depts.map((g) => ({ ...g, label: g.group === "__other" ? "Other departments" : m.departments.find((d) => d.id === g.group)?.name ?? "No department" })),
                ...plants.map((g) => ({ ...g, label: g.group === "__other" ? "Other plants" : `Plant: ${m.plants.find((d) => d.id === g.group)?.name ?? "—"}` }))].map((g) => (
                <tr key={g.label}><td>{g.label}</td><td className="num">{g.n}</td><td>{g.index != null ? <><Bar pct={g.index} tone={g.index >= 70 ? "ok" : g.index >= 50 ? "warn" : "danger"} /> {g.index}%</> : "—"}</td>
                  <td className="num">{g.enps != null ? `${g.enps > 0 ? "+" : ""}${g.enps}` : "—"}</td></tr>))}</tbody></table></div>
          </div>}
          <div className="card">
            <h2>Question by question</h2>
            {res.map((r, i) => (
              <div key={r.id} style={{ borderTop: i ? "1px solid var(--border)" : 0, padding: "10px 0" }}>
                <b>{i + 1}. {r.text}</b> <span className="muted" style={{ fontSize: 12 }}>{r.answered} answers</span>
                {r.type === "rating" && <div style={{ fontSize: 14, marginTop: 4 }}>Average <b>{r.average}</b> / 5 · favourable <b>{r.favourable}%</b> <Bar pct={r.favourable ?? 0} tone={(r.favourable ?? 0) >= 70 ? "ok" : (r.favourable ?? 0) >= 50 ? "warn" : "danger"} /></div>}
                {r.type === "enps" && r.enps && <div style={{ fontSize: 14, marginTop: 4 }}>eNPS <b>{r.enps.score! > 0 ? "+" : ""}{r.enps.score}</b> · average {r.average} / 10</div>}
                {r.counts && r.type !== "enps" && <div style={{ marginTop: 4 }}>{r.counts.map((c) => <div key={c.label} style={{ fontSize: 13 }}><span style={{ display: "inline-block", width: 160 }}>{c.label}</span><Bar pct={r.answered ? (c.n / r.answered) * 100 : 0} /> {c.n}</div>)}</div>}
                {r.comments && (r.comments.length ? <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 260, overflow: "auto" }}>{r.comments.map((c, j) => <li key={j} style={{ fontSize: 14 }}>{c}</li>)}</ul> : <div className="muted">No comments.</div>)}
              </div>))}
          </div>
          <div className="card">
            <div className="spread"><h2 style={{ margin: 0 }}>Comments summary {sum && <span className={`badge ${s.summary_reviewed_at ? "ok" : "warn"}`}>{s.summary_reviewed_at ? `Checked by ${s.summary_reviewed_by_name}` : "AI summary — check it"}</span>}</h2>
              {ai && comments >= 3 && <ActionForm action={summariseSurvey} submitLabel={sum ? "Summarise again (AI)" : "Summarise the comments (AI)"} pendingLabel="Reading the comments…" variant="secondary" className="inline" hidden={{ id }} />}</div>
            {!sum ? <p className="muted" style={{ marginBottom: 0 }}>{ai ? (comments >= 3 ? "The free AI can group the written comments into themes and suggest actions. The comments go without names; phone numbers and e-mail addresses are taken out first. You check the summary against the comments above." : "Fewer than 3 comments.") : "Set up the free AI in QMS › AI & review to have comments summarised."}</p> : <>
              <p className="muted" style={{ fontSize: 13 }}>Written by {s.ai_model} on {when(s.ai_summary_at)}. It is the AI&apos;s reading of the comments — check it against the comments above before you act on it or share it.</p>
              <div className="grid two">
                <div><h3>Themes</h3><ol style={{ paddingLeft: 18 }}>{sum.themes.map((t) => <li key={t.theme}><b>{t.theme}</b> <span className="muted">({t.count})</span><ul>{t.points.map((x) => <li key={x}>{x}</li>)}</ul></li>)}</ol></div>
                <div><h3>Suggested actions</h3><ul style={{ paddingLeft: 18 }}>{sum.actions.map((x) => <li key={x}>{x}</li>)}</ul>
                  {sum.positives.length > 0 && <><h3>What people like</h3><ul style={{ paddingLeft: 18 }}>{sum.positives.map((x) => <li key={x}>{x}</li>)}</ul></>}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!s.summary_reviewed_at && <ActionForm action={checkSummary} submitLabel="I have checked it against the comments" variant="accent" className="inline" hidden={{ id }} />}
                <ActionForm action={checkSummary} submitLabel="Remove the summary" variant="secondary" className="inline" hidden={{ id, discard: "1" }} />
              </div></>}
          </div>
        </>}
        <div className="card">
          <h2>Settings</h2>
          <ActionForm action={saveSurvey} submitLabel="Save" className="formgrid" hidden={{ id, audience: s.audience, department_id: s.department_id ?? "", plant_id: s.plant_id ?? "" }}>
            <label className="field full">Title<input name="title" required maxLength={160} defaultValue={s.title} /></label>
            <label className="field full">Note at the top<textarea name="intro" rows={2} maxLength={2000} defaultValue={s.intro ?? ""} /></label>
            <label className="field">Opens on<input type="date" name="opens_on" defaultValue={s.opens_on ?? ""} /></label>
            <label className="field">Closes on<input type="date" name="closes_on" defaultValue={s.closes_on ?? ""} /></label>
          </ActionForm>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>The questions are fixed once people answer. Use “Copy” for next year&apos;s round, so the two can be compared. A reminder goes to those who have not answered two days before it closes.</p>
        </div>
      </>}
    </AppShell>
  );
}
