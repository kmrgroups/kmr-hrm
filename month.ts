import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DayRow } from "@/components/attendance";
import { addDays, istDate, istInstant, istTime, monthBounds } from "./time";

/** One employee's month, read with the caller's own client so row-level security applies. */
export async function loadMonth(supabase: SupabaseClient, employeeId: string, month: string) {
  const { from, to, days } = monthBounds(month);
  const [{ data: rows }, { data: punchRows }, { data: shifts }] = await Promise.all([
    supabase.from("attendance_days").select("*").eq("employee_id", employeeId).gte("work_date", from).lte("work_date", to).order("work_date"),
    supabase.from("attendance_punches").select("punched_at,source").eq("employee_id", employeeId)
      .gte("punched_at", new Date(istInstant(from, 0)).toISOString()).lt("punched_at", new Date(istInstant(addDays(to, 1), 0)).toISOString())
      .order("punched_at").limit(3000),
    supabase.from("shifts").select("id,code,name,start_time,end_time"),
  ]);
  const punches = new Map<string, string[]>();
  for (const pr of punchRows ?? []) {
    const d = istDate(Date.parse(pr.punched_at));
    const mark = pr.source === "manual" ? "ᴹ" : pr.source === "regularisation" ? "ᴿ" : "";
    punches.set(d, [...(punches.get(d) ?? []), istTime(pr.punched_at) + mark]);
  }
  return {
    days, from, to,
    rows: ((rows ?? []) as DayRow[]).map((r) => ({ ...r, present_days: Number(r.present_days), leave_days: Number(r.leave_days), absent_days: Number(r.absent_days) })),
    punches,
    shiftCodes: new Map((shifts ?? []).map((s) => [s.id as string, s.code as string])),
    shifts: shifts ?? [],
  };
}
