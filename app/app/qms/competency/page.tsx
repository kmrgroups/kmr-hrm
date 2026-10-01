import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { p } from "@/lib/base-path";
import { COMP_CATEGORIES, COMP_LEVELS, competencyCoverage, competencyGaps } from "@/lib/qms/rules";
import { QmsTabs, Clause } from "../ui";
import { LevelGrid } from "../LevelGrid";
import { people, positions } from "../data";
import { saveCompetency, saveLevels } from "../actions";

export const metadata = { title: "Competency mapping" };

export default async function CompetencyPage({ searchParams }: { searchParams: Promise<{ pos?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { pos: posQ } = await searchParams;
  const db = await createClient();
  const [ppl, posAll, { data: comps }, { data: req }, assessed] = await Promise.all([
    people(db), positions(db),
    db.from("competencies").select("id,name,category,description,active,sample").order("category").order("name"),
    db.from("role_competencies").select("position_id,competency_id,required_level").not("position_id", "is", null),
    fetchAll<{ employee_id: string; competency_id: string; level: number; assessed_on: string; assessed_by_name: string | null }>((a, b) =>
      db.from("employee_competencies").select("employee_id,competency_id,level,assessed_on,assessed_by_name").range(a, b)),
  ]);
  const requirements = (req ?? []) as { position_id: string; competency_id: string; required_level: number }[];
  const used = posAll.filter((x) => requirements.some((r) => r.position_id === x.id) || ppl.some((e) => e.position_id === x.id));
  const pos = used.find((x) => x.id === posQ) ?? used[0];
  const roleReq = requirements.filter((r) => r.position_id === pos?.id).sort((a, b) => b.required_level - a.required_level);
  const team = ppl.filter((e) => e.position_id === pos?.id);
  const values: Record<string, number> = {};
  for (const a of assessed) values[`${a.employee_id}|${a.competency_id}`] = a.level;
  const gaps = competencyGaps(team, requirements, assessed);
  const name = (id: string) => comps?.find((c) => c.id === id)?.name ?? "—";

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Competency mapping <Clause>IATF 7.2.1 · ISO 9001 7.2</Clause></h1>
        <p>Each person holding a position, assessed against the competency levels in the position&apos;s R&amp;R sheet. Gaps become training needs.</p></div>
        {pos && <a className="btn secondary" target="_blank" rel="noreferrer" href={p(`/api/qms/sheet?kind=mapping&position=${pos.id}`)}>Competency mapping sheet (PDF)</a>}</div>
      <QmsTabs active="competency" hr={hr} />

      <div className="tabs" style={{ marginBottom: 12 }}>{used.map((x) => {
        const t = ppl.filter((e) => e.position_id === x.id);
        return <a key={x.id} className={x.id === pos?.id ? "active" : ""} href={p(`/app/qms/competency?pos=${x.id}`)}>{x.title}{x.role ? <span className="muted"> · {x.role}</span> : null} <span className="muted">({competencyCoverage(t, requirements, assessed)}%)</span></a>;
      })}</div>

      {!pos ? <div className="card"><Empty>No positions with competencies yet. They come from the R&amp;R sheet of each position (QMS › Positions &amp; R&amp;R).</Empty></div> : (
        <>
          <div className="card">
            <h2><span>{pos.title}{pos.role ? ` — ${pos.role}` : ""}{pos.department ? ` (${pos.department})` : ""}</span> <a style={{ fontSize: 13, fontWeight: 400 }} href={p(`/app/qms/positions/${pos.id}`)}>R&amp;R sheet ›</a></h2>
            {!roleReq.length ? <Empty>The position&apos;s R&amp;R sheet has no competencies yet.</Empty>
              : !team.length ? <Empty>Nobody holds this position yet — give it on the position&apos;s page or on the employee&apos;s record.</Empty> : (
                <>
                  <LevelGrid kind="competency" action={saveLevels} labels={COMP_LEVELS} values={values}
                    rows={team.map((e) => ({ id: e.id, label: e.name, sub: [e.code, e.designation].filter(Boolean).join(" · ") }))}
                    cols={roleReq.map((r) => ({ id: r.competency_id, label: name(r.competency_id), required: r.required_level }))} />
                  <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Levels: {COMP_LEVELS.map((l, i) => `${i} ${l}`).join(" · ")}. Red cells are below the position&apos;s need.</p>
                </>)}
          </div>

          <div className="card">
            <h2>Gaps ({gaps.length}){gaps.length > 0 && hr && <a className="btn secondary small" href={p("/app/qms/needs")}>Turn gaps into training needs ›</a>}</h2>
            {!gaps.length ? <Empty>No gaps: everyone meets the position&apos;s needs.</Empty> : (
              <div className="tablewrap" style={{ border: 0 }}><table>
                <thead><tr><th>Name</th><th>Designation</th><th>Competency</th><th className="num">Has</th><th className="num">Needs</th></tr></thead>
                <tbody>{gaps.sort((a, b) => b.gap - a.gap).map((g) => { const e = team.find((x) => x.id === g.employee_id); return <tr key={`${g.employee_id}${g.competency_id}`}>
                  <td>{e?.name}</td><td className="muted">{e?.designation ?? "—"}</td><td>{name(g.competency_id)}</td><td className="num">{g.actual}</td><td className="num"><b>{g.required}</b></td></tr>; })}</tbody>
              </table></div>)}
          </div>
        </>
      )}

      {hr && (
        <div className="grid two">
          <div className="card">
            <h2>Add a competency</h2>
            <ActionForm action={saveCompetency} submitLabel="Add" className="formgrid" resetOnSuccess>
              <label className="field full">Competency<input name="name" required maxLength={120} placeholder="e.g. Welding (MIG) to WPS" /></label>
              <label className="field">Category<select name="category" defaultValue="technical">{Object.entries(COMP_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field full">What it means<input name="description" maxLength={600} placeholder="What a person at level 3 can do" /></label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>Competency library ({comps?.length ?? 0})</h2>
            <div className="stack" style={{ gap: 6 }}>{(comps ?? []).map((c) => (
              <details key={c.id}><summary>{c.name} <span className="muted">· {COMP_CATEGORIES[c.category]}</span>{!c.active && <span className="badge" style={{ marginLeft: 6 }}>not used</span>}</summary>
                <ActionForm action={saveCompetency} submitLabel="Save" className="formgrid" hidden={{ id: c.id }}>
                  <label className="field full">Competency<input name="name" required maxLength={120} defaultValue={c.name} /></label>
                  <label className="field">Category<select name="category" defaultValue={c.category}>{Object.entries(COMP_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="field full">What it means<input name="description" maxLength={600} defaultValue={c.description ?? ""} /></label>
                  <label className="field full check"><input type="checkbox" name="inactive" defaultChecked={!c.active} /> Not used any more</label>
                </ActionForm></details>))}</div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
