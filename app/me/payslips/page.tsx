import { redirect } from "next/navigation";
import { p } from "@/lib/base-path";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtMonth } from "@/lib/attendance/time";
import { inr } from "@/lib/payroll/compute";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui";

export const metadata = { title: "My payslips" };

export default async function MyPayslips() {
  const session = await requireSession();
  if (!session.user.employee_id) redirect("/app");
  const supabase = await createClient();
  // row-level security: only this employee's payslips, and only finalised months
  const { data } = await supabase.from("payroll_lines").select("run_id,gross,total_deductions,net_pay,paid_days,days_in_month,run:payroll_runs(month)").eq("employee_id", session.user.employee_id);
  const rows = (data ?? []).map((l) => ({ ...l, month: (Array.isArray(l.run) ? l.run[0] : l.run as { month: string } | null)?.month ?? "" })).filter((l) => l.month).sort((a, b) => b.month.localeCompare(a.month));
  const year = rows.filter((r) => r.month.slice(0, 4) === rows[0]?.month.slice(0, 4));
  return (
    <AppShell session={session} active="/me/payslips">
      <div className="pagehead"><div><h1>My payslips</h1><p>Download any month as a PDF.</p></div></div>
      {rows.length > 0 && (
        <div className="grid three">
          <div className="card stat"><div className="label">Last net pay ({fmtMonth(rows[0].month)})</div><div className="value">₹{inr(Number(rows[0].net_pay))}</div></div>
          <div className="card stat"><div className="label">Gross in {rows[0].month.slice(0, 4)}</div><div className="value">₹{inr(year.reduce((s, r) => s + Number(r.gross), 0))}</div></div>
          <div className="card stat"><div className="label">Net pay in {rows[0].month.slice(0, 4)}</div><div className="value">₹{inr(year.reduce((s, r) => s + Number(r.net_pay), 0))}</div></div>
        </div>)}
      <div className="card">
        {!rows.length ? <Empty>No payslips yet. They appear here once HR finalises the month.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Month</th><th className="num">Paid days</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.run_id}><td><b>{fmtMonth(r.month)}</b></td><td className="num">{r.paid_days} / {r.days_in_month}</td><td className="num">{inr(Number(r.gross))}</td>
                <td className="num">{inr(Number(r.total_deductions))}</td><td className="num"><b>{inr(Number(r.net_pay))}</b></td>
                <td style={{ textAlign: "right" }}><a className="btn secondary small" href={p(`/api/payroll/${r.month}/mine`)}>Download PDF</a></td></tr>))}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
