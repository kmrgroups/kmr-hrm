import { notFound } from "next/navigation";
import { p } from "@/lib/base-path";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { fmtMonth, isMonth } from "@/lib/attendance/time";
import { inr } from "@/lib/payroll/compute";
import type { Line } from "@/lib/payroll/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDateTime } from "@/components/ui";
import { PayrollTabs } from "../nav";
import { PayrollSteps } from "../steps";
import { payrollReadiness } from "@/lib/payroll/readiness";
import { deleteRun, emailPayslips, finalise, recalcRun, refreshAttendance, reopen, saveLine, saveRegister } from "../actions";

export const metadata = { title: "Payroll month" };

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="card stat"><div className="label">{label}</div><div className="value" style={{ fontSize: "1.45rem" }}>{value}</div>{hint && <div className="hint">{hint}</div>}</div>
);

export default async function RunPage({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ e?: string; q?: string }> }) {
  const session = await requireRole(["hr_manager", "payroll"]);
  const { month } = await params; const sp = await searchParams;
  if (!isMonth(month)) notFound();
  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs").select("*").eq("month", month).maybeSingle();
  if (!run) notFound();
  const lines = (await fetchAll<Line>((a, b) => supabase.from("payroll_lines").select("*").eq("run_id", run.id).range(a, b)))
    .sort((a, b) => String(a.info.code ?? a.info.name).localeCompare(String(b.info.code ?? b.info.name), undefined, { numeric: true }));
  const t = (run.totals ?? {}) as Record<string, number>;
  const draft = run.status === "draft";
  const q = (sp.q ?? "").toLowerCase().trim();
  const shown = lines.filter((l) => !q || `${l.info.name} ${l.info.code} ${l.info.department}`.toLowerCase().includes(q));
  const edit = sp.e ? lines.find((l) => l.employee_id === sp.e) : null;
  const missedBy = new Map((await payrollReadiness(session.tenant.id, month)).missed.map((m) => [m.id, m.dates.length]));
  const adj = (l: Line, label: string) => l.adjustments.find((a) => a.label === label)?.amount ?? "";
  const autoTds = (l: Line) => l.deductions.filter((d) => d.code === "TDS").reduce((n, d) => n + d.amount, 0);
  const byDept = new Map<string, { n: number; gross: number; net: number }>();
  for (const l of lines) { const k = String(l.info.department ?? "No department"); const x = byDept.get(k) ?? { n: 0, gross: 0, net: 0 }; x.n++; x.gross += Number(l.gross); x.net += Number(l.net_pay); byDept.set(k, x); }
  const dl = (kind: string, label: string) => <a className="btn secondary small" href={p(`/api/payroll/${month}/${kind}`)}>{label}</a>;

  return (
    <AppShell session={session} active="/app/payroll">
      <div className="pagehead">
        <div><h1>Payroll — {fmtMonth(month)}</h1>
          <p><span className={`badge ${draft ? "warn" : "ok"}`}>{draft ? "Draft — not visible to employees" : `Finalised ${fmtDateTime(run.finalised_at)}`}</span>
            {run.computed_at ? <span className="muted"> · worked out {fmtDateTime(run.computed_at)}</span> : null}</p></div>
        <div className="row">
          {draft && <ActionForm action={recalcRun} submitLabel="Work out again" variant="secondary" hidden={{ month }} pendingLabel="Working out…" />}
          {draft && <ActionForm action={finalise} submitLabel="Finalise month" hidden={{ month }} confirm={`Finalise ${fmtMonth(month)}? Employees will see their payslips and loan instalments will be recorded.`} pendingLabel="Finalising…" />}
          {!draft && <ActionForm action={emailPayslips} submitLabel={run.emailed_at ? "Email payslips again" : "Email payslips"} hidden={{ month }} pendingLabel="Emailing…" confirm="Email every employee their payslip (PDF) from your company mailbox?" />}
          {!draft && <ActionForm action={reopen} submitLabel="Reopen" variant="secondary" hidden={{ month }} confirm="Reopen this month for corrections? Payslips are hidden from employees until you finalise again." />}
        </div>
      </div>
      <PayrollTabs active="runs" />
      <PayrollSteps current={draft ? 2 : run.emailed_at ? 4 : 3} month={month} />
      {draft ? (
        <div className="nextstep"><div><b>Step 2 of 4 — review the month.</b> Attendance and loss of pay are already filled from the biometric punches. Type only in the <b>yellow boxes</b> (bonus, other deduction, income tax, loss-of-pay days), press <b>Save all</b>, then <b>Finalise month</b>.</div>
          <a className="btn small" href="#register">Go to the table ↓</a></div>
      ) : (
        <div className="nextstep ok"><div><b>{run.emailed_at ? "Step 4 of 4 — done." : "Step 3 and 4 — month finalised."}</b> {run.emailed_at ? "Payslips are e-mailed. Download the bank, PF and ESI files below when you pay." : "Download the bank, PF and ESI files below, then e-mail the payslips."}</div>
          <a className="btn small" href="#files">Go to the files ↓</a></div>
      )}
      <div className="grid four">
        <Stat label="Employees" value={String(t.employees ?? 0)} hint={t.no_salary ? `${t.no_salary} without salary left out` : undefined} />
        <Stat label="Gross pay" value={`Rs. ${inr(t.gross ?? 0)}`} />
        <Stat label="Net pay (to the bank)" value={`Rs. ${inr(t.net ?? 0)}`} hint={t.no_bank ? `${t.no_bank} without bank account / IFSC — add them in Employees` : undefined} />
        <Stat label="Cost to company" value={`Rs. ${inr(t.employer_cost ?? 0)}`} hint="gross + employer PF, ESI and PF charges" />
      </div>
      <div className="grid four" style={{ marginTop: 16 }}>
        <Stat label="PF (employee + employer)" value={`Rs. ${inr((t.pf_ee ?? 0) + (t.pf_er ?? 0))}`} hint={`+ Rs. ${inr(t.pf_admin ?? 0)} admin & EDLI${t.no_uan ? ` · ${t.no_uan} without UAN (EPFO needs it)` : ""}`} />
        <Stat label="ESI (employee + employer)" value={`Rs. ${inr((t.esi_ee ?? 0) + (t.esi_er ?? 0))}`} />
        <Stat label="Professional tax" value={`Rs. ${inr(t.pt ?? 0)}`} />
        <Stat label="Income tax (TDS) · loans" value={`Rs. ${inr(t.tds ?? 0)} · ${inr(t.loans ?? 0)}`} />
      </div>

      <div className="card" id="files">
        <div className="spread"><h2 style={{ margin: 0 }}>Pay & file</h2><span className="muted" style={{ fontSize: 13 }}>{draft ? "Draft figures — finalise before paying." : "Final figures."}</span></div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {dl("payslips.pdf", "All payslips (PDF)")}{dl("register.csv", "Salary register (Excel)")}{dl("bank.csv", "Bank transfer file")}
          {dl("ecr.txt", "PF ECR file (EPFO)")}{dl("esi.csv", "ESI file (ESIC)")}{dl("pt.csv", "Professional tax")}
        </div>
      </div>

      {edit && (
        <div className="card" id="edit" style={{ borderColor: "var(--brand)" }}>
          <div className="spread"><h2 style={{ margin: 0 }}>{edit.info.name} <span className="muted" style={{ fontWeight: 400 }}>{edit.info.code}</span></h2>
            <a className="btn secondary small" href={p(`/api/payroll/${month}/payslip?e=${edit.employee_id}`)}>Payslip (PDF)</a></div>
          <div className="grid two" style={{ marginTop: 12 }}>
            <div>
              <table><tbody>
                {edit.earnings.map((e, i) => <tr key={`e${i}`}><td>{e.name}</td><td className="num">{e.full != null && e.full !== e.amount ? <span className="muted">{inr(e.full)} → </span> : null}{inr(e.amount)}</td></tr>)}
                <tr><td><b>Gross</b></td><td className="num"><b>{inr(edit.gross)}</b></td></tr>
                {edit.deductions.map((d, i) => <tr key={`d${i}`}><td>{d.name}</td><td className="num">− {inr(d.amount)}</td></tr>)}
                <tr><td><b>Net pay</b></td><td className="num"><b>Rs. {inr(edit.net_pay)}</b></td></tr>
              </tbody></table>
              <p className="muted" style={{ fontSize: 13 }}>Paid days {edit.paid_days} of {edit.days_in_month} · loss of pay {edit.lop_days}{edit.ot_hours ? ` · overtime ${edit.ot_hours} h` : ""}</p>
              {edit.info.warnings && <div className="alert error">{edit.info.warnings}</div>}
            </div>
            {draft ? (
              <ActionForm action={saveLine} submitLabel="Save and work out" hidden={{ month, employee_id: edit.employee_id }} className="formgrid">
                <label className="field">Loss-of-pay days<input name="lop_override" inputMode="decimal" defaultValue={edit.lop_override ?? ""} placeholder={`${edit.lop_days} (from attendance)`} /><span className="help">Leave empty to use attendance</span></label>
                <label className="field">Income tax (TDS) this month<input name="tds_override" inputMode="decimal" defaultValue={edit.tds_override ?? ""} placeholder="From the salary" /></label>
                {Array.from({ length: 4 }, (_, i) => { const a = edit.adjustments[i]; return (
                  <div key={i} className="field full" style={{ display: "grid", gridTemplateColumns: "1fr 140px 120px", gap: 8 }}>
                    <input name={`adj_label_${i}`} defaultValue={a?.label ?? ""} placeholder={i === 0 ? "e.g. Diwali bonus, arrears, canteen" : "Another item"} />
                    <select name={`adj_kind_${i}`} defaultValue={a?.kind ?? "earning"}><option value="earning">Add to pay</option><option value="deduction">Deduct</option></select>
                    <input name={`adj_amount_${i}`} inputMode="decimal" defaultValue={a?.amount ?? ""} placeholder="Rs." />
                  </div>); })}
                <label className="field full">Note on the payslip<input name="notes" defaultValue={edit.notes ?? ""} maxLength={200} /></label>
              </ActionForm>
            ) : <p className="muted">Reopen the month to change this payslip.</p>}
          </div>
        </div>
      )}

      <div className="card" id="register">
        <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}><h2 style={{ margin: 0 }}>Payroll register ({lines.length})</h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <form className="row" action=""><input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, code, department" style={{ minWidth: 220 }} /><button className="btn secondary small">Search</button></form>
            {draft && <ActionForm action={refreshAttendance} submitLabel="Re-read biometric" variant="secondary" hidden={{ month }} pendingLabel="Reading…" />}
          </div></div>
        <p className="muted" style={{ margin: "6px 0 10px", fontSize: 13 }}>{draft ? "Yellow boxes are yours to fill; everything else is worked out. Empty loss-of-pay and tax boxes use the attendance and the salary." : "Finalised — reopen the month to change anything."} Paid days and loss of pay come from the biometric attendance.</p>
        {!lines.length ? <Empty>No payslips — set salaries for your employees, then work out again.</Empty> : (() => {
          const table = (
            <div className="tablewrap" style={{ border: 0 }}><table className="regtable">
              <thead><tr><th>Employee</th><th className="num" title="From the biometric attendance">Paid days</th><th className="num">LOP</th><th className="num">Gross</th>
                <th className="yel num">Incentive / bonus ✎</th><th className="yel num">Other deduction ✎</th><th className="yel num">Income tax ✎</th><th className="yel num">LOP days ✎</th>
                <th className="num">Deductions</th><th className="num">Net pay</th><th></th></tr></thead>
              <tbody>{shown.map((l) => { const id = l.employee_id, mp = missedBy.get(id); return (
                <tr key={id} style={id === sp.e ? { background: "var(--bg-soft, #f5f7fb)" } : undefined}>
                  <td><b>{l.info.name}</b> <span className="muted">{l.info.code}</span>{l.info.warnings ? <span className="badge danger" style={{ marginLeft: 6 }} title={String(l.info.warnings)}>check</span> : null}
                    {mp ? <a className="badge warn" style={{ marginLeft: 6 }} href={p(`/app/attendance/employee/${id}?month=${month}`)} title="Days with a single punch — fix the punch, then re-read biometric">{mp} missed punch</a> : null}
                    <div className="muted" style={{ fontSize: 12 }}>{l.info.department}</div></td>
                  <td className="num">{l.paid_days}</td><td className="num">{Number(l.lop_days) ? l.lop_days : ""}</td><td className="num">{inr(l.gross)}</td>
                  {draft ? (<>
                    <td className="yel"><input name={`bonus_${id}`} inputMode="decimal" defaultValue={adj(l, "Incentive / bonus")} placeholder="0" aria-label={`Incentive for ${l.info.name}`} /></td>
                    <td className="yel"><input name={`other_${id}`} inputMode="decimal" defaultValue={adj(l, "Other deduction")} placeholder="0" aria-label={`Other deduction for ${l.info.name}`} /></td>
                    <td className="yel"><input name={`tds_${id}`} inputMode="decimal" defaultValue={l.tds_override ?? ""} placeholder={autoTds(l) ? String(autoTds(l)) : "0"} aria-label={`Income tax for ${l.info.name}`} /></td>
                    <td className="yel"><input name={`lop_${id}`} inputMode="decimal" defaultValue={l.lop_override ?? ""} placeholder={String(l.lop_days)} aria-label={`Loss-of-pay days for ${l.info.name}`} /></td>
                  </>) : (<>
                    <td className="num">{adj(l, "Incentive / bonus") !== "" ? inr(Number(adj(l, "Incentive / bonus"))) : ""}</td><td className="num">{adj(l, "Other deduction") !== "" ? inr(Number(adj(l, "Other deduction"))) : ""}</td>
                    <td className="num">{autoTds(l) ? inr(autoTds(l)) : ""}</td><td className="num">{l.lop_override ?? ""}</td></>)}
                  <td className="num">{inr(l.total_deductions)}</td><td className="num"><b>{inr(l.net_pay)}</b></td>
                  <td style={{ textAlign: "right" }}><a className="btn secondary small" href={`?e=${id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}#edit`} title="Payslip detail and extra items">Details</a></td>
                </tr>); })}</tbody>
            </table></div>);
          return draft ? <ActionForm action={saveRegister} submitLabel="Save all & work out" pendingLabel="Saving…" hidden={{ month }} className="stack">{table}</ActionForm> : table;
        })()}
        {draft && lines.length > 0 && (
          <div className="nextstep warn" id="finalise" style={{ marginTop: 14, marginBottom: 0 }}><div><b>Happy with the figures?</b> Press <b>Save all</b> first if you typed anything, then finalise. Employees will see their payslips and loan instalments are recorded.</div>
            <ActionForm action={finalise} submitLabel="Finalise month" hidden={{ month }} confirm={`Finalise ${fmtMonth(month)}? Employees will see their payslips and loan instalments will be recorded.`} pendingLabel="Finalising…" /></div>
        )}
      </div>

      {lines.length > 0 && (
        <div className="card"><h2>Department-wise cost</h2>
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Department</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net pay</th></tr></thead>
            <tbody>{[...byDept.entries()].sort((a, b) => b[1].gross - a[1].gross).map(([d, x]) => <tr key={d}><td>{d}</td><td className="num">{x.n}</td><td className="num">{inr(x.gross)}</td><td className="num">{inr(x.net)}</td></tr>)}</tbody>
          </table></div></div>
      )}
      {draft && (
        <div className="card"><h2>Delete this draft</h2><p className="muted">Removes the draft for {fmtMonth(month)} (nothing is paid or visible yet).</p>
          <ActionForm action={deleteRun} submitLabel="Delete draft" variant="danger" hidden={{ month }} confirm="Delete this draft payroll?" /></div>
      )}
    </AppShell>
  );
}
