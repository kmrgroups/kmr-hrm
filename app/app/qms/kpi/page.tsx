import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { addMonths, kpiAchievement, kpiScore } from "@/lib/qms/rules";
import { QmsTabs, Clause, monthLabel } from "../ui";
import { people, masters } from "../data";
import { saveKpi, saveKpiValues } from "../actions";

export const metadata = { title: "KPIs" };
type Kpi = { id: string; designation_id: string | null; department_id: string | null; name: string; unit: string | null; target: number; direction: "higher" | "lower"; frequency: string; data_source: string | null; weight: number; active: boolean; sample: boolean };

export default async function KpiPage({ searchParams }: { searchParams: Promise<{ m?: string; d?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? "") ? sp.m! : addMonths(istToday().slice(0, 7), -1);
  const db = await createClient();
  const [ppl, mm, { data: kpisAll }, vals] = await Promise.all([
    people(db), masters(db),
    db.from("kpis").select("*").order("name"),
    fetchAll<{ kpi_id: string; employee_id: string; actual: number }>((a, b) => db.from("kpi_values").select("kpi_id,employee_id,actual").eq("month", month).range(a, b)),
  ]);
  const kpis = ((kpisAll ?? []) as Kpi[]);
  const active = kpis.filter((k) => k.active);
  const desigs = mm.designations.filter((d) => active.some((k) => k.designation_id === d.id));
  const desig = desigs.find((d) => d.id === sp.d) ?? desigs[0];
  const kOf = (e: { designation_id: string | null; department_id: string | null }) => active.filter((k) => (k.designation_id ? k.designation_id === e.designation_id : true) && (k.department_id ? k.department_id === e.department_id : true) && (k.designation_id || k.department_id));
  const val = (k: string, e: string) => vals.find((v) => v.kpi_id === k && v.employee_id === e)?.actual;
  const score = (e: (typeof ppl)[number]) => kpiScore(kOf(e).filter((k) => val(k.id, e.id) != null).map((k) => ({ achievement: kpiAchievement(Number(k.target), Number(val(k.id, e.id)), k.direction), weight: k.weight })));
  const team = desig ? ppl.filter((e) => e.designation_id === desig.id) : [];
  const cols = desig ? active.filter((k) => k.designation_id === desig.id) : [];
  const roll = (key: "department" | "plant") => {
    const g = new Map<string, number[]>();
    for (const e of ppl) { const s = score(e); if (s == null) continue; const k = e[key] ?? "—"; g.set(k, [...(g.get(k) ?? []), s]); }
    return [...g.entries()].map(([k, a]) => [k, Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10, a.length] as const).sort((a, b) => b[1] - a[1]);
  };
  const tone = (s: number | null) => (s == null ? "" : s >= 95 ? "ok" : s >= 80 ? "warn" : "danger");
  const Fields = ({ k }: { k?: Kpi }) => (<>
    <label className="field full">KPI<input name="name" required maxLength={120} defaultValue={k?.name ?? ""} placeholder="Rejection" /></label>
    <label className="field">For designation<select name="designation_id" defaultValue={k?.designation_id ?? ""}><option value="">—</option>{mm.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="field">…and / or department<select name="department_id" defaultValue={k?.department_id ?? ""}><option value="">—</option>{mm.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="field">Target<input name="target" required inputMode="decimal" defaultValue={k?.target ?? ""} /></label>
    <label className="field">Unit<input name="unit" maxLength={20} defaultValue={k?.unit ?? ""} placeholder="%, PPM, parts" /></label>
    <label className="field">Better when<select name="direction" defaultValue={k?.direction ?? "higher"}><option value="higher">Higher</option><option value="lower">Lower</option></select></label>
    <label className="field">Weight<select name="weight" defaultValue={String(k?.weight ?? 1)}>{[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
    <label className="field">Frequency<select name="frequency" defaultValue={k?.frequency ?? "monthly"}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>
    <label className="field">Data from<input name="data_source" maxLength={200} defaultValue={k?.data_source ?? ""} placeholder="Rejection register" /></label>
  </>);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>KPIs — {monthLabel(month)} <Clause>ISO 9001 6.2, 9.1</Clause></h1>
        <p>Each role&apos;s KPIs with targets; monthly values per person, scored against the target and rolled up by department and plant.</p></div>
        <div style={{ display: "flex", gap: 6 }}><a className="btn secondary small" href={p(`/app/qms/kpi?m=${addMonths(month, -1)}${desig ? `&d=${desig.id}` : ""}`)}>‹ {monthLabel(addMonths(month, -1))}</a>
          <a className="btn secondary small" href={p(`/app/qms/kpi?m=${addMonths(month, 1)}${desig ? `&d=${desig.id}` : ""}`)}>{monthLabel(addMonths(month, 1))} ›</a></div></div>
      <QmsTabs active="kpi" hr={hr} />

      {!desigs.length ? <div className="card"><Empty>No KPIs set yet.{hr ? " Add them below." : ""}</Empty></div> : (<>
        <div className="tabs" style={{ marginBottom: 12 }}>{desigs.map((d) => <a key={d.id} className={d.id === desig?.id ? "active" : ""} href={p(`/app/qms/kpi?m=${month}&d=${d.id}`)}>{d.name}</a>)}</div>
        <div className="card">
          <h2>{desig?.name}: values for {monthLabel(month)}</h2>
          {!team.length ? <Empty>Nobody holds this designation.</Empty> : (
            <ActionForm action={saveKpiValues} submitLabel="Save the values" hidden={{ month }}>
              <div className="tablewrap" style={{ border: 0 }}><table>
                <thead><tr><th>Person</th>{cols.map((k) => <th key={k.id} className="num">{k.name}<div className="muted" style={{ fontWeight: 400, fontSize: 11 }}>target {k.direction === "lower" ? "≤" : "≥"} {Number(k.target)} {k.unit}</div></th>)}<th className="num">Score</th></tr></thead>
                <tbody>{team.map((e) => { const s = score(e); return (
                  <tr key={e.id}><td><b>{e.name}</b><div className="muted" style={{ fontSize: 12 }}>{[e.code, e.department].filter(Boolean).join(" · ")}</div></td>
                    {cols.map((k) => { const v = val(k.id, e.id); const a = v != null ? kpiAchievement(Number(k.target), Number(v), k.direction) : null; return (
                      <td key={k.id} className="num"><input name={`v_${k.id}_${e.id}`} inputMode="decimal" defaultValue={v ?? ""} style={{ width: 84, textAlign: "right" }} aria-label={`${e.name} ${k.name}`} />
                        {a != null && <div style={{ fontSize: 11 }} className={a < 80 ? "bad" : "muted"}>{a}%</div>}</td>); })}
                    <td className="num">{s != null ? <span className={`badge ${tone(s)}`}>{s}</span> : "—"}</td></tr>); })}</tbody>
              </table></div>
            </ActionForm>)}
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Score = the KPIs&apos; achievement against target, weighted (100 = on target; capped at 120). Leave a box empty for “not measured”.</p>
        </div>
        <div className="grid two">
          {(["department", "plant"] as const).map((key) => { const r = roll(key); return (
            <div className="card" key={key}><h2>By {key} — {monthLabel(month)}</h2>
              {!r.length ? <Empty>No values for this month.</Empty> : <table><tbody>{r.map(([k, s, n]) => <tr key={k}><td>{k}</td><td className="muted">{n} people</td><td className="num"><span className={`badge ${tone(s)}`}>{s}</span></td></tr>)}</tbody></table>}</div>); })}
        </div>
      </>)}

      {hr && (
        <div className="card">
          <h2>KPI list</h2>
          <div className="stack" style={{ gap: 6, marginBottom: 12 }}>{kpis.map((k) => (
            <details key={k.id}><summary>{k.name} <span className="muted">· {mm.designations.find((d) => d.id === k.designation_id)?.name ?? mm.departments.find((d) => d.id === k.department_id)?.name} · target {k.direction === "lower" ? "≤" : "≥"} {Number(k.target)} {k.unit} · weight {k.weight}</span>
              {k.sample && <span className="badge" style={{ marginLeft: 6 }}>Sample</span>}{!k.active && <span className="badge" style={{ marginLeft: 6 }}>not used</span>}</summary>
              <ActionForm action={saveKpi} submitLabel="Save" className="formgrid" hidden={{ id: k.id }}><Fields k={k} />
                <label className="field full check"><input type="checkbox" name="inactive" defaultChecked={!k.active} /> Not used any more</label></ActionForm></details>))}</div>
          <details><summary className="btn secondary small">Add a KPI</summary><ActionForm action={saveKpi} submitLabel="Add" className="formgrid" resetOnSuccess><Fields /></ActionForm></details>
        </div>
      )}
    </AppShell>
  );
}
