import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { p } from "@/lib/base-path";
import { KINDS, STATUS, POTENTIAL } from "@/lib/safety/rules";
import { masters, people, personLabel } from "@/app/app/qms/data";
import { SafetyTabs, dmyt, KIND_TONE } from "../ui";
import { reportIncident } from "../actions";

export const metadata = { title: "Incidents & near misses" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ s?: string; k?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { s = "open", k } = await searchParams;
  const db = await createClient();
  const [rows, m, ppl, { data: acts }] = await Promise.all([
    fetchAll<{ id: string; ref: string; kind: string; status: string; occurred_at: string; area: string | null; reported_by_name: string | null; days_lost: number; sample: boolean }>((a, b) => {
      let q = db.from("incidents").select("id,ref,kind,status,occurred_at,area,reported_by_name,days_lost,sample").order("occurred_at", { ascending: false });
      if (s === "open") q = q.neq("status", "closed"); else if (s === "closed") q = q.eq("status", "closed");
      if (k && KINDS[k]) q = q.eq("kind", k);
      return q.range(a, b);
    }),
    masters(db), people(db), db.from("incident_actions").select("incident_id,status,due_on"),
  ]);
  const now = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16);
  const today = now.slice(0, 10);

  return (
    <AppShell session={session} active="/app/safety">
      <div className="pagehead"><div><h1>Incidents &amp; near misses</h1><p>Everything that happened or nearly happened — investigated, with actions, until closed. Employees report near misses and unsafe acts / conditions from their portal.</p></div></div>
      <SafetyTabs active="inc" hr={hr} />
      <div className="spread" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ border: 0, margin: 0 }}>{[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([x, l]) => <a key={x} className={s === x ? "active" : ""} href={p(`/app/safety/incidents?s=${x}${k ? `&k=${k}` : ""}`)}>{l}</a>)}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><a className={`badge${!k ? " info" : ""}`} href={p(`/app/safety/incidents?s=${s}`)}>All kinds</a>
          {Object.entries(KINDS).map(([x, l]) => <a key={x} className={`badge${k === x ? " info" : ""}`} href={p(`/app/safety/incidents?s=${s}&k=${x}`)}>{l}</a>)}</div>
      </div>
      <div className="card">
        {!rows.length ? <Empty>Nothing here.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Ref.</th><th>What</th><th>Where</th><th>When</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((i) => { const a = (acts ?? []).filter((x) => x.incident_id === i.id); const late = a.filter((x) => x.status === "open" && x.due_on < today).length; return (
            <tr key={i.id}><td className="mono"><a href={p(`/app/safety/incidents/${i.id}`)}>{i.ref}</a>{i.sample && <div><span className="badge" style={{ fontSize: 11 }}>Sample</span></div>}</td>
              <td><span className={`badge ${KIND_TONE[i.kind]}`}>{KINDS[i.kind]}</span>{i.days_lost > 0 && <div className="muted" style={{ fontSize: 12 }}>{i.days_lost} days lost</div>}</td>
              <td>{i.area ?? "—"}<div className="muted" style={{ fontSize: 12 }}>reported by {i.reported_by_name ?? "—"}</div></td><td style={{ whiteSpace: "nowrap" }}>{dmyt(i.occurred_at)}</td>
              <td><span className={`badge ${i.status === "closed" ? "ok" : i.status === "reported" ? "danger" : "warn"}`}>{STATUS[i.status]}</span></td>
              <td>{a.length ? `${a.filter((x) => x.status === "done").length}/${a.length} done` : "—"}{late > 0 && <div><span className="badge danger" style={{ fontSize: 11 }}>{late} overdue</span></div>}</td></tr>); })}</tbody>
        </table></div>}
      </div>

      <div className="card" id="report">
        <h2>Report an incident</h2>
        <ActionForm action={reportIncident} submitLabel="Record it" pendingLabel="Saving…" className="formgrid">
          <label className="field">What happened<select name="kind" required defaultValue=""><option value="" disabled>Choose…</option>{Object.entries(KINDS).map(([x, l]) => <option key={x} value={x}>{l}</option>)}</select></label>
          <label className="field">When<input type="datetime-local" name="occurred_at" required max={now} defaultValue={now} /></label>
          <label className="field">Plant<select name="plant_id" defaultValue=""><option value="">—</option>{m.plants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field">Department<select name="department_id" defaultValue=""><option value="">—</option>{m.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field full">Where exactly (line, machine, place)<input name="area" maxLength={160} required /></label>
          <label className="field full">What happened<textarea name="description" rows={3} required maxLength={3000} /></label>
          <label className="field full">What was done at once<textarea name="immediate_action" rows={2} maxLength={2000} /></label>
          <label className="field">Person hurt (employee)<select name="injured_employee_id" defaultValue=""><option value="">— nobody / not an employee</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
          <label className="field">…or a contract worker / visitor<input name="injured_other" maxLength={160} /></label>
          <label className="field">Injury<input name="injury_nature" maxLength={300} placeholder="e.g. cut on the left index finger" /></label>
          <label className="field">Days lost <span className="help">lost-time injury</span><input name="days_lost" inputMode="numeric" defaultValue="0" /></label>
          <label className="field">How bad could it have been<select name="potential" defaultValue="3">{POTENTIAL.slice(1).map((l, i) => <option key={l} value={i + 1}>{i + 1} — {l}</option>)}</select></label>
          <label className="field">Photo <span className="help">optional, up to 5 MB</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
        </ActionForm>
      </div>
    </AppShell>
  );
}
