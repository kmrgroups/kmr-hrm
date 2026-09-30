import { p } from "@/lib/base-path";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { fmtMonth, istToday, monthBounds } from "@/lib/attendance/time";
import { inr } from "@/lib/payroll/compute";
import { salariesFor } from "@/lib/payroll/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDateTime } from "@/components/ui";
import { PayrollTabs } from "./nav";
import { startRun } from "./actions";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const session = await requireRole(["hr_manager", "payroll"]);
  const supabase = await createClient();
  const today = istToday();
  const thisMonth = today.slice(0, 7);
  const [{ data: runs }, emps, salaries] = await Promise.all([
    supabase.from("payroll_runs").select("id,month,status,totals,computed_at,finalised_at,emailed_at").order("month", { ascending: false }).limit(24),
    fetchAll<{ id: string }>((a, b) => supabase.from("employees").select("id").eq("status", "active").range(a, b)),
    salariesFor(supabase, monthBounds(thisMonth).to),
  ]);
  const noSalary = emps.filter((e) => !salaries.has(e.id)).length;
  const done = new Set((runs ?? []).map((r) => r.month));
  const options = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${thisMonth}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i + 1); return d.toISOString().slice(0, 7); });

  return (
    <AppShell session={session} active="/app/payroll">
      <div className="pagehead"><div><h1>Payroll</h1><p>Monthly salaries from attendance and leave, with PF, ESI, professional tax, loans and payslips.</p></div></div>
      <PayrollTabs active="runs" />
      {noSalary > 0 && (
        <div className="alert error" style={{ marginBottom: 16 }}>{noSalary} active employee{noSalary === 1 ? " has" : "s have"} no salary yet and will be left out.{" "}
          <a href={p("/app/payroll/salaries")}>Set salaries</a></div>
      )}
      <div className="grid two">
        <div className="card">
          <h2>Start or open a month</h2>
          <p className="muted" style={{ marginTop: -6 }}>Takes paid days and loss-of-pay from attendance and leave. You can change any payslip before finalising.</p>
          <ActionForm action={startRun} submitLabel="Work out payroll" pendingLabel="Working out…" className="formgrid">
            <label className="field">Month<select name="month" defaultValue={done.has(thisMonth) ? thisMonth : options[1]}>
              {options.map((m) => <option key={m} value={m}>{fmtMonth(m)}{done.has(m) ? " (started)" : ""}</option>)}</select></label>
          </ActionForm>
        </div>
        <div className="card">
          <h2>How it works</h2>
          <ol style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.7 }}>
            <li>Set each employee’s salary once (Salaries tab).</li>
            <li>Work out the month — check loss-of-pay, add bonus or deductions.</li>
            <li>Finalise — employees see their payslips in the portal.</li>
            <li>Download the bank file, PF (ECR) and ESI files; email payslips.</li>
          </ol>
        </div>
      </div>
      <div className="card">
        <h2>Months</h2>
        {!runs?.length ? <Empty>No payroll yet. Start with last month above.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Month</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net pay</th><th className="num">Cost to company</th><th>Updated</th></tr></thead>
            <tbody>{runs.map((r) => { const t = (r.totals ?? {}) as Record<string, number>; return (
              <tr key={r.id}>
                <td><a href={p(`/app/payroll/${r.month}`)}><b>{fmtMonth(r.month)}</b></a></td>
                <td><span className={`badge ${r.status === "finalised" ? "ok" : "warn"}`}>{r.status === "finalised" ? (r.emailed_at ? "Finalised · emailed" : "Finalised") : "Draft"}</span></td>
                <td className="num">{t.employees ?? 0}</td><td className="num">{inr(t.gross ?? 0)}</td><td className="num"><b>{inr(t.net ?? 0)}</b></td><td className="num">{inr(t.employer_cost ?? 0)}</td>
                <td className="muted">{fmtDateTime(r.finalised_at ?? r.computed_at)}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
