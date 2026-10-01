import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { SURVEY_TEMPLATES } from "@/lib/engage/templates";
import { EngageTabs, dayLabel } from "../ui";
import { newSurvey } from "../actions";

export const metadata = { title: "Surveys" };

export default async function SurveysPage() {
  const session = await requireRole(HR_ROLES);
  const db = await createClient();
  const { data: list } = await db.from("surveys").select("id,title,kind,anonymous,status,opens_on,closes_on,sample,questions,survey_participants(count)").order("created_at", { ascending: false }).limit(200);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>Surveys</h1>
        <p>Ask people how they feel — engagement, monthly pulse, canteen, new joiners, exits. Anonymous by default: answers carry no name, and results are shown only for groups of 5 or more.</p></div></div>
      <EngageTabs active="sur" />
      <div className="card">
        {!list?.length ? <Empty>No survey yet — start from a template below.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Survey</th><th>Status</th><th>Dates</th><th className="num">Answered</th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id}><td><a href={p(`/app/engage/surveys/${s.id}`)}><b>{s.title}</b></a>
                <div className="muted" style={{ fontSize: 12 }}>{(s.questions as unknown[]).length} questions · {s.anonymous ? "anonymous" : "named"}{s.sample ? " · Sample" : ""}</div></td>
                <td><span className={`badge ${s.status === "open" ? "ok" : s.status === "draft" ? "warn" : ""}`}>{s.status === "open" ? "Open" : s.status === "draft" ? "Draft" : "Closed"}</span></td>
                <td>{s.opens_on ? dayLabel(s.opens_on) : "—"} – {s.closes_on ? dayLabel(s.closes_on) : "—"}</td>
                <td className="num">{(s.survey_participants as unknown as { count: number }[])?.[0]?.count ?? 0}</td></tr>))}</tbody>
          </table></div>)}
      </div>
      <div className="card">
        <h2>Start a survey</h2>
        <div className="grid three">{SURVEY_TEMPLATES.map((t) => (
          <div key={t.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <b>{t.title}</b><div className="muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>{t.questions.length} questions: {t.questions.slice(0, 2).map((q) => q.text).join("; ")}…</div>
            <ActionForm action={newSurvey} submitLabel="Use this" variant="secondary" className="inline" hidden={{ template: t.key }} />
          </div>))}
          <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 12 }}>
            <b>Blank survey</b><div className="muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>Write your own questions.</div>
            <ActionForm action={newSurvey} submitLabel="Start blank" variant="secondary" className="inline" hidden={{ template: "blank" }} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
