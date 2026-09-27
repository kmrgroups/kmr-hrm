import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cellCode, loadRegister } from "@/lib/attendance/register";
import { STATUS_META } from "@/lib/attendance/compute";
import { fmtMonth, isMonth, istToday, shiftMonth, weekday } from "@/lib/attendance/time";
import { fmtDays } from "@/lib/leave/rules";
import { AppShell } from "@/components/AppShell";
import { MonthNav } from "@/components/attendance";
import { Empty } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Monthly register" };

const TONE: Record<string, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", info: "var(--info)", "": "var(--muted)" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ month?: string; plant?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager", "payroll"]);
  const sp = await searchParams;
  const today = istToday();
  const month = isMonth(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const plant = sp.plant ?? "";
  const supabase = await createClient();
  const [{ days, list }, { data: plants }] = await Promise.all([
    loadRegister(supabase, month, plant || undefined),
    supabase.from("plants").select("id,name").eq("active", true).order("name"),
  ]);
  const next = month < today.slice(0, 7) ? shiftMonth(month, 1) : null;
  const extra = plant ? `plant=${plant}` : "";

  return (
    <AppShell session={session} active="/app/attendance">
      <div className="pagehead">
        <div><h1>Monthly register</h1><p>Muster roll for {fmtMonth(month)}. Totals are what payroll will use.</p></div>
        <div className="row">
          <MonthNav month={month} prev={shiftMonth(month, -1)} next={next} label={fmtMonth(month)} extra={extra} />
          <a className="btn" href={p(`/api/attendance/register?month=${month}${plant ? `&plant=${plant}` : ""}`)}><Icon name="download" /> Download CSV</a>
        </div>
      </div>

      {(plants?.length ?? 0) > 1 && (
        <form className="toolbar" method="get">
          <input type="hidden" name="month" value={month} />
          <select name="plant" defaultValue={plant}><option value="">All plants</option>{plants!.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</select>
          <button className="btn secondary small">Show</button>
        </form>
      )}

      <div className="row" style={{ gap: 12, marginBottom: 12, fontSize: 12.5 }}>
        {Object.values(STATUS_META).map((m) => <span key={m.short}><b style={{ color: TONE[m.tone] }}>{m.short}</b> {m.label}</span>)}
        <span><b>CL / SL / EL…</b> leave code · <u>underlined</u> = late</span>
      </div>

      {list.length ? (
        <div className="tablewrap">
          <table style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--surface-2)", zIndex: 1 }}>Employee</th>
                {days.map((d) => <th key={d} style={{ padding: "8px 4px", textAlign: "center", color: weekday(d) === 0 ? "var(--danger)" : undefined }}>{Number(d.slice(8))}</th>)}
                <th className="num">P</th><th className="num">L</th><th className="num">A</th><th className="num">WO/H</th><th className="num">OT h</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td style={{ position: "sticky", left: 0, background: "var(--surface)", whiteSpace: "nowrap", zIndex: 1 }}>
                    <a href={p(`/app/attendance/employee/${r.id}?month=${month}`)}>{r.name}</a><br /><small className="mono muted">{r.code ?? ""}</small>
                  </td>
                  {days.map((d) => {
                    const c = r.cells.get(d);
                    const tone = c ? TONE[STATUS_META[c.status].tone] : undefined;
                    return <td key={d} style={{ padding: "8px 4px", textAlign: "center", color: tone, fontWeight: 600, textDecoration: c?.late ? "underline" : undefined }}>{d > today ? "" : cellCode(c)}</td>;
                  })}
                  <td className="num"><b>{fmtDays(r.present)}</b></td>
                  <td className="num">{fmtDays(r.leave)}</td>
                  <td className="num" style={{ color: r.absent ? "var(--danger)" : undefined }}>{fmtDays(r.absent)}</td>
                  <td className="num">{r.offs}</td>
                  <td className="num">{r.ot ? (r.ot / 60).toFixed(1) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><Empty>No employees to show.</Empty></div>}
    </AppShell>
  );
}
