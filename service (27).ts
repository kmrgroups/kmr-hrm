import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll, recomputeAttendance } from "@/lib/attendance/service";
import { addDays, istToday } from "@/lib/attendance/time";
import { countLeaveDays, creditsDue, leaveYearBounds, leaveYearOf, nonWorkingChecker, yearEndSplit, type HalfDay, type LeaveTypeRule } from "./rules";
import type { Tenant } from "@/lib/types";

// Service-role helpers: callers check permissions first.

export const startMonthOf = (t: Pick<Tenant, "settings">) => Math.min(12, Math.max(1, t.settings?.leave_year_start_month ?? 1));

export interface Balance { credited: number; availed: number; balance: number; pending: number }

export async function loadLeaveTypes(db: SupabaseClient, tenantId: string, activeOnly = true): Promise<LeaveTypeRule[]> {
  let q = db.from("leave_types").select("*").eq("tenant_id", tenantId).order("sort_order").order("code");
  if (activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return ((data ?? []) as LeaveTypeRule[]).map((t) => ({ ...t, annual_quota: Number(t.annual_quota), carry_forward_max: Number(t.carry_forward_max) }));
}

/** employee → leave type → balance for one leave year (pending requests shown separately) */
export async function loadBalances(db: SupabaseClient, tenantId: string, employeeIds: string[] | "all", year: number): Promise<Map<string, Map<string, Balance>>> {
  const out = new Map<string, Map<string, Balance>>();
  const get = (e: string, t: string) => {
    if (!out.has(e)) out.set(e, new Map());
    const m = out.get(e)!;
    if (!m.has(t)) m.set(t, { credited: 0, availed: 0, balance: 0, pending: 0 });
    return m.get(t)!;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (q: any) => (employeeIds === "all" ? q : q.in("employee_id", employeeIds));
  const rows = await fetchAll<{ employee_id: string; leave_type_id: string; credited: number | null; availed: number | null; balance: number | null }>((a, b) =>
    scope(db.from("leave_balances").select("employee_id,leave_type_id,credited,availed,balance").eq("tenant_id", tenantId).eq("leave_year", year))
      .order("employee_id").order("leave_type_id").range(a, b));
  for (const r of rows) Object.assign(get(r.employee_id, r.leave_type_id), { credited: Number(r.credited ?? 0), availed: Number(r.availed ?? 0), balance: Number(r.balance ?? 0) });

  const tenant = await db.from("tenants").select("settings").eq("id", tenantId).single();
  const sm = startMonthOf({ settings: (tenant.data?.settings ?? {}) as Tenant["settings"] });
  const { from, to } = leaveYearBounds(year, sm);
  const pend = await fetchAll<{ employee_id: string; leave_type_id: string; days: number }>((a, b) =>
    scope(db.from("leave_requests").select("employee_id,leave_type_id,days").eq("tenant_id", tenantId).eq("status", "pending"))
      .gte("from_date", from).lte("from_date", to).order("id").range(a, b));
  for (const p of pend) get(p.employee_id, p.leave_type_id).pending += Number(p.days);
  return out;
}

/** Non-working-day checker for one employee over a range (weekly offs + holidays of their plant) */
export async function nonWorkingFor(db: SupabaseClient, tenantId: string, emp: { plant_id: string | null; weekly_offs: number[] | null }, from: string, to: string) {
  const { data } = await db.from("holidays").select("plant_id,holiday_date").eq("tenant_id", tenantId).gte("holiday_date", from).lte("holiday_date", to);
  const set = new Set((data ?? []).filter((h) => h.plant_id === null || h.plant_id === emp.plant_id).map((h) => h.holiday_date as string));
  return nonWorkingChecker(emp.weekly_offs ?? [0], set);
}

export interface LeaveInput { employeeId: string; leaveTypeId: string; from: string; to: string; half: HalfDay; reason: string | null }

/**
 * Checks a leave request against the rules. `byHr` skips the notice period (HR recording leave after the fact).
 * Returns the number of days it takes, or an error message.
 */
export async function validateLeave(tenant: Tenant, input: LeaveInput, byHr: boolean): Promise<{ days: number; type: LeaveTypeRule } | { error: string }> {
  const db = createAdminClient();
  const types = await loadLeaveTypes(db, tenant.id, false);
  const type = types.find((t) => t.id === input.leaveTypeId);
  if (!type || !type.active) return { error: "Choose a leave type." };
  if (input.to < input.from) return { error: "The end date is before the start date." };
  if (input.half !== "none" && input.from !== input.to) return { error: "A half day must start and end on the same date." };
  if (input.half !== "none" && !type.allow_half_day) return { error: `${type.name} cannot be taken for half a day.` };
  const sm = startMonthOf(tenant);
  if (leaveYearOf(input.from, sm) !== leaveYearOf(input.to, sm)) return { error: "A request cannot cross into the next leave year. Please split it into two requests." };
  const today = istToday();
  if (!byHr && type.min_notice_days > 0 && input.from < addDays(today, type.min_notice_days)) {
    return { error: `${type.name} must be applied at least ${type.min_notice_days} day(s) in advance.` };
  }
  if (!byHr && input.from < addDays(today, -30)) return { error: "Leave more than 30 days in the past must be recorded by HR." };

  const { data: emp } = await db.from("employees").select("id,plant_id,weekly_offs,status,date_of_joining").eq("id", input.employeeId).eq("tenant_id", tenant.id).single();
  if (!emp || emp.status !== "active") return { error: "Leave can only be recorded for active employees." };
  if (emp.date_of_joining && input.from < emp.date_of_joining) return { error: "The leave starts before the date of joining." };

  const isNW = await nonWorkingFor(db, tenant.id, emp, input.from, input.to);
  const days = countLeaveDays(input.from, input.to, input.half, isNW, type.count_non_working);
  if (days <= 0) return { error: "Those dates are all weekly offs or holidays — no leave is needed." };
  if (type.max_days_per_request && days > type.max_days_per_request) return { error: `${type.name} is limited to ${type.max_days_per_request} day(s) per request.` };

  const { data: overlap } = await db.from("leave_requests").select("id,from_date,to_date,half_day")
    .eq("employee_id", input.employeeId).in("status", ["pending", "approved"]).lte("from_date", input.to).gte("to_date", input.from);
  const clash = (overlap ?? []).find((o) => !(input.half !== "none" && o.half_day !== "none" && o.half_day !== input.half));
  if (clash) return { error: `These dates overlap another leave request (${clash.from_date}${clash.to_date !== clash.from_date ? " to " + clash.to_date : ""}).` };

  if (type.requires_balance) {
    const year = leaveYearOf(input.from, sm);
    const bal = (await loadBalances(db, tenant.id, [input.employeeId], year)).get(input.employeeId)?.get(type.id);
    const available = (bal?.balance ?? 0) - (bal?.pending ?? 0);
    if (days > available + 1e-9) return { error: `Not enough ${type.name} balance: ${available} day(s) available${bal?.pending ? ` after pending requests` : ""}, ${days} requested.` };
  }
  return { days, type };
}

/** Marks a pending request approved: debits the balance and updates attendance. */
export async function approveLeave(tenant: Tenant, requestId: string, actorId: string, comment: string | null) {
  const db = createAdminClient();
  const { data: req } = await db.from("leave_requests").select("*").eq("id", requestId).eq("tenant_id", tenant.id).single();
  if (!req || req.status !== "pending") throw new Error("This request is no longer pending.");
  const { data: type } = await db.from("leave_types").select("requires_balance,name").eq("id", req.leave_type_id).single();
  const sm = startMonthOf(tenant);
  const year = leaveYearOf(req.from_date, sm);
  if (type?.requires_balance) {
    const bal = (await loadBalances(db, tenant.id, [req.employee_id], year)).get(req.employee_id)?.get(req.leave_type_id);
    if ((bal?.balance ?? 0) + 1e-9 < Number(req.days)) throw new Error(`Not enough ${type.name} balance (${bal?.balance ?? 0} day(s)) to approve ${req.days} day(s).`);
  }
  const { data: updated } = await db.from("leave_requests").update({ status: "approved", decided_by: actorId, decided_at: new Date().toISOString(), decision_comment: comment })
    .eq("id", requestId).eq("status", "pending").select("id");
  if (!updated?.length) throw new Error("This request was already decided by someone else.");
  if (type?.requires_balance) {
    await db.from("leave_ledger").insert({ tenant_id: tenant.id, employee_id: req.employee_id, leave_type_id: req.leave_type_id, leave_year: year,
      kind: "availed", days: -Number(req.days), request_id: requestId, note: `${req.from_date}${req.to_date !== req.from_date ? " to " + req.to_date : ""}`, created_by: actorId });
  }
  await recomputeAttendance(tenant.id, [req.employee_id], req.from_date, req.to_date, { db });
  return req;
}

export async function rejectLeave(tenant: Tenant, requestId: string, actorId: string, comment: string | null) {
  const db = createAdminClient();
  const { data } = await db.from("leave_requests").update({ status: "rejected", decided_by: actorId, decided_at: new Date().toISOString(), decision_comment: comment })
    .eq("id", requestId).eq("tenant_id", tenant.id).eq("status", "pending").select("*");
  if (!data?.length) throw new Error("This request is no longer pending.");
  return data[0];
}

/** Cancels a pending or approved request; approved leave is credited back. */
export async function cancelLeave(tenant: Tenant, requestId: string, actorId: string) {
  const db = createAdminClient();
  const { data: req } = await db.from("leave_requests").select("*").eq("id", requestId).eq("tenant_id", tenant.id).single();
  if (!req || !["pending", "approved"].includes(req.status)) throw new Error("Only pending or approved requests can be cancelled.");
  const { data: updated } = await db.from("leave_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", requestId).eq("status", req.status).select("id");
  if (!updated?.length) throw new Error("This request changed in the meantime. Please refresh.");
  if (req.status === "approved") {
    const { data: debit } = await db.from("leave_ledger").select("leave_year,days").eq("request_id", requestId).eq("kind", "availed").maybeSingle();
    if (debit) {
      await db.from("leave_ledger").insert({ tenant_id: tenant.id, employee_id: req.employee_id, leave_type_id: req.leave_type_id, leave_year: debit.leave_year,
        kind: "reversal", days: -Number(debit.days), request_id: requestId, note: "Cancelled", created_by: actorId });
    }
    await recomputeAttendance(tenant.id, [req.employee_id], req.from_date, req.to_date, { db });
  }
  return req;
}

/**
 * Adds any leave credits that are due (yearly grants and monthly accruals) for a leave year, up to `asOf`.
 * Safe to run any number of times — each credit is stored once per period.
 */
export async function applyCredits(tenantId: string, year: number, asOf: string, actorId: string | null = null): Promise<number> {
  const db = createAdminClient();
  const { data: t } = await db.from("tenants").select("settings").eq("id", tenantId).single();
  const sm = startMonthOf({ settings: (t?.settings ?? {}) as Tenant["settings"] });
  const types = (await loadLeaveTypes(db, tenantId)).filter((x) => x.accrual !== "none" && x.annual_quota > 0);
  if (!types.length) return 0;
  const emps = await fetchAll<{ id: string; date_of_joining: string | null }>((a, b) =>
    db.from("employees").select("id,date_of_joining").eq("tenant_id", tenantId).eq("status", "active").order("id").range(a, b));
  const have = new Set((await fetchAll<{ employee_id: string; leave_type_id: string; period: string }>((a, b) =>
    db.from("leave_ledger").select("employee_id,leave_type_id,period").eq("tenant_id", tenantId).eq("leave_year", year).eq("kind", "accrual")
      .order("id").range(a, b))).map((r) => `${r.employee_id}|${r.leave_type_id}|${r.period}`));

  const rows: Record<string, unknown>[] = [];
  for (const e of emps) for (const type of types) {
    for (const c of creditsDue(type, year, sm, asOf, e.date_of_joining)) {
      if (have.has(`${e.id}|${type.id}|${c.period}`)) continue;
      rows.push({ tenant_id: tenantId, employee_id: e.id, leave_type_id: type.id, leave_year: year, kind: "accrual", days: c.days, period: c.period, note: c.note, created_by: actorId });
    }
  }
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("leave_ledger").insert(rows.slice(i, i + 500));
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    if (!error) added += rows.slice(i, i + 500).length;
  }
  return added;
}

/** Year-end: carries forward up to each type's limit into the next year; the rest lapses. Idempotent. */
export async function closeLeaveYear(tenantId: string, year: number, actorId: string): Promise<{ carried: number; lapsed: number }> {
  const db = createAdminClient();
  const types = await loadLeaveTypes(db, tenantId, false);
  const balances = await loadBalances(db, tenantId, "all", year);
  const rows: Record<string, unknown>[] = [];
  let carried = 0, lapsed = 0;
  for (const [emp, byType] of balances) for (const [typeId, b] of byType) {
    const type = types.find((t) => t.id === typeId);
    if (!type || !type.requires_balance) continue;
    const { carry, lapse } = yearEndSplit(b.balance, type.carry_forward_max);
    if (carry > 0) { rows.push({ tenant_id: tenantId, employee_id: emp, leave_type_id: typeId, leave_year: year + 1, kind: "carry_forward", days: carry, period: `cf-${year}`, note: `Carried forward from ${year}`, created_by: actorId }); carried++; }
    if (lapse > 0) { rows.push({ tenant_id: tenantId, employee_id: emp, leave_type_id: typeId, leave_year: year, kind: "lapse", days: -lapse, period: `lapse-${year}`, note: "Lapsed at year end", created_by: actorId }); lapsed++; }
  }
  for (const r of rows) {
    const { error } = await db.from("leave_ledger").insert(r);
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
  }
  return { carried, lapsed };
}
