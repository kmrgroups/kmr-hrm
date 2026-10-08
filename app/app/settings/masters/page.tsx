import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { addMaster, toggleMaster, updateMaster, deleteMaster, savePosition, togglePosition } from "../actions";

export const metadata = { title: "Plants & departments" };

type Row = { id: string; name: string; active: boolean; code?: string | null; grade?: string | null; state?: string | null; address?: string | null };

function EditFields({ table, r }: { table: string; r: Row }) {
  return (
    <>
      <label className="field">Name<input name="name" defaultValue={r.name} /></label>
      {table === "plants" && <><label className="field">Code<input name="code" defaultValue={r.code ?? ""} maxLength={6} /></label><label className="field">State<input name="state" defaultValue={r.state ?? ""} /></label><label className="field">Address<input name="address" defaultValue={r.address ?? ""} /></label></>}
      {table === "departments" && <label className="field">Short code<input name="code" defaultValue={r.code ?? ""} maxLength={6} /></label>}
      {table === "designations" && <label className="field">Grade<input name="grade" defaultValue={r.grade ?? ""} /></label>}
    </>
  );
}

function List({ table, rows, cols }: { table: string; rows: Row[]; cols: [keyof Row, string][] }) {
  return (
    <div className="tablewrap" style={{ marginTop: 12 }}>
      <table>
        <thead><tr>{cols.map(([, l]) => <th key={l}>{l}</th>)}<th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
              {cols.map(([k]) => <td key={String(k)}>{String(r[k] ?? "—")}</td>)}
              <td>{r.active ? <span className="badge ok">In use</span> : <span className="badge">Hidden</span>}</td>
              <td style={{ textAlign: "right", minWidth: 190 }}>
                <details>
                  <summary className="btn ghost small" style={{ display: "inline-block", cursor: "pointer" }}>Edit / delete</summary>
                  <div style={{ textAlign: "left", marginTop: 8, padding: 10, border: "1px solid var(--line, #d9dde3)", borderRadius: 8, background: "#fff" }}>
                    <ActionForm action={updateMaster} submitLabel="Save changes" hidden={{ table, id: r.id }}><EditFields table={table} r={r} /></ActionForm>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <form action={toggleMaster}>
                        <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} />
                        <button className="btn ghost small">{r.active ? "Hide" : "Restore"}</button>
                      </form>
                      <ActionForm action={deleteMaster} submitLabel="Delete" variant="danger" confirm={`Delete ${r.name}? This cannot be undone.`} hidden={{ table, id: r.id }} />
                    </div>
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PosRow = { id: string; title: string; role: string | null; active: boolean; department_id: string | null; department: { name: string } | { name: string }[] | null };

function Positions({ rows, depts }: { rows: PosRow[]; depts: { id: string; name: string }[] }) {
  const deptOpts = (sel: string | null) => (<><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id} selected={d.id === sel}>{d.name}</option>)}</>);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Positions</h2>
      <p className="help">The list behind the &ldquo;Position&rdquo; dropdown on the employee record (e.g. Production Head, Calibration Incharge). It is also used for R&amp;R sheets, KPIs and the organisation chart.</p>
      <ActionForm action={savePosition} submitLabel="Add position" className="formgrid" resetOnSuccess>
        <label className="field">Position<input name="title" placeholder="Production Head" /></label>
        <label className="field">Role (optional)<input name="role" placeholder="Shopfloor handling" /></label>
        <label className="field">Department<select name="department_id" defaultValue="">{deptOpts(null)}</select></label>
      </ActionForm>
      <div className="tablewrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Position</th><th>Role</th><th>Department</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = Array.isArray(r.department) ? r.department[0] : r.department;
              return (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td>{r.title}</td><td>{r.role ?? "—"}</td><td>{d?.name ?? "All"}</td>
                  <td>{r.active ? <span className="badge ok">In use</span> : <span className="badge">Hidden</span>}</td>
                  <td style={{ textAlign: "right", minWidth: 190 }}>
                    <details>
                      <summary className="btn ghost small" style={{ display: "inline-block", cursor: "pointer" }}>Edit / delete</summary>
                      <div style={{ textAlign: "left", marginTop: 8, padding: 10, border: "1px solid var(--line, #d9dde3)", borderRadius: 8, background: "#fff" }}>
                        <ActionForm action={savePosition} submitLabel="Save changes" hidden={{ id: r.id }}>
                          <label className="field">Position<input name="title" defaultValue={r.title} /></label>
                          <label className="field">Role<input name="role" defaultValue={r.role ?? ""} /></label>
                          <label className="field">Department<select name="department_id" defaultValue={r.department_id ?? ""}>{deptOpts(r.department_id)}</select></label>
                        </ActionForm>
                        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                          <form action={togglePosition}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} /><button className="btn ghost small">{r.active ? "Hide" : "Restore"}</button></form>
                          <ActionForm action={deleteMaster} submitLabel="Delete" variant="danger" confirm={`Delete ${r.title}? This cannot be undone.`} hidden={{ table: "positions", id: r.id }} />
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="help">No positions yet - add the first one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function MastersPage() {
  const session = await requireRole(HR_ROLES);
  const supabase = await createClient();
  const [{ data: plants }, { data: departments }, { data: designations }, { data: positions }] = await Promise.all([
    supabase.from("plants").select("id,name,code,state,address,active").order("name"),
    supabase.from("departments").select("id,name,code,active").order("name"),
    supabase.from("designations").select("id,name,grade,active").order("grade").order("name"),
    supabase.from("positions").select("id,title,role,active,department_id,department:departments(name)").order("title"),
  ]);

  return (
    <AppShell session={session} active="/app/settings/masters">
      <div className="pagehead"><div><h1>Plants, departments &amp; positions</h1><p>Lists used in employee records, ID cards and reports. Use Edit / delete on any row. Hidden items stay on existing records.</p></div></div>

      <div className="card">
        <h2>Plants / locations</h2>
        <ActionForm action={addMaster} submitLabel="Add plant" className="formgrid" hidden={{ table: "plants" }} resetOnSuccess>
          <label className="field">Plant name<input name="name" placeholder="Bommasandra Plant 1" /></label>
          <label className="field">Code<input name="code" placeholder="PL1" maxLength={6} /><span className="help">Appears in employee codes</span></label>
          <label className="field">State<input name="state" placeholder="Karnataka" /></label>
          <label className="field">Address<input name="address" /></label>
        </ActionForm>
        <List table="plants" rows={(plants ?? []) as Row[]} cols={[["code", "Code"], ["name", "Plant"], ["state", "State"]]} />
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Departments</h2>
          <ActionForm action={addMaster} submitLabel="Add department" className="formgrid" hidden={{ table: "departments" }} resetOnSuccess>
            <label className="field">Department<input name="name" /></label>
            <label className="field">Short code<input name="code" maxLength={6} /></label>
          </ActionForm>
          <List table="departments" rows={(departments ?? []) as Row[]} cols={[["name", "Department"], ["code", "Code"]]} />
        </div>
        <div className="card">
          <h2>Designations</h2>
          <ActionForm action={addMaster} submitLabel="Add designation" className="formgrid" hidden={{ table: "designations" }} resetOnSuccess>
            <label className="field">Designation<input name="name" /></label>
            <label className="field">Grade<input name="grade" placeholder="S2" /></label>
          </ActionForm>
          <List table="designations" rows={(designations ?? []) as Row[]} cols={[["name", "Designation"], ["grade", "Grade"]]} />
        </div>
      </div>
      <Positions rows={(positions ?? []) as unknown as PosRow[]} depts={(departments ?? []).filter((d) => (d as { active: boolean }).active).map((d) => ({ id: d.id, name: d.name }))} />
    </AppShell>
  );
}
