import { p } from "@/lib/base-path";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtMonth, isMonth, istToday, shiftMonth } from "@/lib/attendance/time";
import { inr } from "@/lib/payroll/compute";
import { payrollReadiness } from "@/lib/payroll/readiness";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fmtDateTime } from "@/components/ui";
import { PayrollTabs } from "./nav";
import { PayrollSteps } from "./steps";
import { refreshAttendance, startRun } from "./actions";

export const metadata = { title: "Payroll" };

const Row = ({ tone, title, children, action }: { tone: "ok" | "warn" | "bad"; title: string; children?: React.ReactNode; action?: React.ReactNode }) => (
  <div className="chk"><span className={`dot ${tone === "ok" ? "" : tone}`} aria-hidden>{tone === "ok" ? "✓" : tone === "warn" ? "!" : "✕"}</span>
    <div><b>{title}</b>{children ? <p>{children}</p> : null}</div><div>{action}</div></div>
);

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requireRole(["hr_manager", "payroll"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const today = istToday();
  const thisMonth = today.slice(0, 7);
  const month = isMonth(sp.month) ? sp.month : shiftMonth(thisMonth, -1);   // payroll is normally run for the month that just ended
  const [{ data: runs }, r] = await Promise.all([
    supabase.from("payroll_runs").select("id,month,status,totals,computed_at,finalised_at,emailed_at").order("month", { ascending: false }).limit(24),
    payrollReadiness(session.tenant.id, month),
  ]);
  const run = (runs ?? []).find((x) => x.month === month);
  const dayAgo = Date.now() - 36e5 * 26;
  const seen = r.devices.filter((d) => d.active && d.last_seen_at && Date.parse(d.last_seen_at) > dayAgo);
  const issues = (r.noDeviceId.length ? 1 : 0) + (r.unmatched.count ? 1 : 0) + (r.missed.length ? 1 : 0) + (r.pendingRegularisations + r.pendingLeaves ? 1 : 0) + (r.noSalary ? 1 : 0) + (r.devices.length && !seen.length ? 1 : 0);
  const months = Array.from({ length: 8 }, (_, i) => shiftMonth(thisMonth, 1 - i));

  return (
    <AppShell session={session} active="/app/payroll">
      <div className="pagehead"><div><h1>Payroll</h1><p>Four simple steps each month. The attendance comes straight from the biometric machine — nobody types it again.</p></div></div>
      <PayrollTabs active="runs" />
      <PayrollSteps current={run ? 2 : 1} month={month} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Step 1 · Check the attendance</h2>
          <form className="row" method="get" action={p("/app/payroll")} style={{ gap: 8 }}>
            <label className="muted" htmlFor="pm">Month</label>
            <select id="pm" name="month" defaultValue={month}>{months.map((m) => <option key={m} value={m}>{fmtMonth(m)}{(runs ?? []).some((x) => x.month === m) ? " ✓ started" : ""}</option>)}</select>
            <button className="btn secondary small">Show</button>
          </form>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>{r.isPast ? `${fmtMonth(month)} is complete.` : `${fmtMonth(month)} is still running — figures for the days to come are assumed worked.`} Fix anything marked ! or ✕ below, or continue and pay as it stands.</p>

        <Row tone={!r.devices.length ? "warn" : seen.length ? "ok" : "warn"} title="Biometric machine"
          action={<a className="btn secondary small" href={p("/app/settings/attendance")}>{r.devices.length ? "Machines" : "Connect a machine"}</a>}>
          {!r.devices.length ? "No machine connected yet. Without it, attendance has to come from CSV import or manual entry."
            : r.devices.map((d) => `${d.name}: ${d.last_seen_at ? `last sent punches ${fmtDateTime(d.last_seen_at)}` : "never connected"}`).join(" · ")}
          {r.devices.length && !seen.length ? " — no machine has reported in the last day. Check that the bridge PC is on." : ""}
        </Row>
        <Row tone={r.punches ? "ok" : "warn"} title={`${r.punches.toLocaleString("en-IN")} punches received for ${fmtMonth(month)}`}>
          {r.lastPunch ? `Latest punch ${fmtDateTime(r.lastPunch)}. ` : ""}{r.employees} active employees.
        </Row>
        <Row tone={r.noDeviceId.length ? "bad" : "ok"} title={r.noDeviceId.length ? `${r.noDeviceId.length} employee(s) cannot punch — no Device ID` : "Every employee has a Device ID"}
          action={r.noDeviceId.length ? <a className="btn secondary small" href={p("/app/employees")}>Set Device IDs</a> : undefined}>
          {r.noDeviceId.length ? <>{r.noDeviceId.slice(0, 6).map((e) => e.name).join(", ")}{r.noDeviceId.length > 6 ? ` and ${r.noDeviceId.length - 6} more` : ""}. Enter the number they use on the machine in their employee record.</> : null}
        </Row>
        <Row tone={r.unmatched.count ? "warn" : "ok"} title={r.unmatched.count ? `${r.unmatched.count} punch(es) from machine IDs not linked to anyone` : "All punches belong to an employee"}
          action={r.unmatched.count ? <a className="btn secondary small" href={p("/app/attendance/import")}>See them</a> : undefined}>
          {r.unmatched.count ? <>Machine ID(s) {r.unmatched.ids.join(", ")}. Set that ID on the right employee — the punches are linked automatically.</> : null}
        </Row>
        <Row tone={r.missed.length ? "warn" : "ok"} title={r.missed.length ? `${r.missed.reduce((n, m) => n + m.dates.length, 0)} day(s) with only one punch (missed in/out)` : "No missed punches"}>
          {r.missed.length ? <>{r.missed.slice(0, 5).map((m) => <span key={m.id}><a href={p(`/app/attendance/employee/${m.id}?month=${month}`)}>{m.name}</a> ({m.dates.map((d) => fmtDate(d).slice(0, 6)).join(", ")}) </span>)}{r.missed.length > 5 ? `and ${r.missed.length - 5} more employees. ` : ""}Add the missing punch or approve a correction, otherwise the day is paid as half or absent.</> : null}
        </Row>
        <Row tone={r.pendingRegularisations + r.pendingLeaves ? "warn" : "ok"} title={r.pendingRegularisations + r.pendingLeaves ? `${r.pendingRegularisations + r.pendingLeaves} request(s) waiting for approval` : "No pending leave or correction requests"}
          action={r.pendingRegularisations + r.pendingLeaves ? <a className="btn secondary small" href={p("/app/approvals")}>Approve</a> : undefined}>
          {r.pendingRegularisations + r.pendingLeaves ? `${r.pendingLeaves} leave and ${r.pendingRegularisations} attendance correction. Approved leave is paid; anything still pending counts as loss of pay.` : null}
        </Row>
        <Row tone={r.noSalary ? "bad" : "ok"} title={r.noSalary ? `${r.noSalary} employee(s) have no salary set` : "Everyone has a salary"}
          action={r.noSalary ? <a className="btn secondary small" href={p("/app/payroll/salaries")}>Set salaries</a> : undefined}>
          {r.noSalary ? "They are left out of payroll until a salary is set." : null}
        </Row>

        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <ActionForm action={refreshAttendance} submitLabel="Re-read biometric punches" pendingLabel="Reading…" variant="secondary" hidden={{ month }} />
          <a className="btn secondary" href={p(`/app/attendance/register?month=${month}`)}>View monthly register</a>
          {run
            ? <a className="btn" href={p(`/app/payroll/${month}`)}>Continue to Step 2 →</a>
            : <ActionForm action={startRun} submitLabel="Work out payroll → Step 2" pendingLabel="Working out…" hidden={{ month }}
                confirm={issues ? `${issues} item(s) above still need attention. Work out ${fmtMonth(month)} anyway? You can come back, fix them and work out again.` : undefined} />}
        </div>
      </div>

      <div className="grid two">
        <div className="card"><h2>One-time setup</h2>
          <ol style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.8 }}>
            <li><a href={p("/app/settings/payroll")}>Payroll settings</a> — pay days, PF, ESI, professional tax (once).</li>
            <li><a href={p("/app/payroll/salaries")}>Salaries</a> — monthly gross per employee; the split is automatic.</li>
            <li><a href={p("/app/settings/attendance")}>Biometric machine</a> + Device ID on each employee.</li>
          </ol></div>
        <div className="card"><h2>What happens each month</h2>
          <ol style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.8 }}>
            <li>Check attendance (this page) — fix missed punches.</li>
            <li>Review the table: only the yellow boxes need typing.</li>
            <li>Finalise — employees see their payslips.</li>
            <li>Download bank, PF and ESI files; e-mail payslips.</li>
          </ol></div>
      </div>

      <div className="card">
        <h2>Months</h2>
        {!runs?.length ? <Empty>No payroll yet. Pick the month above and press “Work out payroll”.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Month</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net pay</th><th className="num">Cost to company</th><th>Updated</th></tr></thead>
            <tbody>{runs.map((x) => { const t = (x.totals ?? {}) as Record<string, number>; return (
              <tr key={x.id}>
                <td><a href={p(`/app/payroll/${x.month}`)}><b>{fmtMonth(x.month)}</b></a></td>
                <td><span className={`badge ${x.status === "finalised" ? "ok" : "warn"}`}>{x.status === "finalised" ? (x.emailed_at ? "Finalised · emailed" : "Finalised") : "Draft"}</span></td>
                <td className="num">{t.employees ?? 0}</td><td className="num">{inr(t.gross ?? 0)}</td><td className="num"><b>{inr(t.net ?? 0)}</b></td><td className="num">{inr(t.employer_cost ?? 0)}</td>
                <td className="muted">{fmtDateTime(x.finalised_at ?? x.computed_at)}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
