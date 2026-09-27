import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/attendance/time";
import { fmtDays, leaveYearLabel, leaveYearOf } from "@/lib/leave/rules";
import { loadBalances, loadLeaveTypes, startMonthOf } from "@/lib/leave/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, one } from "@/components/ui";
import { applyLeave, cancelMyLeave } from "../actions";

export const metadata = { title: "My leave" };

const TONE: Record<string, string> = { pending: "warn", approved: "ok", rejected: "danger", cancelled: "" };

export default async function MyLeave() {
  const session = await requireSession();
  if (session.user.must_change_password) redirect("/account?first=1");
  const id = session.user.employee_id;
  if (!id) redirect("/app");
  const supabase = await createClient();
  const today = istToday();
  const sm = startMonthOf(session.tenant);
  const year = leaveYearOf(today, sm);
  const [types, balances, { data: reqs }] = await Promise.all([
    loadLeaveTypes(supabase, session.tenant.id),
    loadBalances(supabase, session.tenant.id, [id], year),   // row-level security: own rows only
    supabase.from("leave_requests").select("id,from_date,to_date,half_day,days,reason,status,decision_comment,created_at,leave_type:leave_types(code,name,color)")
      .eq("employee_id", id).order("from_date", { ascending: false }).limit(25),
  ]);
  const mine = balances.get(id);

  return (
    <AppShell session={session} active="/me/leave">
      <div className="pagehead"><div><h1>My leave</h1><p>Leave year {leaveYearLabel(year, sm)}</p></div></div>

      <div className="grid four" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {types.filter((t) => t.requires_balance).map((t) => {
          const b = mine?.get(t.id);
          return (
            <div key={t.id} className="card stat" style={{ borderTop: `3px solid ${t.color}` }}>
              <div className="label">{t.name}</div>
              <div className="value">{fmtDays(b?.balance ?? 0)}</div>
              <div className="hint">{fmtDays(b?.availed ?? 0)} taken{b?.pending ? ` · ${fmtDays(b.pending)} pending` : ""}</div>
            </div>
          );
        })}
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Apply for leave</h2>
          <ActionForm action={applyLeave} submitLabel="Apply" pendingLabel="Sending…" className="formgrid" resetOnSuccess>
            <label className="field full">Leave type<select name="leave_type_id" required>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.min_notice_days ? ` — apply ${t.min_notice_days} days ahead` : ""}</option>)}</select></label>
            <label className="field">From<input type="date" name="from_date" required /></label>
            <label className="field">To<input type="date" name="to_date" /><span className="help">Leave empty for one day</span></label>
            <label className="field full">Half day?<select name="half_day" defaultValue="none"><option value="none">No — full day(s)</option><option value="first_half">First half (morning)</option><option value="second_half">Second half (afternoon)</option></select></label>
            <label className="field full">Reason<input name="reason" placeholder="Family function" required maxLength={300} /></label>
          </ActionForm>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Weekly offs and holidays inside your dates are not counted unless the leave type says so.</p>
        </div>
        <div className="card">
          <h2>My requests</h2>
          {reqs?.length ? (
            <ul className="timeline">
              {reqs.map((r) => {
                const t = one(r.leave_type);
                const cancellable = r.status === "pending" || (r.status === "approved" && r.from_date > today);
                return (
                  <li key={r.id}>
                    <span>
                      <b style={{ color: t?.color }}>{t?.code}</b> {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtDate(r.to_date)}` : ""}{r.half_day !== "none" ? " (½)" : ""} · {fmtDays(r.days)}d <span className={`badge ${TONE[r.status]}`}>{r.status}</span>
                      {r.decision_comment && <><br /><small className="muted">{r.decision_comment}</small></>}
                    </span>
                    {cancellable && <ActionForm action={cancelMyLeave} submitLabel="Cancel" variant="secondary" hidden={{ id: r.id }} confirm="Cancel this leave request?" />}
                  </li>
                );
              })}
            </ul>
          ) : <Empty>No leave taken yet.</Empty>}
        </div>
      </div>
    </AppShell>
  );
}
