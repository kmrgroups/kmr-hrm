"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { isDate, isMonth, fmtMonth } from "@/lib/attendance/time";
import { notify } from "@/lib/notify";
import { currentOrigin } from "@/lib/tenant";
import { p } from "@/lib/base-path";
import { setFlash } from "@/lib/flash";
import { computeRun, finaliseRun, loadSetup, reopenRun, type Line } from "@/lib/payroll/service";
import { splitGross, inr } from "@/lib/payroll/compute";
import { buildPayslipsPdf } from "@/lib/payroll/payslip";
import type { ActionState } from "@/app/app/employees/actions";

const ROLES = ["hr_manager" as const, "payroll" as const];
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const num = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(/[, ]/g, "")); return Number.isFinite(n) ? n : NaN; };

async function runFor(month: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("payroll_runs").select("id,month,status").eq("month", month).maybeSingle();
  if (!data) throw new Error("Payroll for this month has not been started.");
  return { supabase, run: data as { id: string; month: string; status: string } };
}

// ------------------------------------------------------------------ runs
export async function startRun(_: ActionState, form: FormData): Promise<ActionState> {
  const month = String(form.get("month") ?? "");
  try {
    const { user, tenant } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    if (!isMonth(month)) return { error: "Choose a month." };
    const supabase = await createClient();
    let { data: run } = await supabase.from("payroll_runs").select("id,month,status").eq("month", month).maybeSingle();
    if (!run) {
      const { data, error } = await supabase.from("payroll_runs").insert({ tenant_id: tenant.id, month, created_by: user.id }).select("id,month,status").single();
      if (error) return { error: error.message };
      run = data;
    }
    if (run.status === "draft") await computeRun(supabase, tenant.id, run);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.started", entity: "payroll_runs", entityId: run.id, data: { month } });
  } catch (e) { return fail(e); }
  redirect(`/app/payroll/${month}`);
}

export async function recalcRun(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const { supabase, run } = await runFor(String(form.get("month")));
    if (run.status !== "draft") return { error: "This month is finalised. Reopen it first to make changes." };
    const r = await computeRun(supabase, tenant.id, run);
    revalidatePath(`/app/payroll/${run.month}`);
    return { ok: `Worked out again: ${r.totals.employees} payslips, net pay Rs. ${inr(r.totals.net)}.${r.missing.length ? ` ${r.missing.length} active employee(s) have no salary yet.` : ""}` };
  } catch (e) { return fail(e); }
}

export async function saveLine(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const { supabase, run } = await runFor(String(form.get("month")));
    if (run.status !== "draft") return { error: "This month is finalised. Reopen it first to make changes." };
    const emp = String(form.get("employee_id") ?? "");
    const lopRaw = String(form.get("lop_override") ?? "").trim(), tdsRaw = String(form.get("tds_override") ?? "").trim();
    const lop = lopRaw === "" ? null : num(lopRaw), tds = tdsRaw === "" ? null : num(tdsRaw);
    if (lop != null && (Number.isNaN(lop) || lop < 0 || lop > 31)) return { error: "Loss-of-pay days: 0 to 31 (halves allowed)." };
    if (tds != null && (Number.isNaN(tds) || tds < 0)) return { error: "Income tax must be 0 or more." };
    const adjustments = [];
    for (let i = 0; i < 6; i++) {
      const label = String(form.get(`adj_label_${i}`) ?? "").trim(), amount = num(form.get(`adj_amount_${i}`));
      if (!label && !(amount > 0)) continue;
      if (!label || !(amount > 0)) return { error: "Each extra item needs a description and an amount." };
      adjustments.push({ label: label.slice(0, 50), kind: form.get(`adj_kind_${i}`) === "deduction" ? "deduction" : "earning", amount });
    }
    const { error } = await supabase.from("payroll_lines").update({ lop_override: lop, tds_override: tds, adjustments, notes: String(form.get("notes") ?? "").trim().slice(0, 200) || null })
      .eq("run_id", run.id).eq("employee_id", emp);
    if (error) return { error: error.message };
    await computeRun(supabase, tenant.id, run);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.line_edited", entity: "payroll_lines", entityId: emp, data: { month: run.month, lop, tds, adjustments } });
    revalidatePath(`/app/payroll/${run.month}`);
    return { ok: "Saved and worked out again." };
  } catch (e) { return fail(e); }
}

export async function finalise(_: ActionState, form: FormData): Promise<ActionState> {
  const month = String(form.get("month"));
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const { supabase, run } = await runFor(month);
    if (run.status !== "draft") return { error: "Already finalised." };
    await computeRun(supabase, tenant.id, run);
    const n = await finaliseRun(supabase, tenant.id, run.id, user.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.finalised", entity: "payroll_runs", entityId: run.id, data: { month } });
    await setFlash({ ok: `${fmtMonth(month)} finalised. Employees can now see their payslips${n ? `; ${n} loan instalment(s) recorded` : ""}. Next: download the bank file, then email the payslips.` });
  } catch (e) { return fail(e); }
  redirect(`/app/payroll/${month}`);
}

export async function reopen(_: ActionState, form: FormData): Promise<ActionState> {
  const month = String(form.get("month"));
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const { supabase, run } = await runFor(month);
    const { data: later } = await supabase.from("payroll_runs").select("month").eq("status", "finalised").gt("month", month).limit(1);
    if (later?.length) return { error: `Reopen ${fmtMonth(later[0].month)} first — only the latest finalised month can be reopened.` };
    await reopenRun(supabase, run.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.reopened", entity: "payroll_runs", entityId: run.id, data: { month } });
    await setFlash({ ok: `${fmtMonth(month)} reopened for corrections. Payslips are hidden from employees until you finalise again.` });
  } catch (e) { return fail(e); }
  redirect(`/app/payroll/${month}`);
}

export async function deleteRun(_: ActionState, form: FormData): Promise<ActionState> {
  const month = String(form.get("month"));
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const { supabase, run } = await runFor(month);
    if (run.status !== "draft") return { error: "Reopen the month first." };
    const { error } = await supabase.from("payroll_runs").delete().eq("id", run.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.deleted", entity: "payroll_runs", entityId: run.id, data: { month } });
    await setFlash({ ok: `Draft payroll for ${fmtMonth(month)} deleted.` });
  } catch (e) { return fail(e); }
  redirect("/app/payroll");
}

/** Emails each employee their payslip (PDF) from the company's own mailbox. */
export async function emailPayslips(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const { supabase, run } = await runFor(String(form.get("month")));
    if (run.status !== "finalised") return { error: "Finalise the month first." };
    const { data: lines } = await supabase.from("payroll_lines").select("*").eq("run_id", run.id);
    const { settings } = await loadSetup(supabase, tenant.id);
    const origin = await currentOrigin();
    let sent = 0, skipped = 0, failed = 0;
    for (const l of (lines ?? []) as Line[]) {
      if (!l.info.email) { skipped++; continue; }
      const pdf = await buildPayslipsPdf(tenant, run.month, [l], settings.payslip_note);
      const res = await notify({
        tenant, event: "payslip_ready", channels: ["email"], to: { name: l.info.name ?? undefined, email: l.info.email },
        vars: { month: fmtMonth(run.month), net_pay: `Rs. ${inr(l.net_pay)}`, link: `${origin}${p("/me/payslips")}` },
        related: { type: "payroll_runs", id: run.id },
        attachments: [{ filename: `Payslip-${run.month}-${l.info.code ?? "employee"}.pdf`, content: pdf }],
      });
      const r = res.find((x) => x.channel === "email");
      if (r?.status === "sent") sent++; else if (r?.status === "skipped") skipped++; else failed++;
    }
    await createAdminClient().from("payroll_runs").update({ emailed_at: new Date().toISOString() }).eq("id", run.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.emailed", entity: "payroll_runs", entityId: run.id, data: { sent, skipped, failed } });
    revalidatePath(`/app/payroll/${run.month}`);
    const hint = sent === 0 && skipped > 0 ? " Connect your company mailbox in Settings › Company email to send them." : "";
    return { ok: `Payslips emailed: ${sent} sent, ${skipped} not sent (no email or mailbox not connected), ${failed} failed.${hint} Everyone can also download theirs in My payslips.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ salaries
export async function saveSalary(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const supabase = await createClient();
    const emp = String(form.get("employee_id") ?? ""), from = String(form.get("effective_from") ?? "");
    const gross = num(form.get("monthly_gross"));
    if (!emp) return { error: "Choose the employee." };
    { const { data: own } = await supabase.from("employees").select("id").eq("id", emp).eq("tenant_id", tenant.id).maybeSingle(); if (!own) return { error: "Employee not found." }; }
    if (!isDate(from)) return { error: "Enter the date the salary starts." };
    if (!(gross >= 1000 && gross <= 10_000_000)) return { error: "Enter the monthly gross salary (Rs. per month)." };
    const { components } = await loadSetup(supabase, tenant.id);
    let split = splitGross(gross, components);
    // manual amounts entered for components (optional) replace the automatic split; the balance goes to the balance component
    const manual = components.filter((c) => c.active && c.calc !== "balance" && String(form.get(`c_${c.code}`) ?? "").trim() !== "");
    if (manual.length) {
      const set = new Map(split.map((c) => [c.code, c.amount]));
      for (const c of manual) set.set(c.code, Math.max(0, Math.round(num(form.get(`c_${c.code}`)))));
      const bal = components.find((c) => c.active && c.calc === "balance");
      const used = [...set.entries()].filter(([k]) => k !== bal?.code).reduce((s, [, v]) => s + v, 0);
      if (used > gross) return { error: `The amounts add up to Rs. ${inr(used)}, more than the gross Rs. ${inr(gross)}.` };
      if (bal) set.set(bal.code, gross - used);
      split = components.filter((c) => (set.get(c.code) ?? 0) > 0).map((c) => ({ code: c.code, name: c.name, amount: set.get(c.code)! }));
      if (!bal && used !== gross) return { error: "The amounts must add up to the gross (or add a Special allowance component that takes the balance)." };
    }
    const esi = String(form.get("esi_applicable") ?? "auto");
    const row = {
      tenant_id: tenant.id, employee_id: emp, effective_from: from, monthly_gross: gross, components: split,
      pf_applicable: form.get("pf_applicable") === "on", esi_applicable: esi === "auto" ? null : esi === "yes", pt_applicable: form.get("pt_applicable") === "on",
      vpf_percent: Math.max(0, Math.min(88, num(form.get("vpf_percent")) || 0)), monthly_tds: Math.max(0, num(form.get("monthly_tds")) || 0),
      notes: String(form.get("notes") ?? "").trim().slice(0, 200) || null, created_by: user.id,
    };
    const { error } = await supabase.from("salary_structures").upsert(row, { onConflict: "employee_id,effective_from" });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "salary.saved", entity: "salary_structures", entityId: emp, data: { from, gross } });
    revalidatePath("/app/payroll/salaries");
    return { ok: `Salary saved: Rs. ${inr(gross)} a month from ${from} — ${split.map((c) => `${c.name} ${inr(c.amount)}`).join(", ")}.` };
  } catch (e) { return fail(e); }
}

export async function deleteSalary(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const supabase = await createClient();
    const { error } = await supabase.from("salary_structures").delete().eq("id", String(form.get("id")));
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "salary.deleted", entity: "salary_structures", entityId: String(form.get("id")) });
    revalidatePath("/app/payroll/salaries");
    return { ok: "Salary revision removed." };
  } catch (e) { return fail(e); }
}

/** CSV with columns: employee_code, monthly_gross, effective_from (YYYY-MM-DD). */
export async function importSalaries(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) return { error: "Choose the CSV file." };
    const supabase = await createClient();
    const { components } = await loadSetup(supabase, tenant.id);
    const { data: emps } = await supabase.from("employees").select("id,employee_code");
    const byCode = new Map((emps ?? []).map((e) => [String(e.employee_code ?? "").toUpperCase(), e.id as string]));
    const lines = (await f.text()).replace(/^﻿/, "").split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))).filter((c) => c.some(Boolean));
    const head = lines[0]?.map((h) => h.toLowerCase()) ?? [];
    const ci = (n: string) => head.indexOf(n);
    if (ci("employee_code") < 0 || ci("monthly_gross") < 0) return { error: "The first row must have the columns employee_code, monthly_gross, effective_from." };
    const rows = [], errors: string[] = [];
    for (const [k, c] of lines.slice(1).entries()) {
      const id = byCode.get((c[ci("employee_code")] ?? "").toUpperCase()), gross = Number((c[ci("monthly_gross")] ?? "").replace(/[, ]/g, ""));
      const from = ci("effective_from") >= 0 && c[ci("effective_from")] ? c[ci("effective_from")] : new Date().toISOString().slice(0, 8) + "01";
      if (!id) { errors.push(`row ${k + 2}: unknown employee code`); continue; }
      if (!(gross >= 1000) || !isDate(from)) { errors.push(`row ${k + 2}: check the gross / date`); continue; }
      rows.push({ tenant_id: tenant.id, employee_id: id, effective_from: from, monthly_gross: gross, components: splitGross(gross, components), pf_applicable: true, pt_applicable: true, created_by: user.id });
    }
    if (rows.length) { const { error } = await supabase.from("salary_structures").upsert(rows, { onConflict: "employee_id,effective_from" }); if (error) return { error: error.message }; }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "salary.imported", entity: "salary_structures", data: { rows: rows.length, errors: errors.length } });
    revalidatePath("/app/payroll/salaries");
    return errors.length ? { error: `${rows.length} salaries imported; ${errors.length} rows skipped — ${errors.slice(0, 5).join("; ")}` } : { ok: `${rows.length} salaries imported.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ loans
export async function saveLoan(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const amount = num(form.get("amount")), emi = num(form.get("emi")), start = String(form.get("start_month") ?? ""), emp = String(form.get("employee_id") ?? "");
    if (!emp) return { error: "Choose the employee." };
    if (!(amount > 0) || !(emi > 0) || emi > amount) return { error: "Enter the amount and a monthly instalment not more than the amount." };
    if (!isMonth(start)) return { error: "Choose the first month of recovery." };
    const supabase = await createClient();
    const kind = form.get("kind") === "advance" ? "advance" : "loan";
    { const { data: own } = await supabase.from("employees").select("id").eq("id", emp).eq("tenant_id", tenant.id).maybeSingle(); if (!own) return { error: "Employee not found." }; }
    const { error } = await supabase.from("loans").insert({ tenant_id: tenant.id, employee_id: emp, kind, amount, emi, start_month: start, balance: amount,
      notes: String(form.get("notes") ?? "").trim().slice(0, 200) || null, created_by: user.id });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "loan.created", entity: "loans", entityId: emp, data: { kind, amount, emi, start } });
    revalidatePath("/app/payroll/loans");
    return { ok: `${kind === "advance" ? "Advance" : "Loan"} of Rs. ${inr(amount)} saved — Rs. ${inr(emi)} a month from ${fmtMonth(start)} (${Math.ceil(amount / emi)} instalments).` };
  } catch (e) { return fail(e); }
}

export async function closeLoan(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(ROLES, "hrm.payroll-statutory-reports");
    const supabase = await createClient();
    const { error } = await supabase.from("loans").update({ status: "closed" }).eq("id", String(form.get("id")));
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "loan.closed", entity: "loans", entityId: String(form.get("id")) });
    revalidatePath("/app/payroll/loans");
    return { ok: "Loan closed — no more instalments will be deducted." };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ settings
export async function savePaySettings(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(["hr_manager"], "hrm.payroll-statutory-reports");
    const supabase = await createClient();
    const b = (k: string) => form.get(k) === "on";
    const n = (k: string, min: number, max: number) => { const v = num(form.get(k)); if (!(v >= min && v <= max)) throw new Error(`Check the value of “${k.replace(/_/g, " ")}”.`); return v; };
    const slabs = [];
    for (let i = 0; i < 8; i++) {
      const from = String(form.get(`pt_from_${i}`) ?? "").trim(); if (from === "") continue;
      slabs.push({ from: num(from), amount: num(form.get(`pt_amount_${i}`)) || 0, feb: String(form.get(`pt_feb_${i}`) ?? "").trim() === "" ? null : num(form.get(`pt_feb_${i}`)) });
    }
    if (slabs.some((s) => Number.isNaN(s.from) || Number.isNaN(s.amount))) return { error: "Professional tax: enter numbers only." };
    const row = {
      tenant_id: tenant.id, pay_basis: String(form.get("pay_basis")), lop_source: String(form.get("lop_source")), labour_code_wages: b("labour_code_wages"),
      pf_enabled: b("pf_enabled"), pf_ceiling: n("pf_ceiling", 1000, 1_000_000), pf_restrict: b("pf_restrict"), eps_ceiling: n("eps_ceiling", 1000, 1_000_000),
      pf_admin_rate: n("pf_admin_rate", 0, 5), edli_rate: n("edli_rate", 0, 5),
      esi_enabled: b("esi_enabled"), esi_threshold: n("esi_threshold", 1000, 1_000_000), esi_ee_rate: n("esi_ee_rate", 0, 10), esi_er_rate: n("esi_er_rate", 0, 10),
      pt_enabled: b("pt_enabled"), pt_state: String(form.get("pt_state") ?? "").trim().slice(0, 40) || "Karnataka", pt_slabs: slabs.length ? slabs : [{ from: 0, amount: 0, feb: 0 }],
      ot_enabled: b("ot_enabled"), ot_multiplier: n("ot_multiplier", 1, 3), hours_per_day: n("hours_per_day", 4, 12),
      payslip_note: String(form.get("payslip_note") ?? "").trim().slice(0, 300) || null, updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("pay_settings").upsert(row);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.settings_saved", entity: "pay_settings", entityId: tenant.id });
    revalidatePath("/app/settings/payroll");
    return { ok: "Payroll settings saved. They apply the next time a month is worked out." };
  } catch (e) { return fail(e); }
}

export async function saveComponent(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(["hr_manager"], "hrm.payroll-statutory-reports");
    const supabase = await createClient();
    const code = String(form.get("code") ?? "").trim().toUpperCase(), name = String(form.get("name") ?? "").trim();
    const calc = String(form.get("calc") ?? "fixed");
    if (!/^[A-Z0-9_]{2,12}$/.test(code)) return { error: "Code: 2–12 capital letters or digits, e.g. WASH." };
    if (name.length < 2) return { error: "Enter the name." };
    if (!["percent_gross", "percent_basic", "fixed", "balance"].includes(calc)) return { error: "Choose how it is worked out." };
    if (calc === "balance") {
      const { data: other } = await supabase.from("pay_components").select("code").eq("calc", "balance").neq("code", code).eq("active", true);
      if (other?.length) return { error: `Only one component can take the balance (now: ${other[0].code}).` };
    }
    const row = { tenant_id: tenant.id, code, name, calc, value: num(form.get("value")) || 0, is_wages: form.get("is_wages") === "on", in_ot_base: form.get("in_ot_base") === "on",
      prorate: form.get("prorate") === "on", sort_order: num(form.get("sort_order")) || 10, active: form.get("active") !== "off" };
    const { error } = await supabase.from("pay_components").upsert(row, { onConflict: "tenant_id,code" });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "payroll.component_saved", entity: "pay_components", entityId: code });
    revalidatePath("/app/settings/payroll");
    return { ok: `${name} saved. New and revised salaries use it; existing salaries keep their amounts until revised.` };
  } catch (e) { return fail(e); }
}
