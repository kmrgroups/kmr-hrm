import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/attendance/service";
import { istToday, monthBounds } from "@/lib/attendance/time";
import { computeLine, splitGross, type Adjustment, type Component, type Loan, type PaySettings, type Structure } from "./compute";

export type Line = {
  run_id: string; employee_id: string; tenant_id: string; days_in_month: number; paid_days: number; lop_days: number; lop_override: number | null;
  ot_hours: number; earnings: { code: string; name: string; amount: number; full?: number }[]; deductions: { code: string; name: string; amount: number; loan_id?: string }[];
  employer: { code: string; name: string; amount: number }[]; adjustments: Adjustment[]; tds_override: number | null;
  gross: number; total_deductions: number; net_pay: number; pf_wage: number; esi_wage: number; info: Record<string, string | null>; notes: string | null;
};
export type Run = { id: string; tenant_id: string; month: string; status: "draft" | "finalised"; totals: Record<string, number>; settings: PaySettings; computed_at: string | null; finalised_at: string | null; emailed_at: string | null };

/** The company's payroll rules and components (created with defaults the first time). */
export async function loadSetup(db: SupabaseClient, tenantId: string): Promise<{ settings: PaySettings; components: Component[] }> {
  let { data: s } = await db.from("pay_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!s) {
    await createAdminClient().rpc("seed_payroll_defaults", { p_tenant: tenantId });
    ({ data: s } = await db.from("pay_settings").select("*").eq("tenant_id", tenantId).maybeSingle());
  }
  const { data: c } = await db.from("pay_components").select("*").eq("tenant_id", tenantId).order("sort_order");
  const num = (v: unknown) => Number(v ?? 0);
  const settings = { ...s, pf_ceiling: num(s?.pf_ceiling), eps_ceiling: num(s?.eps_ceiling), pf_admin_rate: num(s?.pf_admin_rate), edli_rate: num(s?.edli_rate),
    esi_threshold: num(s?.esi_threshold), esi_ee_rate: num(s?.esi_ee_rate), esi_er_rate: num(s?.esi_er_rate), ot_multiplier: num(s?.ot_multiplier), hours_per_day: num(s?.hours_per_day) } as PaySettings;
  return { settings, components: ((c ?? []) as Component[]).map((x) => ({ ...x, value: Number(x.value) })) };
}

/** Each employee's salary that applies in a month (latest revision on or before the month's last day). */
export async function salariesFor(db: SupabaseClient, monthEnd: string) {
  const rows = await fetchAll<{ employee_id: string; effective_from: string; monthly_gross: number; components: Structure["components"]; pf_applicable: boolean; esi_applicable: boolean | null; pt_applicable: boolean; vpf_percent: number; monthly_tds: number }>((a, b) =>
    db.from("salary_structures").select("employee_id,effective_from,monthly_gross,components,pf_applicable,esi_applicable,pt_applicable,vpf_percent,monthly_tds")
      .lte("effective_from", monthEnd).order("employee_id").order("effective_from", { ascending: false }).range(a, b));
  const map = new Map<string, Structure & { effective_from: string }>();
  for (const r of rows) if (!map.has(r.employee_id)) map.set(r.employee_id, {
    ...r, monthly_gross: Number(r.monthly_gross), vpf_percent: Number(r.vpf_percent), monthly_tds: Number(r.monthly_tds),
    components: (r.components ?? []).map((c) => ({ ...c, amount: Number(c.amount) })),
  });
  return map;
}

/** Works out (or re-works) every payslip of a draft run. HR's own entries on each line are kept. */
export async function computeRun(db: SupabaseClient, tenantId: string, run: { id: string; month: string }) {
  const { settings, components } = await loadSetup(db, tenantId);
  const { from, to, days } = monthBounds(run.month);
  const today = istToday();
  const pastDays = days.filter((d) => d < today);            // today is not final until the night job runs

  const [emps, salaries, att, loans, { data: existing }, priv] = await Promise.all([
    fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null; status: string; date_of_joining: string | null; email: string | null;
      designation: { name: string } | { name: string }[] | null; department: { name: string } | { name: string }[] | null; plant: { name: string; state: string | null } | { name: string; state: string | null }[] | null }>((a, b) =>
      db.from("employees").select("id,first_name,last_name,employee_code,status,date_of_joining,email,designation:designations(name),department:departments(name),plant:plants(name,state)")
        .in("status", ["active", "inactive", "exited"]).order("employee_code", { nullsFirst: false }).range(a, b)),
    salariesFor(db, to),
    fetchAll<{ employee_id: string; work_date: string; status: string; present_days: number; leave_days: number; absent_days: number; ot_minutes: number }>((a, b) =>
      db.from("attendance_days").select("employee_id,work_date,status,present_days,leave_days,absent_days,ot_minutes").gte("work_date", from).lte("work_date", to).order("employee_id").order("work_date").range(a, b)),
    fetchAll<Loan & { employee_id: string; status: string }>((a, b) => db.from("loans").select("id,employee_id,kind,emi,balance,start_month,status").eq("status", "active").range(a, b)),
    db.from("payroll_lines").select("employee_id,lop_override,adjustments,tds_override,notes").eq("run_id", run.id),
    fetchAll<{ employee_id: string; pan: string | null; uan: string | null; esi_ip_no: string | null; bank_name: string | null; account_number: string | null; ifsc: string | null; account_holder: string | null }>((a, b) =>
      db.from("employee_private").select("employee_id,pan,uan,esi_ip_no,bank_name,account_number,ifsc,account_holder").range(a, b)),
  ]);
  const keep = new Map((existing ?? []).map((e) => [e.employee_id as string, e]));
  const privMap = new Map(priv.map((p) => [p.employee_id, p]));
  const byEmp = new Map<string, typeof att>();
  for (const a of att) (byEmp.get(a.employee_id) ?? byEmp.set(a.employee_id, []).get(a.employee_id)!).push(a);
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] ?? null : x);

  const lines: Record<string, unknown>[] = [], missing: string[] = [];
  let warnings = 0;
  for (const e of emps) {
    const recs = byEmp.get(e.id) ?? [];
    if (e.status !== "active" && !recs.some((r) => Number(r.present_days) > 0)) continue;   // left before this month
    if (e.date_of_joining && e.date_of_joining > to) continue;                               // joins later
    const found = salaries.get(e.id);
    // a salary saved as a total only (e.g. imported elsewhere) is split with the company's components
    const sal = found && !found.components.length ? { ...found, components: splitGross(found.monthly_gross, components) } : found;
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
    if (!sal) { missing.push(name); continue; }
    const notEmployed = e.date_of_joining && e.date_of_joining > from ? days.filter((d) => d < e.date_of_joining!).length : 0;
    const k = keep.get(e.id);
    let lop: number;
    if (k?.lop_override != null) lop = Number(k.lop_override);
    else if (settings.lop_source === "manual") lop = 0;
    else {
      const seen = new Set(recs.map((r) => r.work_date));
      const absent = recs.reduce((s, r) => s + Number(r.absent_days), 0);
      // past days with no attendance at all count as unpaid; days still to come are assumed worked
      const unrecorded = pastDays.filter((d) => !seen.has(d) && (!e.date_of_joining || d >= e.date_of_joining)).length;
      lop = absent + unrecorded;
    }
    const otMinutes = recs.reduce((s, r) => s + (r.ot_minutes || 0), 0);
    const res = computeLine({
      month: run.month, daysInMonth: days.length, notEmployedDays: notEmployed, lopDays: lop, otMinutes,
      structure: sal, components, loans: loans.filter((l) => l.employee_id === e.id).map((l) => ({ ...l, emi: Number(l.emi), balance: Number(l.balance) })),
      adjustments: (k?.adjustments as Adjustment[]) ?? [], tds: k?.tds_override != null ? Number(k.tds_override) : null,
    }, settings);
    if (res.warnings.length) warnings++;
    const p = privMap.get(e.id);
    lines.push({
      run_id: run.id, employee_id: e.id, tenant_id: tenantId, days_in_month: days.length, paid_days: res.paid_days, lop_days: res.lop_days,
      lop_override: k?.lop_override ?? null, ot_hours: res.ot_hours, earnings: res.earnings, deductions: res.deductions, employer: res.employer,
      adjustments: k?.adjustments ?? [], tds_override: k?.tds_override ?? null, notes: k?.notes ?? null,
      gross: res.gross, total_deductions: res.total_deductions, net_pay: res.net_pay, pf_wage: res.pf_wage, esi_wage: res.esi_wage,
      info: {
        name, code: e.employee_code, email: e.email, designation: one(e.designation)?.name ?? null, department: one(e.department)?.name ?? null,
        plant: one(e.plant)?.name ?? null, joined: e.date_of_joining, pan: p?.pan ?? null, uan: p?.uan ?? null, esi_no: p?.esi_ip_no ?? null,
        bank: p?.bank_name ?? null, account: p?.account_number ?? null, ifsc: p?.ifsc ?? null, holder: p?.account_holder ?? null,
        monthly_gross: String(sal.monthly_gross), eps_wage: String(res.eps_wage), warnings: res.warnings.join(" ") || null,
      },
      updated_at: new Date().toISOString(),
    });
  }
  // people no longer in the run (e.g. salary removed) drop out; everyone else is replaced
  const ids = new Set(lines.map((l) => l.employee_id as string));
  const gone = [...keep.keys()].filter((id) => !ids.has(id));
  for (let i = 0; i < gone.length; i += 100) {
    const { error } = await db.from("payroll_lines").delete().eq("run_id", run.id).in("employee_id", gone.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < lines.length; i += 200) {
    const { error } = await db.from("payroll_lines").upsert(lines.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  const sum = (f: (l: Record<string, unknown>) => number) => lines.reduce((s, l) => s + f(l), 0);
  const ded = (code: string) => (l: Record<string, unknown>) => ((l.deductions as { code: string; amount: number }[]).filter((d) => d.code === code).reduce((s, d) => s + d.amount, 0));
  const er = (code: string) => (l: Record<string, unknown>) => ((l.employer as { code: string; amount: number }[]).filter((d) => d.code === code).reduce((s, d) => s + d.amount, 0));
  const totals = {
    employees: lines.length, gross: sum((l) => Number(l.gross)), deductions: sum((l) => Number(l.total_deductions)), net: sum((l) => Number(l.net_pay)),
    pf_ee: sum(ded("PF")) + sum(ded("VPF")), pf_er: sum(er("EPS")) + sum(er("EPF_ER")), pf_admin: sum(er("PF_ADMIN")) + sum(er("EDLI")),
    esi_ee: sum(ded("ESI")), esi_er: sum(er("ESI_ER")), pt: sum(ded("PT")), tds: sum(ded("TDS")), loans: sum(ded("LOAN")) + sum(ded("ADV")),
    employer_cost: 0, no_salary: missing.length, no_uan: lines.filter((l) => Number(l.pf_wage) > 0 && !(l.info as Record<string, unknown>).uan).length, no_bank: lines.filter((l) => !(l.info as Record<string, unknown>).account || !(l.info as Record<string, unknown>).ifsc).length, warnings,
  };
  totals.employer_cost = totals.gross + totals.pf_er + totals.pf_admin + totals.esi_er;
  const { error } = await db.from("payroll_runs").update({ totals, settings, computed_at: new Date().toISOString() }).eq("id", run.id);
  if (error) throw new Error(error.message);
  return { totals, missing };
}

/** Finalise: payslips become visible to employees and loan balances go down. */
export async function finaliseRun(db: SupabaseClient, tenantId: string, runId: string, userId: string) {
  const lines = await fetchAll<{ deductions: { loan_id?: string; amount: number }[] }>((a, b) => db.from("payroll_lines").select("deductions").eq("run_id", runId).range(a, b));
  const rec = lines.flatMap((l) => l.deductions.filter((d) => d.loan_id).map((d) => ({ loan_id: d.loan_id!, run_id: runId, tenant_id: tenantId, amount: d.amount })));
  if (rec.length) {
    const { error } = await db.from("loan_recoveries").upsert(rec);
    if (error) throw new Error(error.message);
    for (const r of rec) {
      const { data: l } = await db.from("loans").select("balance").eq("id", r.loan_id).single();
      const bal = Math.max(0, Number(l?.balance ?? 0) - r.amount);
      await db.from("loans").update({ balance: bal, status: bal <= 0 ? "closed" : "active" }).eq("id", r.loan_id);
    }
  }
  const { error } = await db.from("payroll_runs").update({ status: "finalised", finalised_at: new Date().toISOString(), finalised_by: userId }).eq("id", runId);
  if (error) throw new Error(error.message);
  return rec.length;
}

/** Reopen the latest finalised month for corrections: loan instalments are put back. */
export async function reopenRun(db: SupabaseClient, runId: string) {
  const { data: rec } = await db.from("loan_recoveries").select("loan_id,amount").eq("run_id", runId);
  for (const r of rec ?? []) {
    const { data: l } = await db.from("loans").select("balance").eq("id", r.loan_id).single();
    await db.from("loans").update({ balance: Number(l?.balance ?? 0) + Number(r.amount), status: "active" }).eq("id", r.loan_id);
  }
  await db.from("loan_recoveries").delete().eq("run_id", runId);
  const { error } = await db.from("payroll_runs").update({ status: "draft", finalised_at: null, finalised_by: null }).eq("id", runId);
  if (error) throw new Error(error.message);
}
