import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentOrigin } from "@/lib/tenant";
import { fromMinutes, toMinutes, weekday } from "@/lib/attendance/time";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fmtDateTime } from "@/components/ui";
import { addDevice, addHoliday, copyHolidays, deleteHoliday, saveAttendanceOptions, saveShift, toggleDevice, toggleShift } from "./actions";

export const metadata = { title: "Attendance setup" };

type Shift = { id: string; code: string; name: string; start_time: string; end_time: string; break_minutes: number; grace_in_minutes: number; grace_out_minutes: number; half_day_minutes: number; full_day_minutes: number; active: boolean };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hrs = (m: number) => (m / 60).toFixed(m % 60 ? 1 : 0);

function ShiftFields({ s }: { s?: Shift }) {
  return (
    <>
      <label className="field">Code<input name="code" defaultValue={s?.code} placeholder="G" maxLength={4} required /></label>
      <label className="field">Name<input name="name" defaultValue={s?.name} placeholder="General shift" required /></label>
      <label className="field">Starts<input type="time" name="start_time" defaultValue={s?.start_time.slice(0, 5) ?? "09:00"} required /></label>
      <label className="field">Ends<input type="time" name="end_time" defaultValue={s?.end_time.slice(0, 5) ?? "17:30"} required /><span className="help">Earlier than start = next morning</span></label>
      <label className="field">Break (minutes)<input type="number" name="break_minutes" defaultValue={s?.break_minutes ?? 30} min={0} max={240} /></label>
      <label className="field">Late after (minutes grace)<input type="number" name="grace_in_minutes" defaultValue={s?.grace_in_minutes ?? 10} min={0} max={120} /></label>
      <label className="field">Early-leaving grace (minutes)<input type="number" name="grace_out_minutes" defaultValue={s?.grace_out_minutes ?? 10} min={0} max={120} /></label>
      <label className="field">Half day from (minutes worked)<input type="number" name="half_day_minutes" defaultValue={s?.half_day_minutes ?? 240} min={60} max={900} /></label>
      <label className="field">Full day from (minutes worked)<input type="number" name="full_day_minutes" defaultValue={s?.full_day_minutes ?? 450} min={60} max={1200} /></label>
    </>
  );
}

export default async function AttendanceSetup({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const sp = await searchParams;
  const year = Number(sp.year) > 2000 ? Number(sp.year) : new Date().getFullYear();
  const supabase = await createClient();
  const [{ data: shifts }, { data: holidays }, { data: devices }, { data: plants }, { data: assigned }] = await Promise.all([
    supabase.from("shifts").select("*").order("start_time"),
    supabase.from("holidays").select("id,holiday_date,name,plant:plants(name)").gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`).order("holiday_date"),
    supabase.from("attendance_devices").select("id,name,kind,serial_no,last_seen_at,last_ip,active,plant:plants(name)").order("created_at"),
    supabase.from("plants").select("id,name").eq("active", true).order("name"),
    supabase.from("employees").select("shift_id").eq("status", "active").not("shift_id", "is", null).limit(10000),
  ]);
  const uses = new Map<string, number>();
  for (const a of assigned ?? []) uses.set(a.shift_id, (uses.get(a.shift_id) ?? 0) + 1);
  const origin = await currentOrigin();
  const host = new URL(origin).host;
  const s = session.tenant.settings ?? {};

  return (
    <AppShell session={session} active="/app/settings/attendance">
      <div className="pagehead"><div><h1>Attendance setup</h1><p>Shifts, holidays and biometric devices. Each employee&apos;s device ID, shift and weekly off are set on their page.</p></div></div>

      <div className="card">
        <h2>Shifts</h2>
        <p className="muted">Employees with no fixed shift are matched to the shift that starts closest to their first punch — this handles rotating A / B / C shifts without a roster.</p>
        <div className="tablewrap" style={{ marginBottom: 12 }}>
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Timing</th><th>Break</th><th>Late after</th><th>Half / full day</th><th className="num">Fixed for</th><th></th></tr></thead>
            <tbody>
              {((shifts ?? []) as Shift[]).map((sh) => {
                const len = ((toMinutes(sh.end_time) - toMinutes(sh.start_time) + 1440) % 1440) || 1440;
                return (
                  <tr key={sh.id} style={{ opacity: sh.active ? 1 : 0.55 }}>
                    <td><b>{sh.code}</b></td>
                    <td>{sh.name}{!sh.active && <> <span className="badge">Hidden</span></>}</td>
                    <td className="mono">{sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)} <small className="muted">({hrs(len)} h{toMinutes(sh.end_time) <= toMinutes(sh.start_time) ? ", overnight" : ""})</small></td>
                    <td>{sh.break_minutes} min</td>
                    <td>{fromMinutes(toMinutes(sh.start_time) + sh.grace_in_minutes)}</td>
                    <td>{hrs(sh.half_day_minutes)} h / {hrs(sh.full_day_minutes)} h</td>
                    <td className="num">{uses.get(sh.id) ?? 0}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <details style={{ display: "inline-block", textAlign: "left" }}>
                        <summary className="btn ghost small">Edit</summary>
                        <div className="card" style={{ position: "absolute", right: 24, zIndex: 5, width: "min(640px, 90vw)", marginTop: 6 }}>
                          <ActionForm action={saveShift} submitLabel="Save shift" className="formgrid" hidden={{ id: sh.id }}><ShiftFields s={sh} /></ActionForm>
                        </div>
                      </details>
                      <form action={toggleShift} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={sh.id} /><input type="hidden" name="active" value={sh.active ? "0" : "1"} />
                        <button className="btn ghost small">{sh.active ? "Hide" : "Restore"}</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details>
          <summary className="btn secondary small">Add a shift</summary>
          <div style={{ marginTop: 12 }}><ActionForm action={saveShift} submitLabel="Add shift" className="formgrid" resetOnSuccess><ShiftFields /></ActionForm></div>
        </details>
      </div>

      <div className="card">
        <h2>
          <span>Holidays {year}</span>
          <span className="row" style={{ gap: 6 }}>
            <a className="btn secondary small" href={`?year=${year - 1}`}>← {year - 1}</a>
            <a className="btn secondary small" href={`?year=${year + 1}`}>{year + 1} →</a>
          </span>
        </h2>
        <ActionForm action={addHoliday} submitLabel="Add holiday" className="formgrid" resetOnSuccess>
          <label className="field">Date<input type="date" name="holiday_date" min={`${year}-01-01`} max={`${year}-12-31`} required /></label>
          <label className="field">Name<input name="name" placeholder="Kannada Rajyotsava" required /></label>
          <label className="field">Applies to<select name="plant_id" defaultValue=""><option value="">All plants</option>{(plants ?? []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name} only</option>)}</select></label>
        </ActionForm>
        {holidays?.length ? (
          <div className="tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Plants</th><th></th></tr></thead>
              <tbody>
                {holidays.map((h) => {
                  const pl = Array.isArray(h.plant) ? h.plant[0] : h.plant;
                  return (
                    <tr key={h.id}>
                      <td>{fmtDate(h.holiday_date)}</td><td>{DOW[weekday(h.holiday_date)]}</td><td>{h.name}</td><td>{pl?.name ?? "All"}</td>
                      <td style={{ textAlign: "right" }}><form action={deleteHoliday}><input type="hidden" name="id" value={h.id} /><button className="btn ghost small">Remove</button></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Empty>No holidays in {year} yet.</Empty>
            <ActionForm action={copyHolidays} submitLabel={`Copy ${year - 1}'s holidays to ${year}`} variant="secondary" hidden={{ year: String(year) }} />
          </div>
        )}
      </div>

      <div className="card">
        <h2>Biometric devices</h2>
        {devices?.length ? (
          <div className="tablewrap" style={{ marginBottom: 12 }}>
            <table>
              <thead><tr><th>Device</th><th>Connection</th><th>Plant</th><th>Last punch received</th><th></th></tr></thead>
              <tbody>
                {devices.map((d) => {
                  const pl = Array.isArray(d.plant) ? d.plant[0] : d.plant;
                  return (
                    <tr key={d.id} style={{ opacity: d.active ? 1 : 0.55 }}>
                      <td><b>{d.name}</b>{d.serial_no && <><br /><small className="mono muted">SN {d.serial_no}</small></>}</td>
                      <td>{d.kind === "adms" ? "Direct push (ADMS)" : "API / bridge"}</td>
                      <td>{pl?.name ?? "—"}</td>
                      <td>{d.last_seen_at ? <>{fmtDateTime(d.last_seen_at)}<br /><small className="muted">{d.last_ip}</small></> : <span className="badge warn">Never</span>}</td>
                      <td style={{ textAlign: "right" }}><form action={toggleDevice}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="active" value={d.active ? "0" : "1"} /><button className="btn ghost small">{d.active ? "Disable" : "Enable"}</button></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No devices connected yet. You can still import punch files from the Attendance page.</p>}

        <details>
          <summary className="btn secondary small">Connect a device</summary>
          <div style={{ marginTop: 12 }}>
            <ActionForm action={addDevice} submitLabel="Add device" className="formgrid" resetOnSuccess>
              <label className="field">Name<input name="name" placeholder="Main gate" required /></label>
              <label className="field">Connection
                <select name="kind" defaultValue="adms">
                  <option value="adms">Direct push — eSSL / ZKTeco with cloud (ADMS) setting</option>
                  <option value="api">API key — bridge software or other brands</option>
                </select>
              </label>
              <label className="field">Serial number<input name="serial_no" placeholder="Needed for direct push" /></label>
              <label className="field">Plant<select name="plant_id" defaultValue=""><option value="">—</option>{(plants ?? []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</select></label>
            </ActionForm>
            <div className="grid two" style={{ marginTop: 14, fontSize: 13.5 }}>
              <div className="alert info">
                <b>Direct push (eSSL / ZKTeco)</b><br />
                On the device: Menu → Comm. → Cloud Server Setting. Server address <span className="mono">{host}</span>, port <span className="mono">443</span>, HTTPS on{origin.replace(/^https?:\/\/[^/]+/, "") ? <>, server path <span className="mono">{origin.replace(/^https?:\/\/[^/]+/, "")}</span></> : null}.
                Devices that cannot use HTTPS or a server path need the API bridge instead.
              </div>
              <div className="alert info">
                <b>API / bridge</b><br />
                POST <span className="mono">{origin}/api/attendance/punches</span><br />
                Header <span className="mono">Authorization: Bearer &lt;API key&gt;</span><br />
                Body <span className="mono">{`{"punches":[{"user_id":"101","time":"2026-09-21 09:02:00"}]}`}</span>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div className="card">
        <h2>Options</h2>
        <ActionForm action={saveAttendanceOptions} submitLabel="Save options" className="formgrid">
          <label className="field">Minimum overtime (minutes)<input type="number" name="ot_min_minutes" defaultValue={s.ot_min_minutes ?? 30} min={0} max={240} /><span className="help">Extra time below this is not counted as overtime</span></label>
          <label className="field">Employees may correct attendance for the last (days)<input type="number" name="employee_can_regularise_days" defaultValue={s.employee_can_regularise_days ?? 30} min={0} max={90} /><span className="help">0 = only HR can correct</span></label>
        </ActionForm>
      </div>
    </AppShell>
  );
}
