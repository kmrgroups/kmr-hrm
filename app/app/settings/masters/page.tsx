import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { addMaster, toggleMaster } from "../actions";

export const metadata = { title: "Plants & departments" };

type Row = { id: string; name: string; active: boolean; code?: string | null; grade?: string | null; state?: string | null };

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
              <td style={{ textAlign: "right" }}>
                <form action={toggleMaster}>
                  <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} />
                  <button className="btn ghost small">{r.active ? "Hide" : "Restore"}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MastersPage() {
  const session = await requireRole(HR_ROLES);
  const supabase = await createClient();
  const [{ data: plants }, { data: departments }, { data: designations }] = await Promise.all([
    supabase.from("plants").select("id,name,code,state,active").order("name"),
    supabase.from("departments").select("id,name,code,active").order("name"),
    supabase.from("designations").select("id,name,grade,active").order("grade").order("name"),
  ]);

  return (
    <AppShell session={session} active="/app/settings/masters">
      <div className="pagehead"><div><h1>Plants &amp; departments</h1><p>Lists used in employee records, ID cards and reports. Hidden items stay on existing records.</p></div></div>

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
    </AppShell>
  );
}
