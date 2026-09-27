import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { istTime } from "@/lib/attendance/time";
import { fmtDays, leaveYearOf } from "@/lib/leave/rules";
import { loadBalances, startMonthOf } from "@/lib/leave/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { DayBadge } from "@/components/attendance";
import { Empty, fmtDate, fmtDateTime, fullName, one } from "@/components/ui";
import type { DayStatus } from "@/lib/attendance/compute";
import { decideLeave, decideRegularisation } from "./actions";

export const metadata = { title: "Approvals" };

type Emp = { first_name: string; last_name: string | null; employee_code: string | null };

function Decide({ action, id }: { action: typeof decideLeave; id: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
      <ActionForm action={action} submitLabel="Approve" hidden={{ id, decision: "approve" }} className="row">
        <input name="comment" placeholder="Comment (optional)" style={{ width: 180 }} />
      </ActionForm>
      <ActionForm action={action} submitLabel="Reject" variant="danger" hidden={{ id, decision: "reject" }} className="row">
        <input name="comment" placeholder="Reason" style={{ width: 160 }} />
      </ActionForm>
    </div>
  );
}

export default async function Approvals() {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const supabase = await createClient();
  const me = session.user.employee_id;
  // Row-level security already limits managers to their team; own requests are excluded (someone else decides them).
  const [{ data: leaves }, { data: regs }, { data: done }] = await Promise.all([
    supabase.from("leave_requests").select("id,employee_id,from_date,to_date,half_day,days,reason,created_at,leave_type_id,leave_type:leave_types(code,name,color,requires_balance),employee:employees(first_name,last_name,employee_code)")
      .eq("status", "pending").order("from_date"),
    supabase.from("regularisation_requests").select("id,employee_id,work_date,in_time,out_time,reason,created_at,employee:employees(first_name,last_name,employee_code)")
      .eq("status", "pending").order("work_date"),
    supabase.from("leave_requests").select("id,from_date,to_date,days,status,decided_at,leave_type:leave_types(code),employee:employees(first_name,last_name)")
      .in("status", ["approved", "rejected"]).not("decided_at", "is", null).order("decided_at", { ascending: false }).limit(10),
  ]);
  const myLeaves = (leaves ?? []).filter((l) => l.employee_id !== me);
  const myRegs = (regs ?? []).filter((r) => r.employee_id !== me);

  const sm = startMonthOf(session.tenant);
  const empIds = [...new Set(myLeaves.map((l) => l.employee_id))];
  const years = [...new Set(myLeaves.map((l) => leaveYearOf(l.from_date, sm)))];
  const balByYear = new Map<number, Awaited<ReturnType<typeof loadBalances>>>();
  for (const y of years) balByYear.set(y, await loadBalances(createAdminClient(), session.tenant.id, empIds, y));

  const { data: days } = myRegs.length
    ? await supabase.from("attendance_days").select("employee_id,work_date,status,first_in,last_out,leave_type_code").in("employee_id", myRegs.map((r) => r.employee_id)).in("work_date", myRegs.map((r) => r.work_date))
    : { data: [] };

  return (
    <AppShell session={session} active="/app/approvals">
      <div className="pagehead"><div><h1>Approvals</h1><p>Leave and attendance corrections waiting for you. The employee is emailed when you decide.</p></div></div>

      <div className="card">
        <h2>Leave requests ({myLeaves.length})</h2>
        {myLeaves.length ? (
          <div className="stack">
            {myLeaves.map((l) => {
              const e = one(l.employee) as Emp | null;
              const t = one(l.leave_type);
              const b = balByYear.get(leaveYearOf(l.from_date, sm))?.get(l.employee_id)?.get(l.leave_type_id);
              return (
                <div key={l.id} className="spread" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12, alignItems: "flex-start" }}>
                  <div>
                    <b>{e ? fullName(e) : "—"}</b> <small className="mono muted">{e?.employee_code ?? ""}</small><br />
                    <span style={{ color: t?.color, fontWeight: 700 }}>{t?.code}</span> {t?.name} · {fmtDate(l.from_date)}{l.to_date !== l.from_date ? ` – ${fmtDate(l.to_date)}` : ""}{l.half_day !== "none" ? ` (${l.half_day === "first_half" ? "first" : "second"} half)` : ""} · <b>{fmtDays(l.days)} day(s)</b><br />
                    <small className="muted">{l.reason ? `“${l.reason}” · ` : ""}Applied {fmtDateTime(l.created_at)}{t?.requires_balance ? ` · Balance ${fmtDays(b?.balance ?? 0)}` : ""}</small>
                    {t?.requires_balance && (b?.balance ?? 0) < Number(l.days) && <div><span className="badge danger">Not enough balance</span></div>}
                  </div>
                  <Decide action={decideLeave} id={l.id} />
                </div>
              );
            })}
          </div>
        ) : <Empty>No leave requests waiting.</Empty>}
      </div>

      <div className="card">
        <h2>Attendance corrections ({myRegs.length})</h2>
        {myRegs.length ? (
          <div className="stack">
            {myRegs.map((r) => {
              const e = one(r.employee) as Emp | null;
              const d = (days ?? []).find((x) => x.employee_id === r.employee_id && x.work_date === r.work_date);
              return (
                <div key={r.id} className="spread" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12, alignItems: "flex-start" }}>
                  <div>
                    <b>{e ? fullName(e) : "—"}</b> <small className="mono muted">{e?.employee_code ?? ""}</small> · <a href={p(`/app/attendance/employee/${r.employee_id}?month=${r.work_date.slice(0, 7)}`)}>{fmtDate(r.work_date)}</a><br />
                    Asks for in <b className="mono">{r.in_time?.slice(0, 5) ?? "—"}</b>, out <b className="mono">{r.out_time?.slice(0, 5) ?? "—"}</b>
                    {d && <> · now recorded: {d.first_in ? istTime(d.first_in) : "—"} / {d.last_out ? istTime(d.last_out) : "—"} <DayBadge status={d.status as DayStatus} code={d.leave_type_code} /></>}<br />
                    <small className="muted">“{r.reason}” · Asked {fmtDateTime(r.created_at)}</small>
                  </div>
                  <Decide action={decideRegularisation} id={r.id} />
                </div>
              );
            })}
          </div>
        ) : <Empty>No corrections waiting.</Empty>}
      </div>

      {(done?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Recently decided leave</h2>
          <ul className="timeline">
            {done!.map((d) => {
              const e = one(d.employee) as Emp | null;
              return <li key={d.id}><span>{e ? fullName(e) : ""} · {one(d.leave_type)?.code} {fmtDate(d.from_date)}{d.to_date !== d.from_date ? ` – ${fmtDate(d.to_date)}` : ""} · <span className={`badge ${d.status === "approved" ? "ok" : "danger"}`}>{d.status}</span></span><small>{fmtDateTime(d.decided_at)}</small></li>;
            })}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
