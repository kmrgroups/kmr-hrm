import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { p } from "@/lib/base-path";
import { SUG_CATEGORIES, SUG_STATUS, suggestionStats } from "@/lib/engage/rules";
import { namesOf } from "@/lib/engage/data";
import { people, personLabel } from "@/app/app/qms/data";
import { EngageTabs, inr, when } from "../ui";
import { addSuggestionFor } from "../actions";

export const metadata = { title: "Suggestions / Kaizen" };

interface Row { id: string; ref: string; title: string; status: string; category: string; employee_id: string; created_at: string; decided_at: string | null; saving_per_year: number | null; reviewed_by_name: string | null; sample: boolean }

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { s = "waiting" } = await searchParams;
  const db = await createClient();
  const [rows, ppl] = await Promise.all([
    fetchAll<Row>((a, b) => db.from("suggestions").select("id,ref,title,status,category,employee_id,created_at,decided_at,saving_per_year,reviewed_by_name,sample").order("created_at", { ascending: false }).range(a, b)),
    people(db),
  ]);
  // a manager's list is his team's (row-level security also lets him see the company's implemented ones — keep those to the board)
  const mineIds = new Set(ppl.map((e) => e.id));
  const scoped = hr ? rows : rows.filter((r) => mineIds.has(r.employee_id));
  const list = scoped.filter((r) => s === "all" ? true : s === "waiting" ? ["submitted", "under_review", "on_hold"].includes(r.status) : r.status === s);
  const names = await namesOf(session.tenant.id, list.map((r) => r.employee_id));
  const year = new Date().getFullYear().toString();
  const st = suggestionStats(scoped.filter((r) => r.created_at.slice(0, 4) === year), ppl.length);
  const age = (r: Row) => Math.floor((Date.now() - new Date(r.created_at).getTime()) / 864e5);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>Suggestions / Kaizen</h1>
        <p>Ideas from the people who do the work. Answer every one within 7 days — accepted, not taken (with the reason) or implemented with what it gave. {hr ? "" : "You see your team's."}</p></div></div>
      <EngageTabs active="sug" hr={hr} />
      <div className="grid four">
        <div className="card stat"><div className="label">This year</div><div className="value">{st.total}</div><div className="hint">{st.people} people · {st.per100 ?? 0} per 100</div></div>
        <div className="card stat"><div className="label">Waiting for an answer</div><div className="value">{st.waiting}</div><div className="hint">{st.waitingOver7 ? `${st.waitingOver7} over 7 days` : "none over 7 days"}</div></div>
        <div className="card stat"><div className="label">Answered within 7 days</div><div className="value">{st.decidedIn7Pct != null ? `${st.decidedIn7Pct}%` : "—"}</div><div className="hint">of decided ideas</div></div>
        <div className="card stat"><div className="label">Implemented</div><div className="value">{st.implemented}</div><div className="hint">saving {inr(st.saving)} a year</div></div>
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>{[["waiting", "Waiting"], ["accepted", "Accepted — to do"], ["implemented", "Implemented"], ["not_taken", "Not taken up"], ["all", "All"]].map(([k, l]) =>
        <a key={k} className={s === k ? "active" : ""} href={p(`/app/engage/suggestions?s=${k}`)}>{l}</a>)}</div>
      <div className="card">
        {!list.length ? <Empty>Nothing here.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Suggestion</th><th>From</th><th>Type</th><th>Status</th><th className="num">Saving / year</th></tr></thead>
            <tbody>{list.map((r) => { const n = names.get(r.employee_id); const late = ["submitted", "under_review"].includes(r.status) && age(r) > 7; return (
              <tr key={r.id}><td><a href={p(`/app/engage/suggestions/${r.id}`)}><b>{r.title}</b></a><div className="muted" style={{ fontSize: 12 }}>{r.ref} · {when(r.created_at)}{r.sample ? " · Sample" : ""}</div></td>
                <td>{n?.name ?? "—"}<div className="muted" style={{ fontSize: 12 }}>{n?.department ?? ""}</div></td>
                <td>{SUG_CATEGORIES[r.category]}</td>
                <td><span className={`badge ${r.status === "implemented" ? "ok" : r.status === "not_taken" ? "" : late ? "danger" : "warn"}`}>{SUG_STATUS[r.status]}</span>
                  {late && <div className="muted" style={{ fontSize: 12 }}>{age(r)} days waiting</div>}{r.reviewed_by_name && <div className="muted" style={{ fontSize: 12 }}>{r.reviewed_by_name}</div>}</td>
                <td className="num">{r.saving_per_year ? inr(Number(r.saving_per_year)) : "—"}</td></tr>); })}</tbody>
          </table></div>)}
      </div>

      <div className="card">
        <h2>Enter an idea for someone</h2>
        <p className="muted" style={{ marginTop: 0 }}>For people without a login — a worker who told you the idea on the shop floor. It is recorded in their name. People with a login send ideas from their portal.</p>
        <ActionForm action={addSuggestionFor} submitLabel="Enter the suggestion" className="formgrid" resetOnSuccess>
          <label className="field">Whose idea<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
          <label className="field">Type<select name="category" defaultValue="productivity">{Object.entries(SUG_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field full">Title<input name="title" required maxLength={160} /></label>
          <label className="field">The problem today<textarea name="problem" rows={3} required maxLength={2000} /></label>
          <label className="field">The idea<textarea name="idea" rows={3} required maxLength={2000} /></label>
          <label className="field">Where (line, machine, area)<input name="area" maxLength={120} /></label>
          <label className="field">Others who worked on it<input name="team" maxLength={300} /></label>
        </ActionForm>
      </div>
    </AppShell>
  );
}
