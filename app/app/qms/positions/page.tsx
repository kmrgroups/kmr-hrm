import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { p } from "@/lib/base-path";
import { ROLE_SUGGESTIONS } from "@/lib/recruit/roles";
import { competencyGaps } from "@/lib/qms/rules";
import { QmsTabs, Clause } from "../ui";
import { people, masters, positions, type PersonRow } from "../data";
import { addPosition } from "../actions";

export const metadata = { title: "Positions & R&R" };

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { v } = await searchParams;
  const db = await createClient();
  const [ppl, m, pos, { data: jds }, { data: rrs }, { data: req }, assessed, { data: kpis }, { data: acks }] = await Promise.all([
    people(db), masters(db), positions(db),
    db.from("job_descriptions").select("position_id,version,status").not("position_id", "is", null),
    db.from("rr_roles").select("id,position_id,version,status").not("position_id", "is", null),
    db.from("role_competencies").select("position_id,competency_id,required_level").not("position_id", "is", null),
    fetchAll<{ employee_id: string; competency_id: string; level: number }>((a, b) => db.from("employee_competencies").select("employee_id,competency_id,level").range(a, b)),
    db.from("kpis").select("position_id").eq("active", true).not("position_id", "is", null),
    db.from("rr_acks").select("rr_id,employee_id,version"),
  ]);
  const unplaced = ppl.filter((e) => !e.position_id).length;
  const roles = [...new Set([...pos.map((x) => x.role).filter(Boolean) as string[], ...ROLE_SUGGESTIONS])];

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Positions &amp; R&amp;R <Clause>ISO 9001 5.3 · IATF 5.3.1, 7.2.1</Clause></h1>
        <p>A position is <b>Position + Role + Department</b> (e.g. Calibration Incharge · Calibration &amp; gauge control · Quality). Its job description, its sheet of roles, responsibilities,
          authority, competency and KPIs, and everybody&apos;s competency mapping and KPI sheet hang on it — never on a designation or a person.</p></div>
        <div className="tabs" style={{ border: 0, margin: 0 }}><a className={v !== "org" ? "active" : ""} href={p("/app/qms/positions")}>Positions</a><a className={v === "org" ? "active" : ""} href={p("/app/qms/positions?v=org")}>Org chart</a></div></div>
      <QmsTabs active="roles" hr={hr} />

      {v === "org" ? <OrgChart people={ppl} /> : (<>
        <div className="card">
          <div className="flowline">{["Requisition", "Job description", "R&R sheet", "Competency mapping", "KPI sheet", "Training needs", "Training calendar", "Attendance", "Effectiveness"].map((x, i) => <span key={x}>{i > 0 && <i>›</i>}{x}</span>)}</div>
          {!pos.length ? <Empty>No positions yet. A requisition creates its position; or add one below.</Empty> : (
            <div className="tablewrap" style={{ border: 0 }}><table>
              <thead><tr><th>Position</th><th>Role</th><th>Department</th><th>Job description</th><th>R&amp;R sheet</th><th className="num">Holders</th><th className="num">Gaps</th><th className="num">KPIs</th></tr></thead>
              <tbody>{pos.map((x) => {
                const jd = (jds ?? []).filter((j) => j.position_id === x.id).sort((a, b) => b.version - a.version);
                const ap = jd.find((j) => j.status === "approved"), dr = jd.find((j) => j.status === "draft");
                const rr = (rrs ?? []).find((r) => r.position_id === x.id);
                const holders = ppl.filter((e) => e.position_id === x.id);
                const gaps = competencyGaps(holders, (req ?? []) as { position_id: string; competency_id: string; required_level: number }[], assessed).length;
                const ackN = rr ? holders.filter((e) => (acks ?? []).some((a) => a.rr_id === rr.id && a.employee_id === e.id && a.version === rr.version)).length : 0;
                return (
                  <tr key={x.id} style={!x.active ? { opacity: 0.6 } : undefined}>
                    <td><a href={p(`/app/qms/positions/${x.id}`)}><b>{x.title}</b></a>{x.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}</td>
                    <td>{x.role ?? "—"}</td><td>{x.department ?? "—"}</td>
                    <td>{ap ? <span className="badge ok">v{ap.version} approved</span> : dr ? <span className="badge warn">v{dr.version} draft</span> : <span className="badge">none</span>}</td>
                    <td>{rr ? <span className={`badge ${rr.status === "approved" ? "ok" : "warn"}`}>v{rr.version} {rr.status}</span> : <span className="badge">not written</span>}
                      {rr?.status === "approved" && holders.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{ackN}/{holders.length} acknowledged</div>}</td>
                    <td className="num">{holders.length}</td>
                    <td className="num">{gaps ? <a href={p(`/app/qms/competency?pos=${x.id}`)} className="badge warn">{gaps}</a> : holders.length ? <span className="badge ok">0</span> : "—"}</td>
                    <td className="num">{(kpis ?? []).filter((k) => k.position_id === x.id).length}</td>
                  </tr>);
              })}</tbody>
            </table></div>)}
          {unplaced > 0 && <p className="muted" style={{ marginBottom: 0 }}>{unplaced} active employee{unplaced === 1 ? " has" : "s have"} no position yet — give it on the employee&apos;s record or on a position&apos;s page.</p>}
        </div>
        {hr && (
          <div className="card">
            <h2>Add a position</h2>
            <p className="muted" style={{ marginTop: 0 }}>Usually a requisition adds its position. Add one here for people already working, so their R&amp;R, competency mapping and KPIs can be kept.</p>
            <ActionForm action={addPosition} submitLabel="Add the position" className="formgrid">
              <label className="field">Position<input name="title" required maxLength={120} placeholder="e.g. Production Head" /></label>
              <label className="field">Role<input name="role" maxLength={160} list="pos-roles" placeholder="e.g. Shopfloor & manpower handling" /></label>
              <datalist id="pos-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
              <label className="field">Department<select name="department_id" required defaultValue=""><option value="" disabled>Choose…</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label className="field check"><input type="checkbox" name="write_jd" defaultChecked /> Write its job description now</label>
            </ActionForm>
          </div>)}
      </>)}
    </AppShell>
  );
}

function OrgChart({ people: ppl }: { people: PersonRow[] }) {
  const ids = new Set(ppl.map((e) => e.id));
  const roots = ppl.filter((e) => !e.reporting_manager_id || !ids.has(e.reporting_manager_id));
  const kids = (id: string) => ppl.filter((e) => e.reporting_manager_id === id);
  const Node = ({ e, depth }: { e: PersonRow; depth: number }): React.ReactElement => {
    const k = kids(e.id);
    return (<li><span className="orgnode"><b>{e.name}</b><small>{[e.designation, e.department].filter(Boolean).join(" · ")}</small></span>
      {k.length > 0 && depth < 8 && <ul>{k.map((c) => <Node key={c.id} e={c} depth={depth + 1} />)}</ul>}</li>);
  };
  return <div className="card"><h2>Org chart</h2><p className="muted" style={{ marginTop: 0 }}>From each employee&apos;s reporting manager.</p>
    {!ppl.length ? <Empty>No employees.</Empty> : <ul className="orgtree">{roots.map((e) => <Node key={e.id} e={e} depth={0} />)}</ul>}</div>;
}
