import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { logoUrl } from "@/lib/tenant";
import { fmtDate } from "@/components/ui";
import { layoutChart, groupColors, trimLevels } from "@/lib/org/layout";
import { fingerprint } from "@/lib/org/model";
import { loadOrg, chartItems } from "@/lib/org/data";
import { ChartView } from "./ChartView";
import { saveNode, deleteNode, setReportsTo, saveChartSettings, issueRevision } from "./actions";

export const metadata = { title: "Organisation chart" };
type SP = { tab?: string; plant?: string; dept?: string; levels?: string; q?: string };
const TABS: [string, string][] = [["chart", "Chart"], ["lines", "Reporting lines"], ["boxes", "Direct entry"], ["revs", "Revisions & sign-off"]];

export default async function OrgChartPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireRole(HR_ROLES);
  const sp = await searchParams;
  const isHr = true;
  const tab = isHr && TABS.some(([k]) => k === sp.tab) ? sp.tab! : "chart";
  const db = await createClient();
  const org = await loadOrg(db);
  const plantId = org.plants.some((x) => x.id === sp.plant) ? sp.plant! : null;
  const deptId = org.departments.some((x) => x.id === sp.dept) ? sp.dept! : null;
  const levels = Math.max(0, Math.min(20, Number(sp.levels) || 0)) || null;
  const all = chartItems(org);
  const items = trimLevels(chartItems(org, { plantId, departmentId: deptId }), levels);
  const layout = layoutChart(items);
  const colors = Object.fromEntries(groupColors(items));
  const latest = org.issues[0] ?? null;
  const lastSnap = latest ? await db.from("org_chart_issues").select("snapshot").eq("id", latest.id).maybeSingle() : null;
  const snapItems = (lastSnap?.data?.snapshot as { items?: typeof all } | null)?.items ?? null;
  const draft = !snapItems || fingerprint(snapItems) !== fingerprint(all);
  const qs = new URLSearchParams(); if (plantId) qs.set("plant", plantId); if (deptId) qs.set("dept", deptId); if (levels) qs.set("levels", String(levels));
  const pdfBase = p("/api/org-chart/pdf") + (qs.toString() ? `?${qs}` : "");
  const sep = pdfBase.includes("?") ? "&" : "?";
  const parentOpts = (
    <>
      <option value="">— Top of the chart —</option>
      <optgroup label="Employees">{org.employees.filter((e) => e.status === "active").map((e) => <option key={e.id} value={`e:${e.id}`}>{e.name}{e.code ? ` (${e.code})` : ""}</option>)}</optgroup>
      {org.boxes.length > 0 && <optgroup label="Boxes entered directly">{org.boxes.map((b) => <option key={b.id} value={`n:${b.id}`}>{b.title}</option>)}</optgroup>}
    </>
  );
  const tabHref = (k: string) => `${p("/app/org-chart")}?tab=${k}`;
  const parentValue = (e: { parent_employee_id: string | null; parent_node_id: string | null }) => (e.parent_employee_id ? `e:${e.parent_employee_id}` : e.parent_node_id ? `n:${e.parent_node_id}` : "");

  const q = (sp.q ?? "").trim().toLowerCase();
  const people = org.employees.filter((e) => e.status === "active" && (!q || e.name.toLowerCase().includes(q) || (e.code ?? "").toLowerCase().includes(q)));
  const linkOf = new Map(org.links.map((l) => [l.employee_id, l.parent_node_id]));
  const sorted = [...people].sort((a, b) => Number(!!a.manager_id || linkOf.has(a.id)) - Number(!!b.manager_id || linkOf.has(b.id)) || a.name.localeCompare(b.name)).slice(0, 60);
  const nameOf = new Map(org.employees.map((e) => [e.id, e.name]));

  return (
    <AppShell session={session} active="/app/org-chart">
      <div className="pagehead"><div><h1>Organisation chart</h1><p>Built from the Reporting manager on each employee record. Add boxes directly for vacancies or people outside the HRM.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn" href={pdfBase} target="_blank" rel="noreferrer">View PDF</a>
          <a className="btn ghost" href={`${pdfBase}${sep}download=1`}>Download PDF</a>
        </div>
      </div>
      {isHr && <nav className="tabs">{TABS.map(([k, l]) => <a key={k} href={tabHref(k)} className={tab === k ? "active" : ""}>{l}</a>)}</nav>}

      {tab === "chart" && (
        <>
          <form method="get" className="formgrid" style={{ marginBottom: 12 }}>
            <label className="field">Plant<select name="plant" defaultValue={plantId ?? ""}><option value="">All plants</option>{org.plants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="field">Department<select name="dept" defaultValue={deptId ?? ""}><option value="">All departments</option>{org.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="field">Levels to show<select name="levels" defaultValue={levels ? String(levels) : ""}><option value="">All levels</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Top {n}</option>)}</select></label>
            <div className="field" style={{ alignSelf: "end" }}><button className="btn">Apply</button></div>
          </form>
          <ChartView layout={layout} colors={colors} logo={logoUrl(session.tenant)} title={org.settings.title} docNo={org.settings.doc_no} rev={latest ? String(latest.rev_no).padStart(2, "0") : "-"} draft={draft} />
          <p className="help">{items.length} boxes. The chart always shrinks evenly to fit the screen and the PDF page, however many people are added. Reporting manager missing on someone? They appear as a top box - set it on the employee record or in Reporting lines.</p>
        </>
      )}

      {tab === "lines" && isHr && (
        <div className="card">
          <h2>Reporting lines</h2>
          <p className="help">The same field as &ldquo;Reporting manager&rdquo; on the employee record - change it here and the record is updated. People with no manager are listed first.</p>
          <form method="get" className="formgrid"><input type="hidden" name="tab" value="lines" /><label className="field">Find employee<input name="q" defaultValue={sp.q ?? ""} placeholder="Name or code" /></label><div className="field" style={{ alignSelf: "end" }}><button className="btn ghost">Search</button></div></form>
          <div className="tablewrap" style={{ marginTop: 12 }}><table>
            <thead><tr><th>Employee</th><th>Position</th><th>Reports to</th></tr></thead>
            <tbody>{sorted.map((e) => {
              const cur = e.manager_id ? `e:${e.manager_id}` : linkOf.get(e.id) ? `n:${linkOf.get(e.id)}` : "";
              return (
                <tr key={e.id}>
                  <td>{e.name}<div className="help" style={{ margin: 0 }}>{e.code ?? ""}</div></td>
                  <td>{e.position || e.designation || "—"}</td>
                  <td>
                    <ActionForm action={setReportsTo} submitLabel="Save" className="stack" hidden={{ employee_id: e.id }}>
                      <select name="parent" defaultValue={cur}>{parentOpts}</select>
                    </ActionForm>
                    {e.manager_id && <span className="help">Now: {nameOf.get(e.manager_id)}</span>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {people.length > sorted.length && <p className="help">Showing {sorted.length} of {people.length}. Use the search to find others.</p>}
        </div>
      )}

      {tab === "boxes" && isHr && (
        <>
          <div className="card">
            <h2>Add a box</h2>
            <p className="help">For a vacancy, a director who is not an employee, a consultant, or any box you want on the chart that has no employee record.</p>
            <ActionForm action={saveNode} submitLabel="Add to chart" className="formgrid" resetOnSuccess>
              <label className="field">Name or position<input name="title" placeholder="Plant Head" /></label>
              <label className="field">Designation (second line)<input name="subtitle" /></label>
              <label className="field">Type<select name="kind" defaultValue="person"><option value="person">Person</option><option value="vacant">Vacant position</option><option value="external">External / consultant</option></select></label>
              <label className="field">Reports to<select name="parent" defaultValue="">{parentOpts}</select></label>
              <label className="field">Department<select name="department_id" defaultValue=""><option value="">—</option>{org.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label className="field">Order among siblings<input name="sort_order" type="number" min={0} max={9999} defaultValue={0} /></label>
            </ActionForm>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h2>Boxes entered directly</h2>
            <div className="tablewrap"><table>
              <thead><tr><th>Box</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {org.boxes.map((b) => (
                  <tr key={b.id}>
                    <td>{b.title}<div className="help" style={{ margin: 0 }}>{b.subtitle ?? ""}</div></td>
                    <td>{b.kind}</td>
                    <td style={{ textAlign: "right", minWidth: 190 }}>
                      <details><summary className="btn ghost small" style={{ display: "inline-block", cursor: "pointer" }}>Edit / delete</summary>
                        <div style={{ textAlign: "left", marginTop: 8, padding: 10, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}>
                          <ActionForm action={saveNode} submitLabel="Save changes" hidden={{ id: b.id }}>
                            <label className="field">Name or position<input name="title" defaultValue={b.title} /></label>
                            <label className="field">Designation<input name="subtitle" defaultValue={b.subtitle ?? ""} /></label>
                            <label className="field">Type<select name="kind" defaultValue={b.kind}><option value="person">Person</option><option value="vacant">Vacant position</option><option value="external">External / consultant</option></select></label>
                            <label className="field">Reports to<select name="parent" defaultValue={parentValue(b as unknown as { parent_employee_id: string | null; parent_node_id: string | null })}>{parentOpts}</select></label>
                            <label className="field">Order<input name="sort_order" type="number" min={0} max={9999} defaultValue={b.sort_order} /></label>
                          </ActionForm>
                          <ActionForm action={deleteNode} submitLabel="Delete box" variant="danger" confirm={`Remove ${b.title} from the chart?`} hidden={{ id: b.id }} />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
                {!org.boxes.length && <tr><td colSpan={3} className="help">No boxes yet.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {tab === "revs" && isHr && (
        <>
          <div className="grid two">
            <div className="card">
              <h2>Document details</h2>
              <ActionForm action={saveChartSettings} submitLabel="Save">
                <label className="field">Chart title<input name="title" defaultValue={org.settings.title} /></label>
                <label className="field">Document number<input name="doc_no" defaultValue={org.settings.doc_no} /></label>
              </ActionForm>
            </div>
            <div className="card">
              <h2>Issue a new revision</h2>
              <p className="help">{draft ? "The chart has changed since the last issued revision." : "No change since the last issued revision."} An issued revision is kept as it was and can be printed again; it cannot be edited.</p>
              <ActionForm action={issueRevision} submitLabel="Issue revision" confirm="Issue this chart as a new revision? It cannot be changed afterwards.">
                <label className="field">What changed<input name="change_note" placeholder="New Quality Head; 3 operators added" /></label>
                <label className="field">Prepared by<input name="prepared_by" defaultValue={session.user.full_name ?? ""} /></label>
                <label className="field">Approved by<input name="approved_by" /></label>
              </ActionForm>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h2>Revision history</h2>
            <div className="tablewrap"><table>
              <thead><tr><th>Rev</th><th>Date</th><th>Change</th><th>Prepared</th><th>Approved</th><th></th></tr></thead>
              <tbody>
                {org.issues.map((i) => (
                  <tr key={i.id}><td>{String(i.rev_no).padStart(2, "0")}</td><td>{fmtDate(i.issued_on)}</td><td>{i.change_note}</td><td>{i.prepared_by}</td><td>{i.approved_by}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><a className="btn ghost small" target="_blank" rel="noreferrer" href={`${p("/api/org-chart/pdf")}?rev=${i.rev_no}`}>View</a>{" "}<a className="btn ghost small" href={`${p("/api/org-chart/pdf")}?rev=${i.rev_no}&download=1`}>Download</a></td></tr>
                ))}
                {!org.issues.length && <tr><td colSpan={6} className="help">Nothing issued yet. Until then the PDF is marked DRAFT.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </AppShell>
  );
}
