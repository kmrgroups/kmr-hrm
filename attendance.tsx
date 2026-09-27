import { STATUS_META, type DayStatus } from "@/lib/attendance/compute";
import { fmtDuration, istTime, weekday } from "@/lib/attendance/time";

export function DayBadge({ status, code }: { status: DayStatus; code?: string | null }) {
  const m = STATUS_META[status];
  const label = (status === "leave" || status === "half_leave") && code ? `${status === "half_leave" ? "½ " : ""}${code}` : m.label;
  return <span className={`badge ${m.tone}`}>{label}</span>;
}

export interface DayRow {
  work_date: string; status: DayStatus; first_in: string | null; last_out: string | null; worked_minutes: number;
  late_minutes: number; early_minutes: number; ot_minutes: number; leave_type_code: string | null; remarks: string | null;
  present_days: number; leave_days: number; absent_days: number; shift_id: string | null;
}

export function monthTotals(rows: DayRow[]) {
  const sum = (k: keyof DayRow) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return {
    present: sum("present_days"), leave: sum("leave_days"), absent: sum("absent_days"),
    late: rows.filter((r) => r.late_minutes > 0).length, ot: sum("ot_minutes"),
    offs: rows.filter((r) => r.status === "weekly_off" || r.status === "holiday").length,
    missed: rows.filter((r) => r.status === "missed_punch").length,
  };
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day-by-day table for one employee's month */
export function MonthTable({ days, rows, shiftCodes, punches, actions }: {
  days: string[]; rows: DayRow[]; shiftCodes: Map<string, string>;
  punches: Map<string, string[]>;
  actions?: (date: string, row: DayRow | undefined) => React.ReactNode;
}) {
  const byDate = new Map(rows.map((r) => [r.work_date, r]));
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th className="num">Worked</th><th>Status</th><th>Late / early</th><th className="num">OT</th><th>All punches</th>{actions && <th></th>}</tr></thead>
        <tbody>
          {days.map((d) => {
            const r = byDate.get(d);
            const wd = weekday(d);
            return (
              <tr key={d} style={r?.status === "weekly_off" || r?.status === "holiday" ? { background: "var(--surface-2)" } : undefined}>
                <td style={{ whiteSpace: "nowrap" }}><b>{d.slice(8)}</b> <small className="muted">{DOW[wd]}</small></td>
                <td>{r?.shift_id ? shiftCodes.get(r.shift_id) ?? "" : ""}</td>
                <td className="mono">{r?.first_in ? istTime(r.first_in) : "—"}</td>
                <td className="mono">{r?.last_out ? istTime(r.last_out) : "—"}</td>
                <td className="num">{r ? fmtDuration(r.worked_minutes) : ""}</td>
                <td>{r ? <DayBadge status={r.status} code={r.leave_type_code} /> : <small className="muted">—</small>}{r?.remarks && <div><small className="muted">{r.remarks}</small></div>}</td>
                <td><small>{r?.late_minutes ? `Late ${r.late_minutes}m` : ""}{r?.late_minutes && r?.early_minutes ? " · " : ""}{r?.early_minutes ? `Early ${r.early_minutes}m` : ""}</small></td>
                <td className="num">{r?.ot_minutes ? fmtDuration(r.ot_minutes) : ""}</td>
                <td><small className="mono">{(punches.get(d) ?? []).join("  ")}</small></td>
                {actions && <td style={{ textAlign: "right" }}>{actions(d, r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TotalsCards({ t }: { t: ReturnType<typeof monthTotals> }) {
  return (
    <div className="grid four">
      <div className="card stat"><div className="label">Present days</div><div className="value">{t.present}</div><div className="hint">{t.late} late arrival{t.late === 1 ? "" : "s"}</div></div>
      <div className="card stat"><div className="label">Leave days</div><div className="value">{t.leave}</div><div className="hint">Paid leave</div></div>
      <div className="card stat"><div className="label">Absent / loss of pay</div><div className="value" style={{ color: t.absent ? "var(--danger)" : undefined }}>{t.absent}</div><div className="hint">{t.missed ? `${t.missed} missed punch${t.missed === 1 ? "" : "es"}` : "\u00a0"}</div></div>
      <div className="card stat"><div className="label">Overtime</div><div className="value" style={{ fontSize: "1.5rem" }}>{fmtDuration(t.ot)}</div><div className="hint">{t.offs} weekly off / holiday</div></div>
    </div>
  );
}

/** Month picker links: ← September 2026 → */
export function MonthNav({ month, prev, next, label, extra }: { month: string; prev: string; next: string | null; label: string; extra?: string }) {
  const q = extra ? `&${extra}` : "";
  return (
    <div className="row" style={{ gap: 6 }}>
      <a className="btn secondary small" href={`?month=${prev}${q}`}>←</a>
      <b style={{ minWidth: 130, textAlign: "center" }}>{label}</b>
      {next ? <a className="btn secondary small" href={`?month=${next}${q}`}>→</a> : <span className="btn secondary small" aria-disabled="true" style={{ opacity: 0.4 }}>→</span>}
      <input type="hidden" value={month} readOnly />
    </div>
  );
}
