import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { inr, splitGross } from "@/lib/payroll/compute";
import { loadSetup, salariesFor } from "@/lib/payroll/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName } from "@/components/ui";
import { PayrollTabs } from "../nav";
import { deleteSalary, importSalaries, saveSalary } from "../actions";

export const metadata = { title: "Salaries" };

export default async function SalariesPage({ searchParams }: { searchParams: Promise<{ e?: string; q?: string }> }) {
  const session = await requireRole(["hr_manager", "payroll"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const today = istToday();
  const [emps, current, { components, settings }] = await Promise.all([
    fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null; date_of_joining: string | null; designation: { name: string } | { name: string }[] | null }>((a, b) =>
      supabase.from("employees").select("id,first_name,last_name,employee_code,date_of_joining,designation:designations(name)").eq("status", "active").order("employee_code", { nullsFirst: false }).range(a, b)),
    salariesFor(supabase, "2999-12-31"),
    loadSetup(supabase, session.tenant.id),
  ]);
  const sel = sp.e ? emps.find((e) => e.id === sp.e) : null;
  const { data: history } = sel ? await supabase.from("salary_structures").select("*").eq("employee_id", sel.id).order("effective_from", { ascending: false }) : { data: null };
  const cur = sel ? current.get(sel.id) : undefined;
  const q = (sp.q ?? "").toLowerCase();
  const list = emps.filter((e) => !q || `${fullName(e)} ${e.employee_code}`.toLowerCase().includes(q));
  const without = emps.filter((e) => !current.has(e.id)).length;
  const active = components.filter((c) => c.active);
  const desc = (c: typeof active[number]) => c.calc === "percent_gross" ? `${c.value}% of gross` : c.calc === "percent_basic" ? `${c.value}% of basic` : c.calc === "fixed" ? `Rs. ${inr(c.value)} fixed` : "the balance";

  return (
    <AppShell session={session} active="/app/payroll">
      <div className="pagehead"><div><h1>Salaries</h1><p>Monthly gross for each employee. It is split automatically into {active.map((c) => c.name).join(", ")} — or enter your own amounts.</p></div></div>
      <PayrollTabs active="salaries" />
      <div className="grid two">
        <div className="card">
          <h2>{sel ? `Salary for ${fullName(sel)}` : "Set or revise a salary"}</h2>
          <ActionForm action={saveSalary} submitLabel="Save salary" className="formgrid">
            <label className="field full">Employee<select name="employee_id" required defaultValue={sel?.id ?? ""}>
              <option value="" disabled>Choose…</option>{emps.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{e.employee_code ? ` (${e.employee_code})` : ""}{current.has(e.id) ? "" : " — no salary"}</option>)}</select></label>
            <label className="field">Monthly gross (Rs.)<input name="monthly_gross" inputMode="decimal" required defaultValue={cur?.monthly_gross ?? ""} placeholder="e.g. 25000" /></label>
            <label className="field">From<input type="date" name="effective_from" required defaultValue={cur ? today.slice(0, 8) + "01" : sel?.date_of_joining ?? today.slice(0, 8) + "01"} /><span className="help">A new date keeps the old salary as history (revision)</span></label>
            <details className="field full"><summary style={{ cursor: "pointer", fontWeight: 600 }}>Set component amounts yourself (optional)</summary>
              <div className="formgrid" style={{ marginTop: 8 }}>
                {active.filter((c) => c.calc !== "balance").map((c) => <label key={c.code} className="field">{c.name}<input name={`c_${c.code}`} inputMode="decimal" placeholder={`auto: ${desc(c)}`} /></label>)}
                <p className="help full">Leave empty for the automatic split. {active.find((c) => c.calc === "balance")?.name ?? "The balance component"} takes whatever is left.</p>
              </div></details>
            <label className="check"><input type="checkbox" name="pf_applicable" defaultChecked={cur?.pf_applicable ?? settings.pf_enabled} /> PF applies</label>
            <label className="check"><input type="checkbox" name="pt_applicable" defaultChecked={cur?.pt_applicable ?? true} /> Professional tax applies</label>
            <label className="field">ESI<select name="esi_applicable" defaultValue={cur?.esi_applicable == null ? "auto" : cur.esi_applicable ? "yes" : "no"}>
              <option value="auto">Automatic (gross up to Rs. {inr(settings.esi_threshold)})</option><option value="yes">Always</option><option value="no">Never</option></select></label>
            <label className="field">Voluntary PF %<input name="vpf_percent" inputMode="decimal" defaultValue={cur?.vpf_percent || ""} placeholder="0" /></label>
            <label className="field">Income tax (TDS) per month<input name="monthly_tds" inputMode="decimal" defaultValue={cur?.monthly_tds || ""} placeholder="0" /><span className="help">From the employee’s tax declaration; can be changed each month</span></label>
            <label className="field">Note<input name="notes" maxLength={200} /></label>
          </ActionForm>
        </div>
        <div className="card">
          {sel ? (<>
            <h2>History</h2>
            {!history?.length ? <Empty>No salary yet.</Empty> : history.map((h) => (
              <div key={h.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <div className="spread"><b>Rs. {inr(Number(h.monthly_gross))} / month from {fmtDate(h.effective_from)}</b>
                  <ActionForm action={deleteSalary} submitLabel="Remove" variant="secondary" hidden={{ id: h.id }} confirm="Remove this salary revision?" /></div>
                <div className="muted" style={{ fontSize: 13 }}>{((h.components as { name: string; amount: number }[]).length ? (h.components as { name: string; amount: number }[]) : splitGross(Number(h.monthly_gross), components)).map((c) => `${c.name} ${inr(c.amount)}`).join(" · ")}</div>
                <div className="muted" style={{ fontSize: 13 }}>Annual gross Rs. {inr(Number(h.monthly_gross) * 12)}{h.pf_applicable ? " · PF" : ""}{h.esi_applicable === false ? " · no ESI" : ""}{Number(h.monthly_tds) ? ` · TDS ${inr(Number(h.monthly_tds))}/month` : ""}</div>
              </div>))}
          </>) : (<>
            <h2>Import from Excel</h2>
            <p className="muted" style={{ marginTop: -6 }}>Save your sheet as CSV with the columns <span className="mono">employee_code, monthly_gross, effective_from</span> (date as 2026-10-01). Each salary is split automatically.</p>
            <ActionForm action={importSalaries} submitLabel="Import salaries" pendingLabel="Importing…">
              <label className="field">CSV file<input type="file" name="file" accept=".csv,text/csv" required /></label>
            </ActionForm>
          </>)}
        </div>
      </div>
      <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>Employees ({emps.length}){without ? <span className="badge warn" style={{ marginLeft: 8 }}>{without} without salary</span> : null}</h2>
          <form className="row" action=""><input name="q" defaultValue={sp.q ?? ""} placeholder="Search" /><button className="btn secondary small">Search</button></form></div>
        {!emps.length ? <Empty>No active employees.</Empty> : (
          <div className="tablewrap" style={{ border: 0, marginTop: 10 }}><table>
            <thead><tr><th>Employee</th><th>Designation</th><th className="num">Monthly gross</th><th>Since</th><th className="num">Annual</th><th></th></tr></thead>
            <tbody>{list.map((e) => { const s = current.get(e.id); return (
              <tr key={e.id}><td><b>{fullName(e)}</b> <span className="muted">{e.employee_code}</span></td><td className="muted">{(Array.isArray(e.designation) ? e.designation[0] : e.designation)?.name}</td>
                <td className="num">{s ? inr(s.monthly_gross) : <span className="badge warn">not set</span>}</td><td className="muted">{s ? fmtDate(s.effective_from) : ""}</td>
                <td className="num">{s ? inr(s.monthly_gross * 12) : ""}</td>
                <td style={{ textAlign: "right" }}><a className="btn secondary small" href={`?e=${e.id}`}>{s ? "Revise / history" : "Set salary"}</a></td></tr>); })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
