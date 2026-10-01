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
import { people, masters } from "../data";
import { saveCompetency, saveLevels, saveRequirements } from "../actions";

export const metadata = { title: "Competency mapping" };

export default async function CompetencyPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { d } = await searchParams;
  const db = await createClient();
  const [ppl, m, { data: comps }, { data: req }, assessed] = await Promise.all([
    people(db), masters(db),
    db.from("competencies").select("id,name,category,description,active,sample").order("category").order("name"),
    db.from("role_competencies").select("designation_id,competency_id,required_level"),
    fetchAll<{ employee_id: string; competency_id: string; level: number; assessed_on: string; assessed_by_name: string | null }>((a, b) =>
      db.from("employee_competencies").select("employee_id,competency_id,level,assessed_on,assessed_by_name").range(a, b)),
  ]);
  const requirements = req ?? [];
  const used = m.designations.filter((x) => ppl.some((e) => e.designation_id === x.id) || requirements.some((r) => r.designation_id === x.id));
  const desig = (d && m.designations.find((x) => x.id === d)) || used[0] || m.designations[0];
  const roleReq = requirements.filter((r) => r.designation_id === desig?.id);
  const team = ppl.filter((e) => e.designation_id === desig?.id);
  const values: Record<string, number> = {};
  for (const a of assessed) values[`${a.employee_id}|${a.competency_id}`] = a.level;
  const gaps = competencyGaps(team, requirements, assessed);
  const name = (id: string) => comps?.find((c) => c.id === id)?.name ?? "—";
  const activeComps = (comps ?? []).filter((c) => c.active);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Competency mapping <Clause>IATF 7.2.1 · ISO 9001 7.2</Clause></h1>
        <p>The level each role needs, against each person&apos;s assessed level. Gaps become training needs.</p></div></div>
      <QmsTabs active="competency" hr={hr} />

      <div className="tabs" style={{ marginBottom: 12 }}>{used.map((x) => {
        const t = ppl.filter((e) => e.designation_id === x.id);
        return <a key={x.id} className={x.id === desig?.id ? "active" : ""} href={p(`/app/qms/competency?d=${x.id}`)}>{x.name} <span className="muted">({competencyCoverage(t, requirements, assessed)}%)</span></a>;
      })}</div>

      {!desig ? <div className="card"><Empty>Add designations under Plants &amp; departments first.</Empty></div> : (
        <>
          <div className="card">
            <h2>{desig.name}: people against the role&apos;s needs</h2>
            {!roleReq.length ? <Empty>No competencies set for {desig.name} yet.{hr ? " Set them below." : ""}</Empty>
              : !team.length ? <Empty>Nobody holds this designation at present.</Empty> : (
                <>
                  <LevelGrid kind="competency" action={saveLevels} labels={COMP_LEVELS} values={values}
                    rows={team.map((e) => ({ id: e.id, label: e.name, sub: [e.code, e.department].filter(Boolean).join(" · ") }))}
                    cols={roleReq.map((r) => ({ id: r.competency_id, label: name(r.competency_id), required: r.required_level }))} />
                  <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Levels: {COMP_LEVELS.map((l, i) => `${i} ${l}`).join(" · ")}. Red cells are below the role&apos;s need.</p>
                </>)}
          </div>

          <div className="grid two">
            <div className="card">
              <h2>Gaps ({gaps.length})</h2>
              {!gaps.length ? <Empty>No gaps: everyone meets the role&apos;s needs.</Empty> : (
                <div className="tablewrap" style={{ border: 0 }}><table>
                  <thead><tr><th>Person</th><th>Competency</th><th className="num">Has</th><th className="num">Needs</th></tr></thead>
                  <tbody>{gaps.sort((a, b) => b.gap - a.gap).map((g) => <tr key={`${g.employee_id}${g.competency_id}`}>
                    <td>{team.find((e) => e.id === g.employee_id)?.name}</td><td>{name(g.competency_id)}</td><td className="num">{g.actual}</td><td className="num"><b>{g.required}</b></td></tr>)}</tbody>
                </table></div>)}
              {gaps.length > 0 && hr && <p className="muted" style={{ marginBottom: 0 }}>On <a href={p("/app/qms/needs")}>Training needs</a>, “Find training needs” turns gaps into needs with the right programme.</p>}
            </div>
            {hr && (
              <div className="card">
                <h2>What {desig.name} needs</h2>
                <ActionForm action={saveRequirements} submitLabel="Save the requirements" hidden={{ designation_id: desig.id }}>
                  {Object.entries(COMP_CATEGORIES).map(([cat, label]) => {
                    const list = activeComps.filter((c) => c.category === cat);
                    if (!list.length) return null;
                    return (<fieldset key={cat} className="reqset"><legend>{label}</legend>
                      {list.map((c) => { const cur = roleReq.find((r) => r.competency_id === c.id)?.required_level ?? 0; return (
                        <label key={c.id} className="reqrow"><span title={c.description ?? ""}>{c.name}</span>
                          <select name={`req_${c.id}`} defaultValue={String(cur)}><option value="0">Not needed</option>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>{l} — {COMP_LEVELS[l]}</option>)}</select></label>); })}
                    </fieldset>);
                  })}
                </ActionForm>
              </div>)}
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
