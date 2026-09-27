import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "./service";
import { monthBounds } from "./time";
import { STATUS_META, type DayStatus } from "./compute";

export interface RegisterRow {
  id: string; name: string; code: string | null; department: string | null;
  cells: Map<string, { status: DayStatus; code: string | null; late: boolean }>;
  present: number; leave: number; absent: number; offs: number; ot: number; late: number;
}

/** Monthly muster for everyone the caller may see (row-level security applies) */
export async function loadRegister(supabase: SupabaseClient, month: string, plant?: string) {
  const { from, to, days } = monthBounds(month);
  const emps = await fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null; status: string; department: { name: string } | { name: string }[] | null }>((a, b) => {
    let q = supabase.from("employees").select("id,first_name,last_name,employee_code,status,department:departments(name)").in("status", ["active", "inactive", "exited"]);
    if (plant) q = q.eq("plant_id", plant);
    return q.order("employee_code", { nullsFirst: false }).range(a, b);
  });
  const rows = await fetchAll<{ employee_id: string; work_date: string; status: DayStatus; leave_type_code: string | null; late_minutes: number; present_days: number; leave_days: number; absent_days: number; ot_minutes: number }>((a, b) =>
    supabase.from("attendance_days").select("employee_id,work_date,status,leave_type_code,late_minutes,present_days,leave_days,absent_days,ot_minutes")
      .gte("work_date", from).lte("work_date", to).order("employee_id").order("work_date").range(a, b));

  const map = new Map<string, RegisterRow>();
  for (const e of emps) {
    const dept = Array.isArray(e.department) ? e.department[0]?.name ?? null : e.department?.name ?? null;
    map.set(e.id, { id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(" "), code: e.employee_code, department: dept, cells: new Map(), present: 0, leave: 0, absent: 0, offs: 0, ot: 0, late: 0 });
  }
  for (const r of rows) {
    const reg = map.get(r.employee_id);
    if (!reg) continue;
    reg.cells.set(r.work_date, { status: r.status, code: r.leave_type_code, late: r.late_minutes > 0 });
    reg.present += Number(r.present_days); reg.leave += Number(r.leave_days); reg.absent += Number(r.absent_days);
    reg.ot += r.ot_minutes; if (r.late_minutes > 0) reg.late++;
    if (r.status === "weekly_off" || r.status === "holiday") reg.offs++;
  }
  // Inactive / exited people only appear if they have attendance in the month
  const list = [...map.values()].filter((r) => r.cells.size || emps.find((e) => e.id === r.id)?.status === "active");
  return { days, list };
}

export function cellCode(c: { status: DayStatus; code: string | null } | undefined): string {
  if (!c) return "";
  if (c.status === "leave") return c.code ?? "L";
  if (c.status === "half_leave") return `½${c.code ?? "L"}`;
  return STATUS_META[c.status].short;
}
