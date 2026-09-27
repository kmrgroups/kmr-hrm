import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMonth } from "@/lib/attendance/month";
import { addDays, fmtMonth, isMonth, istToday, shiftMonth } from "@/lib/attendance/time";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { MonthNav, MonthTable, TotalsCards, monthTotals } from "@/components/attendance";
import { Empty, fmtDate } from "@/components/ui";
import { cancelCorrection, requestCorrection } from "../actions";

export const metadata = { title: "My attendance" };

const TONE: Record<string, string> = { pending: "warn", approved: "ok", rejected: "danger", cancelled: "" };

export default async function MyAttendance({ searchParams }: { searchParams: Promise<{ month?: string; fix?: string }> }) {
  const session = await requireSession();
  if (session.user.must_change_password) redirect("/account?first=1");
  const id = session.user.employee_id;
  if (!id) redirect("/app");
  const sp = await searchParams;
  const today = istToday();
  const month = isMonth(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const supabase = await createClient();
  const [m, { data: reqs }] = await Promise.all([
    loadMonth(supabase, id, month),
    supabase.from("regularisation_requests").select("id,work_date,in_time,out_time,reason,status,decision_comment,created_at").eq("employee_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  const window = session.tenant.settings?.employee_can_regularise_days ?? 30;
  const earliest = addDays(today, -window);
  const next = month < today.slice(0, 7) ? shiftMonth(month, 1) : null;
  const fix = sp.fix && sp.fix >= earliest && sp.fix <= today ? sp.fix : "";

  return (
    <AppShell session={session} active="/me/attendance">
      <div className="pagehead">
        <div><h1>My attendance</h1><p>Your punches and daily status. If something is wrong, ask for a correction.</p></div>
        <MonthNav month={month} prev={shiftMonth(month, -1)} next={next} label={fmtMonth(month)} />
      </div>

      <TotalsCards t={monthTotals(m.rows)} />
      <div style={{ marginTop: 16 }}>
        <MonthTable days={m.days.filter((d) => d <= today)} rows={m.rows} shiftCodes={m.shiftCodes} punches={m.punches}
          actions={window > 0 ? (d, r) => (d >= earliest && (!r || ["absent", "missed_punch", "half_day"].includes(r.status) || r.late_minutes > 0)
            ? <a className="btn ghost small" href={`?month=${month}&fix=${d}#fix`}>Correct</a> : null) : undefined} />
      </div>

      {window > 0 && (
        <div className="grid two" style={{ marginTop: 16 }}>
          <div className="card" id="fix">
            <h2>Ask for a correction</h2>
            <p className="muted" style={{ marginTop: -6 }}>Forgot to punch, or the device was down? Enter the correct times; your manager approves. Allowed for the last {window} days.</p>
            <ActionForm action={requestCorrection} submitLabel="Send to manager" className="formgrid" resetOnSuccess>
              <label className="field full">Date<input type="date" name="work_date" defaultValue={fix} min={earliest} max={today} required /></label>
              <label className="field">In time<input type="time" name="in_time" /></label>
              <label className="field">Out time<input type="time" name="out_time" /><span className="help">Earlier than in time = next morning</span></label>
              <label className="field full">What happened<input name="reason" placeholder="Forgot to punch out" required /></label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>My correction requests</h2>
            {reqs?.length ? (
              <ul className="timeline">
                {reqs.map((r) => (
                  <li key={r.id}>
                    <span>
                      <b>{fmtDate(r.work_date)}</b> · in {r.in_time?.slice(0, 5) ?? "—"}, out {r.out_time?.slice(0, 5) ?? "—"} <span className={`badge ${TONE[r.status]}`}>{r.status}</span><br />
                      <small className="muted">{r.reason}{r.decision_comment ? ` — ${r.decision_comment}` : ""}</small>
                    </span>
                    {r.status === "pending" && <ActionForm action={cancelCorrection} submitLabel="Cancel" variant="secondary" hidden={{ id: r.id }} />}
                  </li>
                ))}
              </ul>
            ) : <Empty>No requests yet.</Empty>}
          </div>
        </div>
      )}
    </AppShell>
  );
}
