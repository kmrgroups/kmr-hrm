import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { addMonths, kpiAchievement, kpiScore } from "@/lib/qms/rules";
import { FREQUENCIES } from "@/lib/qms/kpi-catalog";
import { QmsTabs, Clause, monthLabel } from "../ui";
import { people, positions } from "../data";
import { saveKpiValues } from "../actions";

export const metadata = { title: "KPI sheets" };
type Kpi = { id: string; position_id: string; name: string; unit: string | null; target: number | null; direction: "higher" | "lower"; frequency: string; review_method: string | null; data_source: string | null; weight: number };

export default async function KpiPage({ searchParams }: { searchParams: Promise<{ m?: string; pos?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? "") ? sp.m! : addMonths(istToday().slice(0, 7), -1);
  const db = await createClient();
  const [ppl, posAll, { data: kpisAll }, vals] = await Promise.all([
    people(db), positions(db),
    db.from("kpis").select("id,position_id,name,unit,target,direction,frequency,review_method,data_source,weight").eq("active", true).not("position_id", "is", null).order("sort_order"),
    fetchAll<{ kpi_id: string; employee_id: string; actual: number }>((a, b) => db.from("kpi_values").select("kpi_id,employee_id,actual").eq("month", month).range(a, b)),
  ]);
  const kpis = (kpisAll ?? []) as Kpi[];
  const used = posAll.filter((x) => kpis.some((k) => k.position_id === x.id));
  const pos = used.find((x) => x.id === sp.pos) ?? used[0];
  const cols = kpis.filter((k) => k.position_id === pos?.id);
  const team = ppl.filter((e) => e.position_id === pos?.id);
  const val = (k: string, e: string) => vals.find((v) => v.kpi_id === k && v.employee_id === e)?.actual;
  const scoreOf = (e: { id: string; position_id: string | null }) => kpiScore(kpis.filter((k) => k.position_id === e.position_id && k.target != null && val(k.id, e.id) != null)
    .map((k) => ({ achievement: kpiAchievement(Number(k.target), Number(val(k.id, e.id)), k.direction), weight: k.weight })));
  const roll = (key: "department" | "plant") => {
    const g = new Map<string, number[]>();
    for (const e of ppl) { const s = scoreOf(e); if (s == null) continue; const k = e[key] ?? "—"; g.set(k, [...(g.get(k) ?? []), s]); }
    return [...g.entries()].map(([k, a]) => [k, Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10, a.length] as const).sort((a, b) => b[1] - a[1]);
  };
  const tone = (s: number | null) => (s == null ? "" : s >= 95 ? "ok" : s >= 80 ? "warn" : "danger");
  const nav = (m: string) => p(`/app/qms/kpi?m=${m}${pos ? `&pos=${pos.id}` : ""}`);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>KPI sheets — {monthLabel(month)} <Clause>ISO 9001 6.2, 9.1.1</Clause></h1>
        <p>Each person&apos;s KPIs come from his position&apos;s R&amp;R sheet: KPI, target, frequency of review, review method — and the actual, entered here.</p></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><a className="btn secondary small" href={nav(addMonths(month, -1))}>‹ {monthLabel(addMonths(month, -1))}</a>
          <a className="btn secondary small" href={nav(addMonths(month, 1))}>{monthLabel(addMonths(month, 1))} ›</a>
          {pos && <a className="btn secondary small" target="_blank" rel="noreferrer" href={p(`/api/qms/sheet?kind=kpi&position=${pos.id}&month=${month}`)}>KPI sheets (PDF)</a>}</div></div>
      <QmsTabs active="kpi" hr={hr} />

      {!used.length ? <div className="card"><Empty>No KPIs yet. They come from each position&apos;s R&amp;R sheet (QMS › Positions &amp; R&amp;R).</Empty></div> : (<>
        <div className="tabs" style={{ marginBottom: 12 }}>{used.map((x) => <a key={x.id} className={x.id === pos?.id ? "active" : ""} href={p(`/app/qms/kpi?m=${month}&pos=${x.id}`)}>{x.title}{x.role ? <span className="muted"> · {x.role}</span> : null}</a>)}</div>
        <div className="card">
          <h2><span>{pos?.title}: the position&apos;s KPIs</span> <a style={{ fontSize: 13, fontWeight: 400 }} href={p(`/app/qms/positions/${pos?.id}`)}>change them on the R&amp;R sheet ›</a></h2>
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>KPI</th><th>Target</th><th>Frequency of review</th><th>Review method</th><th>Data from</th></tr></thead>
            <tbody>{cols.map((k) => <tr key={k.id}><td><b>{k.name}</b></td><td>{k.target != null ? `${k.direction === "lower" ? "≤" : "≥"} ${Number(k.target)} ${k.unit ?? ""}` : <span className="badge warn">to be set</span>}</td>
              <td>{FREQUENCIES[k.frequency] ?? k.frequency}</td><td>{k.review_method ?? "—"}</td><td className="muted">{k.data_source ?? "—"}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Actuals for {monthLabel(month)}</h2>
          {!team.length ? <Empty>Nobody holds this position.</Empty> : (
            <ActionForm action={saveKpiValues} submitLabel="Save the actuals" hidden={{ month }}>
              <div className="tablewrap" style={{ border: 0 }}><table>
                <thead><tr><th>Name</th>{cols.map((k) => <th key={k.id} className="num">{k.name}<div className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{k.target != null ? `${k.direction === "lower" ? "≤" : "≥"} ${Number(k.target)} ${k.unit ?? ""}` : ""}</div></th>)}<th className="num">Score</th><th></th></tr></thead>
                <tbody>{team.map((e) => { const s = scoreOf(e); return (
                  <tr key={e.id}><td><b>{e.name}</b><div className="muted" style={{ fontSize: 12 }}>{[e.code, e.designation].filter(Boolean).join(" · ")}</div></td>
                    {cols.map((k) => { const v = val(k.id, e.id); const a = v != null && k.target != null ? kpiAchievement(Number(k.target), Number(v), k.direction) : null; return (
                      <td key={k.id} className="num"><input name={`v_${k.id}_${e.id}`} inputMode="decimal" defaultValue={v ?? ""} style={{ width: 84, textAlign: "right" }} aria-label={`${e.name} ${k.name}`} />
                        {a != null && <div style={{ fontSize: 11 }} className={a < 80 ? "bad" : "muted"}>{a}%</div>}</td>); })}
                    <td className="num">{s != null ? <span className={`badge ${tone(s)}`}>{s}</span> : "—"}</td>
                    <td><a target="_blank" rel="noreferrer" href={p(`/api/qms/sheet?kind=kpi&position=${pos!.id}&emp=${e.id}&month=${month}`)}>Sheet</a></td></tr>); })}</tbody>
              </table></div>
            </ActionForm>)}
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Score = achievement against the targets, weighted (100 = on target; capped at 120). Leave a box empty for “not measured”.</p>
        </div>
        <div className="grid two">
          {(["department", "plant"] as const).map((key) => { const r = roll(key); return (
            <div className="card" key={key}><h2>By {key} — {monthLabel(month)}</h2>
              {!r.length ? <Empty>No actuals for this month.</Empty> : <table><tbody>{r.map(([k, s, n]) => <tr key={k}><td>{k}</td><td className="muted">{n} people</td><td className="num"><span className={`badge ${tone(s)}`}>{s}</span></td></tr>)}</tbody></table>}</div>); })}
        </div>
      </>)}
    </AppShell>
  );
}
