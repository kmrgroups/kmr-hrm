import { notFound } from "next/navigation";
import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMonth } from "@/lib/attendance/month";
import { fmtMonth, isMonth, istToday, shiftMonth } from "@/lib/attendance/time";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { MonthNav, MonthTable, TotalsCards, monthTotals } from "@/components/attendance";
import { fullName, one } from "@/components/ui";
import { addManualPunch, recomputeRange } from "../../actions";

export const metadata = { title: "Employee attendance" };

export default async function EmployeeAttendance({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireRole([...HR_ROLES, "manager", "payroll"]);
  const hr = hasRole(session.user, HR_ROLES);
  const today = istToday();
  const month = isMonth(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const supabase = await createClient();

  const { data: emp } = await supabase.from("employees").select("id,first_name,last_name,employee_code,attendance_id,shift_id,weekly_offs,department:departments(name),shift:shifts(code,name)").eq("id", id).maybeSingle();
  if (!emp) notFound();
  const m = await loadMonth(supabase, id, month);
  const totals = monthTotals(m.rows);
  const shift = one(emp.shift);
  const next = month < today.slice(0, 7) ? shiftMonth(month, 1) : null;

  return (
    <AppShell session={session} active="/app/attendance">
      <div className="pagehead">
        <div>
          <h1>{fullName(emp)}</h1>
          <p><span className="mono">{emp.employee_code ?? "—"}</span> · {one(emp.department)?.name ?? "No department"} · Device ID {emp.attendance_id ?? emp.employee_code ?? "not set"} · {shift ? `${shift.code} — ${shift.name}` : "Shift detected from punches"}</p>
        </div>
        <div className="row">
          <MonthNav month={month} prev={shiftMonth(month, -1)} next={next} label={fmtMonth(month)} />
          <a className="btn secondary" href={p(`/app/employees/${id}`)}>Profile</a>
        </div>
      </div>

      <TotalsCards t={totals} />
      <div style={{ marginTop: 16 }}>
        <MonthTable days={m.days.filter((d) => d <= today)} rows={m.rows} shiftCodes={m.shiftCodes} punches={m.punches} />
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>ᴹ = added by HR · ᴿ = from an approved correction request</p>
      </div>

      {hr && (
        <div className="grid two" style={{ marginTop: 16 }}>
          <div className="card">
            <h2>Add a missing punch</h2>
            <ActionForm action={addManualPunch} submitLabel="Add punch" className="formgrid" hidden={{ employee_id: id }} resetOnSuccess>
              <label className="field">Date<input type="date" name="date" max={today} required /></label>
              <label className="field">Time<input type="time" name="time" required /></label>
              <label className="check full"><input type="checkbox" name="next_day" value="1" /> Time is on the next morning (night shift out-punch)</label>
              <label className="field full">Reason<input name="reason" placeholder="Device was offline" /></label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>Recalculate this month</h2>
            <p className="muted">Use after changing this employee&apos;s shift, weekly off or device ID.</p>
            <ActionForm action={recomputeRange} submitLabel="Recalculate" pendingLabel="Recalculating…" hidden={{ employee_id: id, from: m.from, to: m.to }} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
