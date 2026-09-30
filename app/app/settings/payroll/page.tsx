import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/payroll/compute";
import { loadSetup } from "@/lib/payroll/service";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { PayrollTabs } from "@/app/app/payroll/nav";
import { saveComponent, savePaySettings } from "@/app/app/payroll/actions";

export const metadata = { title: "Payroll settings" };

const CALC: Record<string, string> = { percent_gross: "% of gross", percent_basic: "% of basic", fixed: "Fixed amount", balance: "Balance (what is left)" };

export default async function PayrollSettings() {
  const session = await requireRole(["hr_manager"]);
  const supabase = await createClient();
  const { settings: s, components } = await loadSetup(supabase, session.tenant.id);
  const slabs = [...(s.pt_slabs ?? []), ...Array(Math.max(0, 5 - (s.pt_slabs?.length ?? 0))).fill(null)];
  return (
    <AppShell session={session} active="/app/payroll">
      <div className="pagehead"><div><h1>Payroll settings</h1><p>The rules used when a month is worked out. Each finalised month keeps the rules it was worked out with.</p></div></div>
      <PayrollTabs active="settings" />
      <ActionForm action={savePaySettings} submitLabel="Save payroll settings">
        <div className="grid two">
          <div className="card">
            <h2>Pay days</h2>
            <div className="formgrid">
              <label className="field">Pay for a month is based on<select name="pay_basis" defaultValue={s.pay_basis}>
                <option value="calendar">Calendar days (28–31)</option><option value="fixed_30">30 days</option><option value="fixed_26">26 days</option></select></label>
              <label className="field">Loss of pay comes from<select name="lop_source" defaultValue={s.lop_source}>
                <option value="attendance">Attendance and leave (automatic)</option><option value="manual">Entered by HR on each payslip</option></select>
                <span className="help">Automatic: absent days, unpaid leave and past days with no attendance</span></label>
              <label className="check full"><input type="checkbox" name="labour_code_wages" defaultChecked={s.labour_code_wages} /> Labour Codes: PF on at least 50% of pay (Basic + DA below 50% is topped up)</label>
            </div>
          </div>
          <div className="card">
            <h2>Overtime</h2>
            <div className="formgrid">
              <label className="check full"><input type="checkbox" name="ot_enabled" defaultChecked={s.ot_enabled} /> Pay overtime from attendance</label>
              <label className="field">Rate (times ordinary)<input name="ot_multiplier" inputMode="decimal" defaultValue={s.ot_multiplier} /><span className="help">Factories Act: 2</span></label>
              <label className="field">Hours in a working day<input name="hours_per_day" inputMode="decimal" defaultValue={s.hours_per_day} /></label>
            </div>
          </div>
          <div className="card">
            <h2>Provident fund (PF)</h2>
            <div className="formgrid">
              <label className="check full"><input type="checkbox" name="pf_enabled" defaultChecked={s.pf_enabled} /> Company is registered for PF</label>
              <label className="field">PF wage ceiling (Rs.)<input name="pf_ceiling" inputMode="decimal" defaultValue={s.pf_ceiling} />
                <span className="help">Government limit. Rs. 15,000 since 2014; reported raised to Rs. 25,000 from 17 Sep 2026 — confirm with your PF consultant and update.</span></label>
              <label className="field">Pension (EPS) wage ceiling (Rs.)<input name="eps_ceiling" inputMode="decimal" defaultValue={s.eps_ceiling} /></label>
              <label className="check full"><input type="checkbox" name="pf_restrict" defaultChecked={s.pf_restrict} /> Contribute only on wages up to the ceiling</label>
              <label className="field">Admin charges %<input name="pf_admin_rate" inputMode="decimal" defaultValue={s.pf_admin_rate} /></label>
              <label className="field">EDLI %<input name="edli_rate" inputMode="decimal" defaultValue={s.edli_rate} /></label>
            </div>
          </div>
          <div className="card">
            <h2>ESI</h2>
            <div className="formgrid">
              <label className="check full"><input type="checkbox" name="esi_enabled" defaultChecked={s.esi_enabled} /> Company is registered for ESI</label>
              <label className="field">Applies up to gross (Rs.)<input name="esi_threshold" inputMode="decimal" defaultValue={s.esi_threshold} /></label>
              <label className="field">Employee %<input name="esi_ee_rate" inputMode="decimal" defaultValue={s.esi_ee_rate} /></label>
              <label className="field">Employer %<input name="esi_er_rate" inputMode="decimal" defaultValue={s.esi_er_rate} /></label>
            </div>
          </div>
          <div className="card">
            <h2>Professional tax</h2>
            <div className="formgrid">
              <label className="check"><input type="checkbox" name="pt_enabled" defaultChecked={s.pt_enabled} /> Deduct professional tax</label>
              <label className="field">State<input name="pt_state" defaultValue={s.pt_state} /></label>
              <div className="field full"><span>Monthly slabs (gross from → tax; February if different)</span>
                {slabs.map((x, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
                    <input name={`pt_from_${i}`} inputMode="decimal" defaultValue={x?.from ?? ""} placeholder="Gross from" />
                    <input name={`pt_amount_${i}`} inputMode="decimal" defaultValue={x?.amount ?? ""} placeholder="Tax / month" />
                    <input name={`pt_feb_${i}`} inputMode="decimal" defaultValue={x?.feb ?? ""} placeholder="February" />
                  </div>))}
                <span className="help">Karnataka (from April 2025): Rs. 25,000 and above → Rs. 200 a month, Rs. 300 in February. Other states: enter your state’s slabs.</span></div>
            </div>
          </div>
          <div className="card">
            <h2>Payslip</h2>
            <label className="field">Note printed on every payslip<textarea name="payslip_note" defaultValue={s.payslip_note ?? ""} maxLength={300} placeholder="e.g. For payroll queries write to payroll@yourcompany.com" /></label>
          </div>
        </div>
      </ActionForm>

      <div className="card">
        <h2>Salary components</h2>
        <p className="muted" style={{ marginTop: -6 }}>How a monthly gross is split. “Wages” (Basic, DA) are what PF is worked out on. Changes apply to new and revised salaries.</p>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Code</th><th>Name</th><th>Worked out as</th><th>Wages (PF)</th><th>Overtime base</th><th>Cut for LOP</th><th>In use</th></tr></thead>
          <tbody>{components.map((c) => (
            <tr key={c.code}><td className="mono">{c.code}</td><td>{c.name}</td><td>{c.calc === "fixed" ? `Rs. ${inr(c.value)}` : c.calc === "balance" ? CALC.balance : `${c.value}${CALC[c.calc]}`}</td>
              <td>{c.is_wages ? "Yes" : ""}</td><td>{c.in_ot_base ? "Yes" : ""}</td><td>{c.prorate ? "Yes" : "No"}</td><td>{c.active ? "Yes" : "No"}</td></tr>))}</tbody>
        </table></div>
        <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>Add or change a component</summary>
          <ActionForm action={saveComponent} submitLabel="Save component" className="formgrid">
            <label className="field">Code<input name="code" required placeholder="e.g. WASH" maxLength={12} /><span className="help">Use an existing code to change it</span></label>
            <label className="field">Name<input name="name" required placeholder="e.g. Washing allowance" /></label>
            <label className="field">Worked out as<select name="calc" defaultValue="fixed">{Object.entries(CALC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">Value (% or Rs.)<input name="value" inputMode="decimal" defaultValue="0" /></label>
            <label className="field">Order<input name="sort_order" inputMode="numeric" defaultValue="10" /></label>
            <label className="field">In use<select name="active" defaultValue="on"><option value="on">Yes</option><option value="off">No (hide)</option></select></label>
            <label className="check"><input type="checkbox" name="is_wages" /> Part of “wages” (PF)</label>
            <label className="check"><input type="checkbox" name="in_ot_base" /> Counts for overtime rate</label>
            <label className="check"><input type="checkbox" name="prorate" defaultChecked /> Reduced for loss-of-pay days</label>
          </ActionForm></details>
      </div>
    </AppShell>
  );
}
