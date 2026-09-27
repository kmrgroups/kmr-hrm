import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDays, type LeaveTypeRule } from "@/lib/leave/rules";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { saveLeaveType, saveLeaveYear, toggleLeaveType } from "./actions";

export const metadata = { title: "Leave policy" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ACCRUAL = { yearly: "Credited at the start of the year", monthly: "Credited every month", none: "Granted by HR only" };

function TypeFields({ t }: { t?: LeaveTypeRule & { sort_order?: number } }) {
  const chk = (name: string, on: boolean | undefined, label: string, help?: string) => (
    <label className="check"><input type="checkbox" name={name} value="1" defaultChecked={on} /> <span>{label}{help && <><br /><small className="muted">{help}</small></>}</span></label>
  );
  return (
    <>
      <label className="field">Code<input name="code" defaultValue={t?.code} placeholder="CL" maxLength={6} required /></label>
      <label className="field">Name<input name="name" defaultValue={t?.name} placeholder="Casual leave" required /></label>
      <label className="field">Days per year<input type="number" step="0.5" name="annual_quota" defaultValue={t?.annual_quota ?? 12} min={0} max={365} /></label>
      <label className="field">How it is credited
        <select name="accrual" defaultValue={t?.accrual ?? "yearly"}>
          <option value="yearly">At the start of the year (pro-rated for joiners)</option>
          <option value="monthly">Monthly (1/12 each month)</option>
          <option value="none">Only when HR grants it (comp-off, maternity…)</option>
        </select>
      </label>
      <label className="field">Carry forward up to (days)<input type="number" step="0.5" name="carry_forward_max" defaultValue={t?.carry_forward_max ?? 0} min={0} max={365} /><span className="help">0 = unused days lapse at year end</span></label>
      <label className="field">Apply at least (days before)<input type="number" name="min_notice_days" defaultValue={t?.min_notice_days ?? 0} min={0} max={90} /></label>
      <label className="field">Max days per request<input type="number" step="0.5" name="max_days_per_request" defaultValue={t?.max_days_per_request ?? ""} min={0.5} max={365} placeholder="No limit" /></label>
      <label className="field">Colour<input type="color" name="color" defaultValue={t?.color ?? "#2563EB"} /></label>
      <input type="hidden" name="sort_order" value={t?.sort_order ?? 100} />
      <div className="full stack" style={{ gap: 8 }}>
        {chk("requires_balance", t ? t.requires_balance : true, "Needs a balance", "Untick for loss of pay — any number of days can be taken")}
        {chk("paid", t ? t.paid : true, "Paid leave", "Unpaid leave is counted as absent for payroll")}
        {chk("allow_half_day", t ? t.allow_half_day : true, "Can be taken for half a day")}
        {chk("count_non_working", t?.count_non_working, "Count weekly offs and holidays inside the leave (sandwich rule)")}
      </div>
    </>
  );
}

export default async function LeavePolicy() {
  const session = await requireRole(HR_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("leave_types").select("*").order("sort_order").order("code");
  const types = ((data ?? []) as (LeaveTypeRule & { sort_order: number })[]);
  const sm = session.tenant.settings?.leave_year_start_month ?? 1;

  return (
    <AppShell session={session} active="/app/settings/leave">
      <div className="pagehead"><div><h1>Leave policy</h1><p>Leave types, yearly quotas and rules. Balances are managed on the Leave page.</p></div></div>

      <div className="card">
        <h2>Leave types</h2>
        <div className="tablewrap" style={{ marginBottom: 12 }}>
          <table>
            <thead><tr><th>Type</th><th className="num">Days / year</th><th>Credit</th><th className="num">Carry forward</th><th>Rules</th><th></th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.55 }}>
                  <td><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: t.color, marginRight: 6 }} /><b>{t.code}</b> {t.name}{!t.active && <> <span className="badge">Hidden</span></>}</td>
                  <td className="num">{t.requires_balance ? fmtDays(t.annual_quota) : "—"}</td>
                  <td><small>{t.requires_balance ? ACCRUAL[t.accrual] : "No balance needed"}</small></td>
                  <td className="num">{Number(t.carry_forward_max) ? fmtDays(t.carry_forward_max) : "—"}</td>
                  <td><small>{[!t.paid && "unpaid", !t.allow_half_day && "full days only", t.count_non_working && "sandwich rule", t.min_notice_days && `${t.min_notice_days}d notice`, t.max_days_per_request && `max ${fmtDays(t.max_days_per_request)}d`].filter(Boolean).join(" · ") || "—"}</small></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <details style={{ display: "inline-block", textAlign: "left" }}>
                      <summary className="btn ghost small">Edit</summary>
                      <div className="card" style={{ position: "absolute", right: 24, zIndex: 5, width: "min(680px, 92vw)", marginTop: 6 }}>
                        <ActionForm action={saveLeaveType} submitLabel="Save" className="formgrid" hidden={{ id: t.id }}><TypeFields t={t} /></ActionForm>
                      </div>
                    </details>
                    <form action={toggleLeaveType} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={t.active ? "0" : "1"} />
                      <button className="btn ghost small">{t.active ? "Hide" : "Restore"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary className="btn secondary small">Add a leave type</summary>
          <div style={{ marginTop: 12 }}><ActionForm action={saveLeaveType} submitLabel="Add leave type" className="formgrid" resetOnSuccess><TypeFields /></ActionForm></div>
        </details>
      </div>

      <div className="card">
        <h2>Leave year</h2>
        <ActionForm action={saveLeaveYear} submitLabel="Save" className="formgrid">
          <label className="field">Leave year starts in
            <select name="leave_year_start_month" defaultValue={sm}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}{i === 0 ? " (January–December)" : i === 3 ? " (April–March)" : ""}</option>)}</select>
            <span className="help">Can only be changed before any leave is credited.</span>
          </label>
        </ActionForm>
      </div>
    </AppShell>
  );
}
