import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { coverage, SKILL_LEVELS } from "@/lib/qms/rules";
import { QmsTabs, Clause, LevelPie } from "../ui";
import { LevelGrid } from "../LevelGrid";
import { people, qmsSettings, masters } from "../data";
import { saveLevels, saveOperation } from "../actions";

export const metadata = { title: "Skill matrix" };

export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ line?: string; dept?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { line: lineQ, dept } = await searchParams;
  const db = await createClient();
  const today = istToday();
  const [ppl, st, m, { data: opsAll }, skills] = await Promise.all([
    people(db), qmsSettings(db), masters(db),
    db.from("operations").select("id,plant_id,line,code,name,machine,critical,min_qualified,safety_required,sort_order,active,sample").order("line").order("sort_order").order("code"),
    fetchAll<{ employee_id: string; operation_id: string; level: number; valid_until: string | null }>((a, b) => db.from("skill_levels").select("employee_id,operation_id,level,valid_until").range(a, b)),
  ]);
  const ops = (opsAll ?? []).filter((o) => o.active);
  const lines = [...new Set(ops.map((o) => o.line))];
  const line = lineQ && lines.includes(lineQ) ? lineQ : lines[0];
  const lineOps = ops.filter((o) => o.line === line);
  const cov = coverage(lineOps, skills, st.min_qualified, today);
  const onLine = new Set(skills.filter((s) => lineOps.some((o) => o.id === s.operation_id)).map((s) => s.employee_id));
  const rows = ppl.filter((e) => onLine.has(e.id) || (dept && e.department_id === dept));
  const values: Record<string, number> = {}, expired: Record<string, boolean> = {};
  for (const s of skills) { values[`${s.employee_id}|${s.operation_id}`] = s.level; if (s.level >= 3 && s.valid_until && s.valid_until < today) expired[`${s.employee_id}|${s.operation_id}`] = true; }

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Skill matrix <Clause>IATF 7.2.1, 7.2.3</Clause></h1>
        <p>Who can work on which operation. Tap a circle to change a level; levels 3 and 4 count as qualified (for a year, then re-certification).</p></div></div>
      <QmsTabs active="skills" hr={hr} />

      {!ops.length ? (
        <div className="card"><Empty>No operations yet.{hr ? " Add the lines and operations below (e.g. Turning cell 1 · OP10 · CNC turning)." : " HR adds the lines and operations."}</Empty></div>
      ) : (
        <>
          <div className="tabs" style={{ marginBottom: 12 }}>{lines.map((l) => <a key={l} className={l === line ? "active" : ""} href={p(`/app/qms/skills?line=${encodeURIComponent(l)}`)}>{l}</a>)}</div>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>{SKILL_LEVELS.map((l) => <span key={l.level} title={l.hint}><LevelPie level={l.level} size={18} /> {l.level} {l.label}</span>)}
                <span><LevelPie level={3} size={18} expired /> re-certification overdue</span></div>
              <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="hidden" name="line" value={line} />
                <select name="dept" defaultValue={dept ?? ""} aria-label="Add people of a department"><option value="">People on this line</option>
                  {m.departments.map((d) => <option key={d.id} value={d.id}>+ everyone in {d.name}</option>)}</select>
                <button className="btn secondary small">Show</button>
              </form>
            </div>
            {!rows.length ? <Empty>Nobody has a level on this line yet. Choose a department above to add its people.</Empty> : (
              <LevelGrid kind="skill" action={saveLevels} labels={SKILL_LEVELS.map((l) => l.label)} values={values} expired={expired}
                rows={rows.map((e) => ({ id: e.id, label: e.name, sub: [e.code, e.designation, e.employment_type === "contract" ? "contract" : null].filter(Boolean).join(" · ") }))}
                cols={lineOps.map((o) => { const c = cov.find((x) => x.operation_id === o.id)!; return { id: o.id, label: o.code, sub: `${o.name}${o.machine ? ` — ${o.machine}` : ""}`,
                  flag: `${c.qualified}/${c.min} qualified` + (c.alert ? " ⚠" : "") }; })} />
            )}
          </div>

          <div className="card">
            <h2>Coverage of {line}</h2>
            <div className="tablewrap" style={{ border: 0 }}><table>
              <thead><tr><th>Operation</th><th className="num">Qualified</th><th className="num">Needed</th><th className="num">Trainers</th><th className="num">Learning</th><th>Status</th></tr></thead>
              <tbody>{lineOps.map((o) => { const c = cov.find((x) => x.operation_id === o.id)!; return (
                <tr key={o.id}><td><b>{o.code}</b> {o.name}{o.critical && <span className="badge danger" style={{ marginLeft: 6 }}>critical</span>}{o.safety_required && <span className="badge warn" style={{ marginLeft: 6 }}>safety training</span>}
                  {o.machine && <div className="muted" style={{ fontSize: 12 }}>{o.machine}</div>}</td>
                  <td className="num"><b>{c.qualified}</b></td><td className="num">{c.min}</td><td className="num">{c.trainers}</td><td className="num">{c.inTraining}</td>
                  <td>{c.alert ? <span className={`badge ${c.qualified === 0 ? "danger" : "warn"}`}>{c.alert}</span> : <span className="badge ok">Covered</span>}</td></tr>); })}</tbody>
            </table></div>
          </div>
        </>
      )}

      {hr && (
        <div className="grid two">
          <div className="card">
            <h2>Add an operation</h2>
            <ActionForm action={saveOperation} submitLabel="Add" className="formgrid" resetOnSuccess>
              <label className="field">Line / cell / area<input name="line" required maxLength={80} defaultValue={line} list="qms-lines" placeholder="Turning cell 1" /></label>
              <datalist id="qms-lines">{lines.map((l) => <option key={l} value={l} />)}</datalist>
              <label className="field">Operation code<input name="code" required maxLength={20} placeholder="OP10" /></label>
              <label className="field full">Operation<input name="name" required maxLength={120} placeholder="CNC turning — 1st setup" /></label>
              <label className="field">Machine<input name="machine" maxLength={80} placeholder="LT-01" /></label>
              <label className="field">Plant<select name="plant_id" defaultValue=""><option value="">—</option>{m.plants.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</select></label>
              <label className="field">Qualified people needed<input name="min_qualified" inputMode="numeric" placeholder={`${st.min_qualified} (company setting)`} /></label>
              <label className="field">Order<input name="sort_order" inputMode="numeric" placeholder="10" /></label>
              <label className="field full check"><input type="checkbox" name="critical" /> Critical (special / safety characteristic)</label>
              <label className="field full check"><input type="checkbox" name="safety_required" /> Safety training needed before working here</label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>Operations</h2>
            {!(opsAll ?? []).length ? <Empty>None yet.</Empty> : (
              <div className="stack" style={{ gap: 6 }}>{(opsAll ?? []).map((o) => (
                <details key={o.id}><summary><b>{o.line}</b> · {o.code} {o.name}{!o.active && <span className="badge" style={{ marginLeft: 6 }}>not used</span>}{o.sample && <span className="badge" style={{ marginLeft: 6 }}>Sample</span>}</summary>
                  <ActionForm action={saveOperation} submitLabel="Save" className="formgrid" hidden={{ id: o.id }}>
                    <label className="field">Line<input name="line" required defaultValue={o.line} maxLength={80} /></label>
                    <label className="field">Code<input name="code" required defaultValue={o.code} maxLength={20} /></label>
                    <label className="field full">Operation<input name="name" required defaultValue={o.name} maxLength={120} /></label>
                    <label className="field">Machine<input name="machine" defaultValue={o.machine ?? ""} maxLength={80} /></label>
                    <label className="field">Plant<select name="plant_id" defaultValue={o.plant_id ?? ""}><option value="">—</option>{m.plants.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</select></label>
                    <label className="field">Qualified needed<input name="min_qualified" inputMode="numeric" defaultValue={o.min_qualified ?? ""} /></label>
                    <label className="field">Order<input name="sort_order" inputMode="numeric" defaultValue={o.sort_order} /></label>
                    <label className="field full check"><input type="checkbox" name="critical" defaultChecked={o.critical} /> Critical</label>
                    <label className="field full check"><input type="checkbox" name="safety_required" defaultChecked={o.safety_required} /> Safety training needed</label>
                    <label className="field full check"><input type="checkbox" name="inactive" defaultChecked={!o.active} /> Not used any more</label>
                  </ActionForm>
                </details>))}</div>)}
          </div>
        </div>
      )}
    </AppShell>
  );
}
