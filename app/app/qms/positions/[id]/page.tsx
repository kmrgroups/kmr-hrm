import { notFound } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { p } from "@/lib/base-path";
import { COMP_LEVELS, competencyGaps } from "@/lib/qms/rules";
import { FREQUENCIES } from "@/lib/qms/kpi-catalog";
import type { JdRow } from "@/lib/recruit/service";
import { approveJd, saveJd } from "@/app/app/recruitment/actions";
import { QmsTabs, Clause } from "../../ui";
import { people, personLabel } from "../../data";
import { approveSheet, rewriteSheet, savePositionSheet, setEmployeePosition } from "../../actions";

export const metadata = { title: "Position" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: pos } = await db.from("positions").select("*,department:departments(name)").eq("id", id).maybeSingle();
  if (!pos) notFound();
  const [ppl, { data: jds }, { data: rr }, { data: rc }, { data: kpis }, { data: lib }, { data: acks }] = await Promise.all([
    people(db),
    db.from("job_descriptions").select("*").eq("position_id", id).order("version", { ascending: false }),
    db.from("rr_roles").select("*").eq("position_id", id).maybeSingle(),
    db.from("role_competencies").select("competency_id,required_level,competency:competencies(name)").eq("position_id", id),
    db.from("kpis").select("*").eq("position_id", id).eq("active", true).order("sort_order"),
    db.from("competencies").select("name").eq("active", true).order("name"),
    db.from("rr_acks").select("employee_id,version,acknowledged_at"),
  ]);
  const holders = ppl.filter((e) => e.position_id === id);
  const assessed = holders.length ? await fetchAll<{ employee_id: string; competency_id: string; level: number }>((a, b) =>
    db.from("employee_competencies").select("employee_id,competency_id,level").in("employee_id", holders.map((h) => h.id)).range(a, b)) : [];
  const req = (rc ?? []).map((r) => ({ position_id: id, competency_id: r.competency_id, required_level: r.required_level, name: one(r.competency as unknown as { name: string } | null)?.name ?? "—" }))
    .sort((a, b) => b.required_level - a.required_level);
  const all = (jds ?? []) as (JdRow & { approved_at: string | null })[];
  const approved = all.find((j) => j.status === "approved"), draft = all.find((j) => j.status === "draft" && (!approved || j.version > approved.version));
  const jd = draft ?? approved;
  const dept = one(pos.department as unknown as { name: string } | null)?.name ?? null;
  const rrAcks = rr ? (acks ?? []).filter((a) => a.version === rr.version) : [];
  const pdf = (kind: string) => p(`/api/qms/sheet?kind=${kind}&position=${id}`);
  const compRows = [...req.map((r) => ({ name: r.name, level: r.required_level })), ...Array.from({ length: 4 }, () => ({ name: "", level: 0 }))];
  const kpiRows = [...(kpis ?? []), ...Array.from({ length: 3 }, () => null)];

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>{pos.title}{pos.sample && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>Sample</span>}</h1>
        <p><b>Role:</b> {pos.role ?? "—"} · <b>Department:</b> {dept ?? "—"} · {holders.length} {holders.length === 1 ? "person holds" : "people hold"} this position</p></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rr && <a className="btn secondary small" target="_blank" rel="noreferrer" href={pdf("rr")}>R&amp;R sheet (PDF)</a>}
          {req.length > 0 && <a className="btn secondary small" target="_blank" rel="noreferrer" href={pdf("mapping")}>Competency mapping (PDF)</a>}
          {(kpis ?? []).length > 0 && <a className="btn secondary small" target="_blank" rel="noreferrer" href={pdf("kpi")}>KPI sheets (PDF)</a>}
        </div></div>
      <QmsTabs active="roles" hr={hr} />

      {/* ---------- 1. job description ---------- */}
      <div className="card">
        <h2><span>1 · Job description {jd && <span className={`badge ${jd.status === "approved" ? "ok" : "warn"}`}>{jd.status === "approved" ? `Approved · v${jd.version}` : `Draft · v${jd.version}`}</span>}</span>
          {approved && draft && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>v{approved.version} is in use until the draft is approved</span>}</h2>
        {!jd ? <Empty>No job description yet. Raise a requisition for this position, or add the position again with “Write its job description now”.</Empty> : (
          <div className="stack">
            {jd.purpose && <p style={{ margin: 0 }}>{jd.purpose}</p>}
            <div className="grid two">
              <div><b>Responsibilities</b><ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>{jd.responsibilities.map((r) => <li key={r}>{r}</li>)}</ol></div>
              <div><b>Must-have competencies</b><div className="toolbar" style={{ margin: "6px 0 10px" }}>{jd.must_have.map((c) => <span key={c.name} className="chip">{c.name}{c.weight > 1 ? ` ×${c.weight}` : ""}</span>)}</div>
                <b>KPIs</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{jd.kpis.map((k) => <li key={k}>{k}</li>)}</ul>
                <p className="muted" style={{ fontSize: 13 }}>{[jd.qualifications, jd.experience, jd.reporting_to ? `reports to ${jd.reporting_to}` : null].filter(Boolean).join(" · ")}</p></div>
            </div>
            {hr && <>
              {jd.status !== "approved" && <ActionForm action={approveJd} submitLabel="Approve the job description" variant="accent" hidden={{ id: jd.id }} />}
              <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit the job description (add, change or delete lines)</summary>
                <ActionForm action={saveJd} submitLabel={jd.status === "approved" ? "Save as a new version" : "Save"} className="formgrid" hidden={{ id: jd.id }}>
                  <label className="field full">Title<input name="title" defaultValue={jd.title} maxLength={120} /></label>
                  <label className="field full">Purpose<textarea name="purpose" rows={3} defaultValue={jd.purpose ?? ""} /></label>
                  <label className="field full">Responsibilities (one per line)<textarea name="responsibilities" rows={8} defaultValue={jd.responsibilities.join("\n")} /></label>
                  <label className="field full">Must-have competencies (one per line; “| 3” very important, “| 1” less)<textarea name="must_have" rows={5} defaultValue={jd.must_have.map((c) => `${c.name} | ${c.weight}`).join("\n")} /></label>
                  <label className="field full">Good to have (one per line)<textarea name="good_to_have" rows={3} defaultValue={jd.good_to_have.map((c) => c.name).join("\n")} /></label>
                  <label className="field full">KPIs (one per line)<textarea name="kpis" rows={4} defaultValue={jd.kpis.join("\n")} /></label>
                  <label className="field full">Results the position must deliver (one per line)<textarea name="outcomes" rows={2} defaultValue={jd.outcomes.join("\n")} /></label>
                  <label className="field">Qualification<input name="qualifications" defaultValue={jd.qualifications ?? ""} /></label>
                  <label className="field">Experience<input name="experience" defaultValue={jd.experience ?? ""} /></label>
                  <label className="field">Reports to<input name="reporting_to" defaultValue={jd.reporting_to ?? ""} /></label>
                  <label className="field">Operating context<input name="context" defaultValue={jd.context ?? ""} /></label>
                </ActionForm></details>
            </>}
          </div>)}
      </div>

      {/* ---------- 2. R&R sheet ---------- */}
      <div className="card">
        <h2><span>2 · Roles, Responsibilities, Authority, Competency &amp; KPI <Clause>ISO 9001 5.3, 7.2, 9.1.1 · IATF 5.3.1</Clause></span>
          {rr && <span className={`badge ${rr.status === "approved" ? "ok" : "warn"}`}>{rr.doc_no ?? ""} · rev {rr.version} · {rr.status === "approved" ? `approved ${fmtDate(rr.approved_at)}` : "draft"}</span>}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Written from the approved job description; describes the position — no names, no designation. The landscape PDF carries your logo and the clause references.</p>
        {!rr ? (approved ? (hr ? <ActionForm action={rewriteSheet} submitLabel="Write the R&R sheet from the job description" variant="accent" hidden={{ position_id: id }} />
          : <Empty>HR writes the sheet.</Empty>) : <Empty>Approve the job description first — the sheet is written from it.</Empty>) : (
          <div className="rrsheet">
            {!hr ? (
              <div className="rrcols">
                <div><h3>Roles</h3><ul>{rr.roles.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
                <div><h3>Responsibilities</h3><ol>{rr.responsibilities.map((x: string) => <li key={x}>{x}</li>)}</ol></div>
                <div><h3>Authority</h3><ul>{rr.authorities.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
                <div><h3>Competency</h3><ul>{req.map((c) => <li key={c.competency_id}>{c.name} — L{c.required_level}</li>)}</ul></div>
                <div><h3>KPI</h3><ul>{(kpis ?? []).map((k) => <li key={k.id}>{k.name}: {k.target ?? "—"} {k.unit} · {FREQUENCIES[k.frequency]}</li>)}</ul></div>
              </div>) : (
              <ActionForm action={savePositionSheet} submitLabel={rr.status === "approved" ? "Save (becomes a new revision)" : "Save the sheet"} hidden={{ position_id: id }}>
                <label className="field">Purpose<input name="purpose" maxLength={1500} defaultValue={rr.purpose ?? ""} /></label>
                <div className="grid three">
                  <label className="field">Roles (one per line)<textarea name="roles" rows={6} defaultValue={rr.roles.join("\n")} /></label>
                  <label className="field">Responsibilities (one per line)<textarea name="responsibilities" rows={6} required defaultValue={rr.responsibilities.join("\n")} /></label>
                  <label className="field">Authority (one per line)<textarea name="authorities" rows={6} defaultValue={rr.authorities.join("\n")} /></label>
                </div>
                <label className="field">Works with — interfaces (one per line)<textarea name="interfaces" rows={2} defaultValue={(rr.interfaces ?? []).join("\n")} /></label>
                <h3 style={{ margin: "10px 0 4px" }}>Competency and the level the position needs</h3>
                <datalist id="lib-comps">{(lib ?? []).map((c) => <option key={c.name} value={c.name} />)}</datalist>
                <div className="tablewrap" style={{ border: 0 }}><table className="tight">
                  <thead><tr><th>Competency</th><th>Level needed</th></tr></thead>
                  <tbody>{compRows.map((c, i) => (
                    <tr key={i}><td><input name={`comp_name_${i}`} list="lib-comps" defaultValue={c.name} placeholder={i >= req.length ? "add a competency" : ""} style={{ width: "100%" }} /></td>
                      <td><select name={`comp_level_${i}`} defaultValue={String(c.level || 3)}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>{l} — {COMP_LEVELS[l]}</option>)}</select></td></tr>))}</tbody>
                </table></div>
                <p className="help" style={{ margin: 0 }}>Empty the name to remove a competency. A new name is added to the competency library.</p>
                <h3 style={{ margin: "10px 0 4px" }}>KPIs</h3>
                <div className="tablewrap" style={{ border: 0 }}><table className="tight">
                  <thead><tr><th>KPI</th><th>Unit</th><th>Target</th><th>Better</th><th>Frequency of review</th><th>Review method</th><th>Data from</th></tr></thead>
                  <tbody>{kpiRows.map((k, i) => (
                    <tr key={i}>
                      <td>{k && <input type="hidden" name={`kpi_id_${i}`} value={k.id} />}<input name={`kpi_name_${i}`} defaultValue={k?.name ?? ""} placeholder={k ? "" : "add a KPI"} style={{ minWidth: 160 }} /></td>
                      <td><input name={`kpi_unit_${i}`} defaultValue={k?.unit ?? ""} style={{ width: 70 }} /></td>
                      <td><input name={`kpi_target_${i}`} inputMode="decimal" defaultValue={k?.target ?? ""} style={{ width: 70 }} /></td>
                      <td><select name={`kpi_dir_${i}`} defaultValue={k?.direction ?? "higher"}><option value="higher">Higher</option><option value="lower">Lower</option></select></td>
                      <td><select name={`kpi_freq_${i}`} defaultValue={k?.frequency ?? "monthly"}>{Object.entries(FREQUENCIES).map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select></td>
                      <td><input name={`kpi_review_${i}`} defaultValue={k?.review_method ?? ""} style={{ minWidth: 180 }} /></td>
                      <td><input name={`kpi_source_${i}`} defaultValue={k?.data_source ?? ""} style={{ minWidth: 120 }} /></td>
                    </tr>))}</tbody>
                </table></div>
                <p className="help" style={{ margin: 0 }}>Empty the KPI name to stop using it (its past values are kept).</p>
              </ActionForm>)}
            {hr && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {rr.status !== "approved" && <ActionForm action={approveSheet} submitLabel="Approve and publish" variant="accent" className="inline" hidden={{ position_id: id }}
                confirm="Approve this sheet? The people holding the position are asked to acknowledge it." />}
              {approved && <ActionForm action={rewriteSheet} submitLabel="Write again from the job description" variant="secondary" className="inline" hidden={{ position_id: id }}
                confirm="Write the sheet again from the approved job description? Your changes to roles, responsibilities, authority, competencies and KPIs are replaced (KPI history is kept)." />}
              <a className="btn secondary" target="_blank" rel="noreferrer" href={pdf("rr")}>Open the landscape sheet (PDF)</a>
            </div>}
          </div>)}
      </div>

      {/* ---------- 3. people ---------- */}
      <div className="card">
        <h2>3 · People holding the position</h2>
        {!holders.length ? <Empty>Nobody yet. New joiners hired for this position get it automatically.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Name</th><th>Designation</th><th>R&amp;R acknowledged</th><th className="num">Competency gaps</th><th></th></tr></thead>
            <tbody>{holders.map((e) => { const ack = rrAcks.find((a) => a.employee_id === e.id); const g = competencyGaps([e], req, assessed).length; return (
              <tr key={e.id}><td><b>{e.name}</b> <span className="muted">{e.code}</span></td><td>{e.designation ?? "—"}</td>
                <td>{rr?.status !== "approved" ? <span className="muted">—</span> : ack ? <span className="badge ok">{fmtDate(ack.acknowledged_at)}</span> : <span className="badge warn">waiting</span>}</td>
                <td className="num">{req.length ? (g ? <span className="badge warn">{g}</span> : <span className="badge ok">0</span>) : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><a href={p(`/app/qms/competency?pos=${id}`)}>Mapping</a> · <a href={p(`/app/qms/kpi?pos=${id}`)}>KPIs</a> · <a target="_blank" rel="noreferrer" href={p(`/api/qms/sheet?kind=kpi&position=${id}&emp=${e.id}`)}>KPI sheet</a></td></tr>); })}</tbody>
          </table></div>)}
        {hr && <details style={{ marginTop: 12 }}><summary className="btn secondary small">Give people this position</summary>
          <ActionForm action={setEmployeePosition} submitLabel="Give the position" hidden={{ position_id: id }}>
            <label className="field">People<select name="employee_id" multiple size={8}>{ppl.filter((e) => e.position_id !== id).map((e) => <option key={e.id} value={e.id}>{personLabel(e)}{e.position_id ? " (has another position)" : ""}</option>)}</select>
              <span className="help">Hold Ctrl (or Cmd) to choose several. A person holds one position.</span></label>
          </ActionForm></details>}
      </div>
      <p><a href={p("/app/qms/positions")}>‹ All positions</a></p>
    </AppShell>
  );
}
