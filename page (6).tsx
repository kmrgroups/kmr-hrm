import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { addDays, fmtDuration, isDate, istTime, istToday } from "@/lib/attendance/time";
import type { DayStatus } from "@/lib/attendance/compute";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { DayBadge } from "@/components/attendance";
import { Empty, fullName, fmtDate, one } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { recomputeRange } from "./actions";

export const metadata = { title: "Attendance" };

type Emp = { id: string; first_name: string; last_name: string | null; employee_code: string | null; attendance_id: string | null; plant_id: string | null; department: { name: string } | { name: string }[] | null };
type Day = { employee_id: string; status: DayStatus; first_in: string | null; last_out: string | null; worked_minutes: number; late_minutes: number; ot_minutes: number; leave_type_code: string | null; remarks: string | null; shift_id: string | null };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; plant?: string; show?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager", "payroll"]);
  const hr = hasRole(session.user, HR_ROLES);
  const sp = await searchParams;
  const today = istToday();
  const date = isDate(sp.date) && sp.date <= today ? sp.date : today;
  const plant = sp.plant ?? "";
  const show = sp.show ?? "all";
  const supabase = await createClient();

  const [emps, { data: days }, { data: plants }, { data: shifts }, { count: pendingCount }] = await Promise.all([
    fetchAll<Emp>((a, b) => {
      let q = supabase.from("employees").select("id,first_name,last_name,employee_code,attendance_id,plant_id,department:departments(name)").eq("status", "active");
      if (plant) q = q.eq("plant_id", plant);
      return q.order("first_name").range(a, b);
    }),
    supabase.from("attendance_days").select("employee_id,status,first_in,last_out,worked_minutes,late_minutes,ot_minutes,leave_type_code,remarks,shift_id").eq("work_date", date).limit(10000),
    supabase.from("plants").select("id,name").eq("active", true).order("name"),
    supabase.from("shifts").select("id,code"),
    supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const byEmp = new Map(((days ?? []) as Day[]).map((d) => [d.employee_id, d]));
  const shiftCode = new Map((shifts ?? []).map((s) => [s.id, s.code]));

  const rows = emps.map((e) => ({ e, d: byEmp.get(e.id) }));
  const count = (f: (d: Day | undefined) => boolean) => rows.filter((r) => f(r.d)).length;
  const stats = {
    present: count((d) => !!d && (d.status === "present" || d.status === "half_day" || (d.status === "half_leave" && !!d.first_in))),
    absent: count((d) => d?.status === "absent"),
    leave: count((d) => d?.status === "leave" || d?.status === "half_leave"),
    missed: count((d) => d?.status === "missed_punch"),
    late: count((d) => !!d && d.late_minutes > 0),
    none: count((d) => !d),
    noDevice: emps.filter((e) => !e.attendance_id && !e.employee_code).length,
  };
  const filters: Record<string, (d: Day | undefined) => boolean> = {
    all: () => true,
    present: (d) => !!d && ["present", "half_day"].includes(d.status),
    absent: (d) => d?.status === "absent" || (!d && date < today),
    leave: (d) => d?.status === "leave" || d?.status === "half_leave",
    missed: (d) => d?.status === "missed_punch",
    late: (d) => !!d && d.late_minutes > 0,
    none: (d) => !d,
  };
  const shown = rows.filter((r) => (filters[show] ?? filters.all)(r.d));
  const q = (o: Record<string, string>) => "?" + new URLSearchParams({ date, ...(plant ? { plant } : {}), ...o }).toString();
  const isToday = date === today;

  const Stat = ({ k, label, value, tone }: { k: string; label: string; value: number; tone?: string }) => (
    <a className={`card stat${show === k ? " accent" : ""}`} href={q({ show: show === k ? "all" : k })}>
      <div className="label">{label}</div><div className="value" style={{ color: tone }}>{value}</div>
    </a>
  );

  return (
    <AppShell session={session} active="/app/attendance">
      <div className="pagehead">
        <div><h1>Attendance</h1><p>{fmtDate(date)}{isToday ? " · today, updates as punches arrive" : ""}</p></div>
        <div className="row">
          <a className="btn secondary" href={p("/app/attendance/register")}><Icon name="list" /> Monthly register</a>
          {hr && <a className="btn secondary" href={p("/app/attendance/import")}><Icon name="upload" /> Import punches</a>}
          <a className="btn" href={p("/app/approvals")}><Icon name="inbox" /> Approvals{pendingCount ? ` (${pendingCount})` : ""}</a>
        </div>
      </div>

      <form className="toolbar row" method="get" style={{ marginBottom: 16 }}>
        <a className="btn secondary small" href={q({ date: addDays(date, -1) })}>← Previous day</a>
        <input type="date" name="date" defaultValue={date} max={today} style={{ width: "auto" }} />
        {(plants?.length ?? 0) > 1 && (
          <select name="plant" defaultValue={plant} style={{ width: "auto" }}>
            <option value="">All plants</option>
            {plants!.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>
        )}
        <button className="btn secondary small">Show</button>
        {!isToday && <a className="btn secondary small" href={q({ date: addDays(date, 1) })}>Next day →</a>}
      </form>

      <div className="grid four" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Stat k="present" label="Present" value={stats.present} tone="var(--ok)" />
        <Stat k="absent" label="Absent" value={stats.absent + (isToday ? 0 : stats.none)} tone={stats.absent ? "var(--danger)" : undefined} />
        <Stat k="leave" label="On leave" value={stats.leave} />
        <Stat k="missed" label="Missed punch" value={stats.missed} tone={stats.missed ? "var(--warn)" : undefined} />
        <Stat k="late" label="Late" value={stats.late} />
        {isToday && <Stat k="none" label="Not in yet" value={stats.none} />}
      </div>

      {hr && stats.noDevice > 0 && (
        <div className="alert warn" style={{ marginTop: 16 }}>
          {stats.noDevice} active employee(s) have neither an employee code nor a device ID, so their punches cannot be matched. Set the device ID on each employee&apos;s page.
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {shown.length ? (
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Employee</th><th>Department</th><th>Shift</th><th>In</th><th>Out</th><th className="num">Worked</th><th>Status</th><th>Late</th></tr></thead>
              <tbody>
                {shown.map(({ e, d }) => (
                  <tr key={e.id}>
                    <td><a href={p(`/app/attendance/employee/${e.id}?month=${date.slice(0, 7)}`)}><b>{fullName(e)}</b></a><br /><small className="mono muted">{e.employee_code ?? ""}</small></td>
                    <td>{one(e.department)?.name ?? "—"}</td>
                    <td>{d?.shift_id ? shiftCode.get(d.shift_id) : ""}</td>
                    <td className="mono">{d?.first_in ? istTime(d.first_in) : "—"}</td>
                    <td className="mono">{d?.last_out ? istTime(d.last_out) : "—"}</td>
                    <td className="num">{d ? fmtDuration(d.worked_minutes) : ""}</td>
                    <td>{d ? <DayBadge status={d.status} code={d.leave_type_code} /> : <span className="badge">{isToday ? "Not in yet" : "No record"}</span>}{d?.remarks && <div><small className="muted">{d.remarks}</small></div>}</td>
                    <td>{d?.late_minutes ? <small>{d.late_minutes} min</small> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{emps.length ? "No one matches this filter." : "No active employees yet."}</Empty>}
      </div>

      {hr && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Recalculate attendance</summary>
          <p className="muted" style={{ marginTop: 8 }}>Attendance is calculated automatically when punches, leave or corrections arrive, and every morning for the previous day. Recalculate after changing shifts, holidays or weekly offs.</p>
          <ActionForm action={recomputeRange} submitLabel="Recalculate" pendingLabel="Recalculating…" className="formgrid">
            <label className="field">From<input type="date" name="from" defaultValue={date} max={today} required /></label>
            <label className="field">To<input type="date" name="to" defaultValue={date} max={today} required /></label>
          </ActionForm>
        </details>
      )}
    </AppShell>
  );
}
