import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { fmtDateTime, Empty } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { importPunches } from "../actions";

export const metadata = { title: "Import punches" };

export default async function ImportPage() {
  const session = await requireRole(HR_ROLES);
  const supabase = await createClient();
  const unmatched = await fetchAll<{ attendance_id: string; punched_at: string }>((a, b) =>
    supabase.from("attendance_punches").select("attendance_id,punched_at").is("employee_id", null).order("punched_at", { ascending: false }).range(a, b));
  const groups = new Map<string, { n: number; last: string }>();
  for (const u of unmatched) {
    const g = groups.get(u.attendance_id);
    groups.set(u.attendance_id, { n: (g?.n ?? 0) + 1, last: g?.last ?? u.punched_at });
  }
  const list = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);

  return (
    <AppShell session={session} active="/app/attendance">
      <div className="pagehead"><div><h1>Import punches</h1><p>Upload the attendance log exported from your biometric software. Devices can also send punches directly — see Settings → Attendance setup.</p></div></div>

      <div className="grid two">
        <div className="card">
          <h2>Upload a file</h2>
          <ActionForm action={importPunches} submitLabel="Import" pendingLabel="Importing…">
            <label className="field">CSV or text file<input type="file" name="file" accept=".csv,.txt,.tsv,text/csv,text/plain" required /></label>
          </ActionForm>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>Importing the same file twice is safe — punches already stored are skipped. Each affected day is recalculated straight away.</p>
        </div>
        <div className="card">
          <h2>File format</h2>
          <p style={{ fontSize: 14 }}>Any export from eSSL eTimeTrackLite, ZKTeco, Matrix, Realtime or a spreadsheet works if it has:</p>
          <ul style={{ fontSize: 14, paddingLeft: 18 }}>
            <li>an <b>employee / user ID</b> column (the number enrolled on the device, or the employee code), and</li>
            <li>a <b>date-time</b> column — or separate <b>Date</b> and <b>Time</b> columns.</li>
          </ul>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12.5, overflowX: "auto" }}>{`Emp Code,Date,Time
101,21-09-2026,09:02
101,21-09-2026,17:41`}</pre>
          <p className="muted" style={{ fontSize: 13 }}>Dates as 21-09-2026, 21/09/2026 or 2026-09-21; times in 24-hour or AM/PM. Times are India time.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Device IDs not matched to anyone ({list.length})</h2>
        <p className="muted">Punches from these device users are kept. Open the employee, set their <b>Device ID</b> under Attendance, and their earlier punches are linked automatically.</p>
        {list.length ? (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Device ID</th><th className="num">Punches</th><th>Latest</th><th></th></tr></thead>
              <tbody>
                {list.slice(0, 200).map(([id, g]) => (
                  <tr key={id}><td className="mono"><b>{id}</b></td><td className="num">{g.n}</td><td>{fmtDateTime(g.last)}</td>
                    <td style={{ textAlign: "right" }}><a className="btn ghost small" href={p(`/app/employees?q=${encodeURIComponent(id)}`)}>Find employee</a></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Every punch is matched to an employee.</Empty>}
      </div>
    </AppShell>
  );
}
