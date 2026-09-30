import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { fmtMonth, istToday } from "@/lib/attendance/time";
import { inr } from "@/lib/payroll/compute";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName, one } from "@/components/ui";
import { PayrollTabs } from "../nav";
import { closeLoan, saveLoan } from "../actions";

export const metadata = { title: "Loans & advances" };

export default async function LoansPage() {
  const session = await requireRole(["hr_manager", "payroll"]);
  const supabase = await createClient();
  const [emps, { data: loans }] = await Promise.all([
    fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null }>((a, b) =>
      supabase.from("employees").select("id,first_name,last_name,employee_code").eq("status", "active").order("first_name").range(a, b)),
    supabase.from("loans").select("*,employee:employees(first_name,last_name,employee_code)").order("status").order("created_at", { ascending: false }).limit(300),
  ]);
  const month = istToday().slice(0, 7);
  const act = (loans ?? []).filter((l) => l.status === "active");
  return (
    <AppShell session={session} active="/app/payroll">
      <div className="pagehead"><div><h1>Loans &amp; advances</h1><p>Recovered automatically from salary every month until the balance is zero.</p></div></div>
      <PayrollTabs active="loans" />
      <div className="grid two">
        <div className="card">
          <h2>New loan or advance</h2>
          <ActionForm action={saveLoan} submitLabel="Save" className="formgrid" resetOnSuccess>
            <label className="field full">Employee<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{e.employee_code ? ` (${e.employee_code})` : ""}</option>)}</select></label>
            <label className="field">Type<select name="kind" defaultValue="loan"><option value="loan">Loan (instalments)</option><option value="advance">Salary advance</option></select></label>
            <label className="field">Amount (Rs.)<input name="amount" inputMode="decimal" required /></label>
            <label className="field">Monthly instalment (Rs.)<input name="emi" inputMode="decimal" required /><span className="help">For a one-month advance, the same as the amount</span></label>
            <label className="field">First deduction in<input type="month" name="start_month" required defaultValue={month} /></label>
            <label className="field full">Note<input name="notes" maxLength={200} placeholder="e.g. Medical emergency, approved by Plant Head" /></label>
          </ActionForm>
        </div>
        <div className="card stat"><div className="label">Outstanding</div><div className="value">Rs. {inr(act.reduce((s, l) => s + Number(l.balance), 0))}</div>
          <div className="hint">{act.length} active · Rs. {inr(act.reduce((s, l) => s + Math.min(Number(l.emi), Number(l.balance)), 0))} to recover next month</div></div>
      </div>
      <div className="card">
        <h2>All loans and advances</h2>
        {!loans?.length ? <Empty>None yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Employee</th><th>Type</th><th className="num">Amount</th><th className="num">Instalment</th><th>From</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>{loans.map((l) => { const e = one(l.employee as { first_name: string; last_name: string | null; employee_code: string | null } | null); return (
              <tr key={l.id}><td><b>{e ? fullName(e) : "—"}</b> <span className="muted">{e?.employee_code}</span>{l.notes ? <div className="muted" style={{ fontSize: 12 }}>{l.notes}</div> : null}</td>
                <td>{l.kind === "advance" ? "Advance" : "Loan"}</td><td className="num">{inr(Number(l.amount))}</td><td className="num">{inr(Number(l.emi))}</td><td>{fmtMonth(l.start_month)}</td>
                <td className="num"><b>{inr(Number(l.balance))}</b></td><td><span className={`badge ${l.status === "active" ? "warn" : "ok"}`}>{l.status === "active" ? "Recovering" : "Closed"}</span><div className="muted" style={{ fontSize: 12 }}>since {fmtDate(l.created_at)}</div></td>
                <td style={{ textAlign: "right" }}>{l.status === "active" && <ActionForm action={closeLoan} submitLabel="Close" variant="secondary" hidden={{ id: l.id }} confirm="Stop deducting this loan? (e.g. repaid in cash or waived)" />}</td></tr>); })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
