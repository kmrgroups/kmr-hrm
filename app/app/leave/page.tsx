import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { fmtDays, leaveYearLabel, leaveYearOf } from "@/lib/leave/rules";
import { loadBalances, loadLeaveTypes, startMonthOf } from "@/lib/leave/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { adjustBalance, closeYear, importOpeningBalances, recordLeave, runCredits } from "./actions";

export const metadata = { title: "Leave" };

const STATUS_TONE: Record<string, string> = { pending: "warn", approved: "ok", rejected: "danger", cancelled: "" };

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  const session = await requireRole([...HR_ROLES, "payroll"]);
  const hr = hasRole(session.user, HR_ROLES);
  const sp = await searchParams;
  const sm = startMonthOf(session.tenant);
  const current = leaveYearOf(istToday(), sm);
  const year = Number(sp.year) > 2000 && Number(sp.year) <= current + 1 ? Number(sp.year) : current;
  const q = (sp.q ?? "").trim().toLowerCase();
  const supabase = await createClient();

  const [emps, types, { data: recent }, { count: pending }] = await Promise.all([
    fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null }>((a, b) =>
      supabase.from("employees").select("id,first_name,last_name,employee_code").eq("status", "active").order("first_name").range(a, b)),
    loadLeaveTypes(supabase, session.tenant.id),
    supabase.from("leave_requests").select("id,employee_id,from_date,to_date,half_day,days,status,created_at,leave_type:leave_types(code,color),employee:employees(first_name,last_name,employee_code)").order("created_at", { ascending: false }).limit(15),
    supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  // Balances are read with the service client after the role check above (the view sums many rows).
  const balances = await loadBalances(createAdminClient(), session.tenant.id, "all", year);
  const balTypes = types.filter((t) => t.requires_balance);
  const shown = emps.filter((e) => !q || fullName(e).toLowerCase().includes(q) || (e.employee_code ?? "").toLowerCase().includes(q));
  const empOptions = emps.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{e.employee_code ? ` (${e.employee_code})` : ""}</option>);
  const typeOptions = types.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>);

  return (
    <AppShell session={session} active="/app/leave">
      <div className="pagehead">
        <div><h1>Leave</h1><p>Balances for leave year {leaveYearLabel(year, sm)}.</p></div>
        <div className="row">
          <a className="btn secondary small" href={`?year=${year - 1}`}>← {leaveYearLabel(year - 1, sm)}</a>
          {year < current + 1 && <a className="btn secondary small" href={`?year=${year + 1}`}>{leaveYearLabel(year + 1, sm)} →</a>}
          <a className="btn" href={p("/app/approvals")}><Icon name="inbox" /> Approvals{pending ? ` (${pending})` : ""}</a>
        </div>
      </div>

      {hr && (
        <div className="grid two">
          <div className="card">
            <h2>Record leave</h2>
            <p className="muted" style={{ marginTop: -6 }}>For people without portal access, or leave taken earlier. Approved straight away.</p>
            <ActionForm action={recordLeave} submitLabel="Record leave" className="formgrid" resetOnSuccess>
              <label className="field full">Employee<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>{empOptions}</select></label>
              <label className="field">Leave type<select name="leave_type_id" required>{typeOptions}</select></label>
              <label className="field">Half day?<select name="half_day" defaultValue="none"><option value="none">Full day(s)</option><option value="first_half">First half</option><option value="second_half">Second half</option></select></label>
              <label className="field">From<input type="date" name="from_date" required /></label>
              <label className="field">To<input type="date" name="to_date" /><span className="help">Leave empty for one day</span></label>
              <label className="field full">Reason<input name="reason" /></label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>Adjust a balance</h2>
            <p className="muted" style={{ marginTop: -6 }}>Grant comp-off, correct a balance, or set the opening balance brought over from your old system.</p>
            <ActionForm action={adjustBalance} submitLabel="Save" className="formgrid" hidden={{ year: String(year) }} resetOnSuccess>
              <label className="field full">Employee<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>{empOptions}</select></label>
              <label className="field">Leave type<select name="leave_type_id" required>{typeOptions}</select></label>
              <label className="field">Kind<select name="kind" defaultValue="adjustment"><option value="adjustment">Add / deduct</option><option value="opening">Opening balance</option></select></label>
              <label className="field">Days<input type="number" name="days" step="0.5" min={-365} max={365} required /><span className="help">Negative to deduct</span></label>
              <label className="field">Note<input name="note" placeholder="Worked on 15 Aug" required /></label>
            </ActionForm>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>
          <span>Balances</span>
          <form method="get" className="row" style={{ gap: 6 }}>
            <input type="hidden" name="year" value={year} />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or code" style={{ width: 200 }} />
            <button className="btn secondary small">Search</button>
          </form>
        </h2>
        {shown.length && balTypes.length ? (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Employee</th>{balTypes.map((t) => <th key={t.id} className="num" title={t.name}>{t.code}</th>)}</tr></thead>
              <tbody>
                {shown.slice(0, 300).map((e) => (
                  <tr key={e.id}>
                    <td><a href={p(`/app/employees/${e.id}`)}>{fullName(e)}</a> <small className="mono muted">{e.employee_code ?? ""}</small></td>
                    {balTypes.map((t) => {
                      const b = balances.get(e.id)?.get(t.id);
                      return <td key={t.id} className="num" title={b ? `Credited ${fmtDays(b.credited)}, taken ${fmtDays(b.availed)}` : ""}>
                        <b style={{ color: b && b.balance < 0 ? "var(--danger)" : undefined }}>{b ? fmtDays(b.balance) : "0"}</b>
                        {b?.pending ? <small className="muted"> ({fmtDays(b.pending)} pending)</small> : null}
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 300 && <p className="muted" style={{ padding: 10 }}>Showing 300 of {shown.length}; search to narrow down.</p>}
          </div>
        ) : <Empty>No active employees.</Empty>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recent requests</h2>
        {recent?.length ? (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th className="num">Days</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map((r) => {
                  const e = Array.isArray(r.employee) ? r.employee[0] : r.employee;
                  const t = Array.isArray(r.leave_type) ? r.leave_type[0] : r.leave_type;
                  return (
                    <tr key={r.id}>
                      <td>{e ? fullName(e) : "—"}</td>
                      <td><b style={{ color: t?.color }}>{t?.code}</b></td>
                      <td>{fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtDate(r.to_date)}` : ""}{r.half_day !== "none" ? ` (${r.half_day === "first_half" ? "1st" : "2nd"} half)` : ""}</td>
                      <td className="num">{fmtDays(r.days)}</td>
                      <td><span className={`badge ${STATUS_TONE[r.status]}`}>{r.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>No leave requests yet.</Empty>}
      </div>

      {hr && (
        <div className="grid three" style={{ marginTop: 16 }}>
          <div className="card">
            <h2>Credits</h2>
            <p className="muted">Yearly and monthly credits are added automatically every morning. Run now after adding employees or changing quotas.</p>
            <ActionForm action={runCredits} submitLabel={`Add credits due for ${leaveYearLabel(year, sm)}`} variant="secondary" hidden={{ year: String(year) }} />
          </div>
          <div className="card">
            <h2>Opening balances</h2>
            <p className="muted">CSV with <span className="mono">Employee Code</span> then one column per leave code, e.g. <span className="mono">Employee Code,CL,SL,EL</span>.</p>
            <ActionForm action={importOpeningBalances} submitLabel="Import" variant="secondary" hidden={{ year: String(year) }}>
              <input type="file" name="file" accept=".csv,text/csv" required />
            </ActionForm>
          </div>
          <div className="card">
            <h2>Close the year</h2>
            <p className="muted">Carries unused balance into the next year up to each type&apos;s limit; the rest lapses. Safe to repeat.</p>
            {year < current
              ? <ActionForm action={closeYear} submitLabel={`Close ${leaveYearLabel(year, sm)}`} variant="secondary" hidden={{ year: String(year) }} confirm={`Carry forward and lapse balances for ${leaveYearLabel(year, sm)}?`} />
              : <p><small className="muted">Available once {leaveYearLabel(year, sm)} has ended.</small></p>}
          </div>
        </div>
      )}
    </AppShell>
  );
}
