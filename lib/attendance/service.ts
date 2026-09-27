import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDays, shiftFromRow, type DayInput, type LeaveOnDay, type ShiftRule } from "./compute";
import { addDays, dateRange, istDate, istInstant, istToday, weekday } from "./time";
import type { PunchRow } from "./parse";

// All functions here use the service-role client: callers must check permissions first.

const CHUNK = 100;

/** Reads every row of a query, 1000 at a time (PostgREST's page limit). */
export async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

interface EmpRow { id: string; plant_id: string | null; shift_id: string | null; weekly_offs: number[]; date_of_joining: string | null }

/**
 * Recomputes attendance_days for the given employees (or every active employee) between two dates.
 * Future dates are skipped; today is stored only once something is known (a punch, leave, holiday or weekly off).
 * Returns the number of day rows written.
 */
export async function recomputeAttendance(
  tenantId: string, employeeIds: string[] | "all", from: string, to: string,
  opts: { otMinMinutes?: number; db?: SupabaseClient } = {},
): Promise<number> {
  const db = opts.db ?? createAdminClient();
  const today = istToday();
  if (to > today) to = today;
  if (from > to) return 0;

  let emps: EmpRow[];
  if (employeeIds === "all") {
    emps = await fetchAll<EmpRow>((a, b) => db.from("employees").select("id,plant_id,shift_id,weekly_offs,date_of_joining")
      .eq("tenant_id", tenantId).eq("status", "active").order("id").range(a, b));
  } else {
    emps = [];
    for (const ids of chunks([...new Set(employeeIds)], CHUNK)) {
      const { data, error } = await db.from("employees").select("id,plant_id,shift_id,weekly_offs,date_of_joining")
        .eq("tenant_id", tenantId).eq("status", "active").in("id", ids);
      if (error) throw new Error(error.message);
      emps.push(...((data ?? []) as EmpRow[]));
    }
  }
  if (!emps.length) return 0;

  const lookFrom = addDays(from, -1);
  const [{ data: shiftRows }, { data: holidayRows }, { data: tenantRow }] = await Promise.all([
    db.from("shifts").select("id,code,start_time,end_time,break_minutes,grace_in_minutes,grace_out_minutes,half_day_minutes,full_day_minutes,active").eq("tenant_id", tenantId),
    db.from("holidays").select("plant_id,holiday_date,name").eq("tenant_id", tenantId).gte("holiday_date", lookFrom).lte("holiday_date", to),
    db.from("tenants").select("settings").eq("id", tenantId).single(),
  ]);
  const shifts = new Map<string, ShiftRule>((shiftRows ?? []).map((r) => [r.id, shiftFromRow(r)]));
  const candidates = (shiftRows ?? []).filter((r) => r.active).map((r) => shifts.get(r.id)!);
  const otMin = opts.otMinMinutes ?? (tenantRow?.settings as { ot_min_minutes?: number } | null)?.ot_min_minutes ?? 30;
  const holidayFor = (plant: string | null, date: string) =>
    (holidayRows ?? []).find((h) => h.holiday_date === date && (h.plant_id === null || h.plant_id === plant))?.name ?? null;

  let written = 0;
  for (const group of chunks(emps, CHUNK)) {
    const ids = group.map((e) => e.id);
    const [leaves, punches] = await Promise.all([
      fetchAll<{ employee_id: string; from_date: string; to_date: string; half_day: string; leave_type: { code: string; paid: boolean; count_non_working: boolean } | { code: string; paid: boolean; count_non_working: boolean }[] }>((a, b) =>
        db.from("leave_requests").select("employee_id,from_date,to_date,half_day,leave_type:leave_types(code,paid,count_non_working)")
          .eq("tenant_id", tenantId).eq("status", "approved").in("employee_id", ids).lte("from_date", to).gte("to_date", lookFrom).order("id").range(a, b)),
      fetchAll<{ employee_id: string; punched_at: string }>((a, b) =>
        db.from("attendance_punches").select("employee_id,punched_at").eq("tenant_id", tenantId).in("employee_id", ids)
          .gte("punched_at", new Date(istInstant(lookFrom, 0) - 6 * 36e5).toISOString())
          .lte("punched_at", new Date(istInstant(addDays(to, 1), 18 * 60)).toISOString())
          .order("id").range(a, b)),
    ]);

    const upserts: Record<string, unknown>[] = [];
    const deletes: string[] = [];
    for (const emp of group) {
      const start = emp.date_of_joining && emp.date_of_joining > lookFrom ? emp.date_of_joining : lookFrom;
      if (start > to) continue;
      const fixed = emp.shift_id ? shifts.get(emp.shift_id) ?? null : null;
      const offs = emp.weekly_offs ?? [0];

      const leaveOn = new Map<string, LeaveOnDay>();
      for (const l of leaves.filter((x) => x.employee_id === emp.id)) {
        const lt = Array.isArray(l.leave_type) ? l.leave_type[0] : l.leave_type;
        for (const d of dateRange(l.from_date, l.to_date)) {
          const nonWorking = offs.includes(weekday(d)) || !!holidayFor(emp.plant_id, d);
          if (nonWorking && !lt.count_non_working) continue;
          leaveOn.set(d, { code: lt.code, fraction: l.half_day === "none" ? 1 : 0.5, paid: lt.paid });
        }
      }

      const days: DayInput[] = dateRange(start, to).map((date) => ({
        date, shift: fixed, candidates, weeklyOff: offs.includes(weekday(date)),
        holiday: holidayFor(emp.plant_id, date), leave: leaveOn.get(date) ?? null, isToday: date === today,
      }));
      const times = punches.filter((p) => p.employee_id === emp.id).map((p) => Date.parse(p.punched_at));
      const results = computeDays(days, times, { otMinMinutes: otMin });

      for (const r of results) {
        if (r.work_date < from) continue;           // the look-back day only decides which punches are used
        if (r.work_date === today && r.status === "absent" && !r.punch_count) { deletes.push(`${emp.id}|${r.work_date}`); continue; }
        upserts.push({ tenant_id: tenantId, employee_id: emp.id, ...r, computed_at: new Date().toISOString() });
      }
    }

    for (const batch of chunks(upserts, 500)) {
      const { error } = await db.from("attendance_days").upsert(batch, { onConflict: "employee_id,work_date" });
      if (error) throw new Error(`Saving attendance failed: ${error.message}`);
      written += batch.length;
    }
    for (const key of deletes) {
      const [employee_id, work_date] = key.split("|");
      await db.from("attendance_days").delete().eq("employee_id", employee_id).eq("work_date", work_date);
    }
  }
  return written;
}

/**
 * Stores punches and recomputes the days they touch. Used by devices, CSV import and manual entry.
 * Returns how many punches were new and how many could not be matched to an employee.
 */
export async function ingestPunches(
  tenantId: string, rows: PunchRow[],
  source: "device" | "csv" | "manual" | "regularisation", deviceId: string | null = null, actorId: string | null = null,
): Promise<{ inserted: number; unmatched: number; days: number }> {
  if (!rows.length) return { inserted: 0, unmatched: 0, days: 0 };
  const db = createAdminClient();
  const inserted: { employee_id: string | null; punched_at: string }[] = [];
  for (const batch of chunks(rows, 1000)) {
    const { data, error } = await db.rpc("ingest_punches", {
      p_tenant: tenantId, p_device: deviceId, p_source: source, p_rows: batch, p_actor: actorId,
    });
    if (error) throw new Error(`Saving punches failed: ${error.message}`);
    inserted.push(...((data ?? []) as typeof inserted));
  }

  // Recompute each affected employee from the day before their earliest new punch (night shifts)
  const span = new Map<string, { from: string; to: string }>();
  for (const p of inserted) {
    if (!p.employee_id) continue;
    const d = istDate(Date.parse(p.punched_at));
    const s = span.get(p.employee_id);
    span.set(p.employee_id, { from: !s || addDays(d, -1) < s.from ? addDays(d, -1) : s.from, to: !s || d > s.to ? d : s.to });
  }
  let days = 0;
  const byRange = new Map<string, string[]>();
  for (const [emp, r] of span) {
    const key = `${r.from}|${r.to}`;
    byRange.set(key, [...(byRange.get(key) ?? []), emp]);
  }
  for (const [key, emps] of byRange) {
    const [from, to] = key.split("|");
    days += await recomputeAttendance(tenantId, emps, from, to, { db });
  }
  return { inserted: inserted.length, unmatched: inserted.filter((p) => !p.employee_id).length, days };
}
