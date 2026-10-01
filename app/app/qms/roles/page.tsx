import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate } from "@/components/ui";
import { p } from "@/lib/base-path";
import { QmsTabs, Clause } from "../ui";
import { people, masters, type PersonRow } from "../data";
import { approveRr, saveRr } from "../actions";

export const metadata = { title: "Roles & responsibilities" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { v } = await searchParams;
  const db = await createClient();
  const [ppl, m, { data: rrs }, { data: acks }] = await Promise.all([
    people(db), masters(db),
    db.from("rr_roles").select("*").order("created_at"),
    db.from("rr_acks").select("rr_id,employee_id,version,acknowledged_at"),
  ]);
  const dname = (id: string | null) => m.designations.find((x) => x.id === id)?.name ?? "—";
  const depname = (id: string | null) => m.departments.find((x) => x.id === id)?.name ?? null;
  const holders = (r: { designation_id: string; department_id: string | null }) => ppl.filter((e) => e.designation_id === r.designation_id && (!r.department_id || e.department_id === r.department_id));
  const without = m.designations.filter((d) => ppl.some((e) => e.designation_id === d.id) && !(rrs ?? []).some((r) => r.designation_id === d.id));

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Roles &amp; responsibilities <Clause>ISO 9001 5.3</Clause></h1>
        <p>For every designation: purpose, responsibilities, authority, deputy and interfaces. Each person acknowledges the current version.</p></div>
        <div className="tabs" style={{ border: 0, margin: 0 }}><a className={v !== "org" ? "active" : ""} href={p("/app/qms/roles")}>Roles</a><a className={v === "org" ? "active" : ""} href={p("/app/qms/roles?v=org")}>Org chart</a></div></div>
      <QmsTabs active="roles" hr={hr} />

      {v === "org" ? <OrgChart people={ppl} /> : (<>
        {without.length > 0 && <div className="alert warn" style={{ marginBottom: 16 }}>No roles &amp; responsibilities yet for: {without.map((d) => d.name).join(", ")}.</div>}
        {!(rrs ?? []).length ? <div className="card"><Empty>None written yet.</Empty></div> : (rrs ?? []).map((r) => {
          const h = holders(r), acked = h.filter((e) => (acks ?? []).some((a) => a.rr_id === r.id && a.employee_id === e.id && a.version === r.version));
          const pending = h.filter((e) => !acked.includes(e));
          return (
            <div className="card" key={r.id}>
              <h2><span>{dname(r.designation_id)}{depname(r.department_id) ? ` — ${depname(r.department_id)}` : ""} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>version {r.version}</span>
                {r.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}</span>
                <span className={`badge ${r.status === "approved" ? "ok" : "warn"}`}>{r.status === "approved" ? `Approved ${fmtDate(r.approved_at)}` : "Draft"}</span></h2>
              {r.purpose && <p style={{ marginTop: 0 }}><b>Purpose:</b> {r.purpose}</p>}
              <div className="grid two">
                <div><b>Responsibilities</b><ul>{r.responsibilities.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
                <div>{r.authorities.length > 0 && <><b>Authority</b><ul>{r.authorities.map((x: string) => <li key={x}>{x}</li>)}</ul></>}
                  {r.deputy && <p><b>Deputy:</b> {r.deputy}</p>}
                  {r.interfaces.length > 0 && <p><b>Works with:</b> {r.interfaces.join(", ")}</p>}</div>
              </div>
              {r.status === "approved" && <p className="muted" style={{ marginBottom: 0 }}>Acknowledged by {acked.length} of {h.length}{pending.length ? ` — waiting for ${pending.slice(0, 8).map((e) => e.name).join(", ")}${pending.length > 8 ? ` and ${pending.length - 8} more` : ""}` : ""}.</p>}
              {hr && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "flex-start" }}>
                {r.status !== "approved" && <ActionForm action={approveRr} submitLabel="Approve and publish" className="inline" hidden={{ id: r.id }} confirm="Publish this version? Everyone in the role is asked to acknowledge it." />}
                <details style={{ flex: 1 }}><summary className="btn secondary small">Edit</summary><RrForm r={r} designations={m.designations} departments={m.departments} /></details>
              </div>}
            </div>);
        })}
        {hr && <div className="card"><h2>Write roles &amp; responsibilities</h2><RrForm designations={m.designations} departments={m.departments} /></div>}
      </>)}
    </AppShell>
  );
}

function RrForm({ r, designations, departments }: { r?: { designation_id: string; department_id: string | null; purpose: string | null; responsibilities: string[]; authorities: string[]; deputy: string | null; interfaces: string[] };
  designations: { id: string; name: string }[]; departments: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveRr} submitLabel={r ? "Save (a new version if approved)" : "Save as draft"} className="formgrid" hidden={r ? { designation_id: r.designation_id, department_id: r.department_id ?? "" } : undefined}>
      {!r && <><label className="field">Designation<select name="designation_id" required defaultValue=""><option value="" disabled>Choose…</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="field">Department (if it differs by department)<select name="department_id" defaultValue=""><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label></>}
      <label className="field full">Purpose of the role<input name="purpose" maxLength={1500} defaultValue={r?.purpose ?? ""} placeholder="Make good parts at the planned output, safely" /></label>
      <label className="field full">Responsibilities (one per line)<textarea name="responsibilities" rows={5} required defaultValue={r?.responsibilities.join("\n") ?? ""} /></label>
      <label className="field full">Authority (one per line)<textarea name="authorities" rows={3} defaultValue={r?.authorities.join("\n") ?? ""} placeholder="Stop the machine on a quality or safety doubt" /></label>
      <label className="field">Deputy<input name="deputy" maxLength={120} defaultValue={r?.deputy ?? ""} placeholder="Who stands in" /></label>
      <label className="field">Works with (one per line)<textarea name="interfaces" rows={2} defaultValue={r?.interfaces.join("\n") ?? ""} /></label>
    </ActionForm>
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
