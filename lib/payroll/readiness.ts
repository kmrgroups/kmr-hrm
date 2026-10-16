import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/attendance/service";
import { istToday, monthBounds } from "@/lib/attendance/time";

export type Readiness = {
  month: string; isPast: boolean;
  devices: { name: string; last_seen_at: string | null; active: boolean }[];
  punches: number; lastPunch: string | null;
  employees: number;
  noDeviceId: { id: string; name: string; code: string | null }[];       // nobody can punch for them
  noPunchAtAll: { id: string; name: string; code: string | null }[];     // active, but no biometric record in the month
  unmatched: { count: number; ids: string[] };                           // punches from a machine user not linked to an employee
  missed: { id: string; name: string; code: string | null; dates: string[] }[];   // one punch only on a day
  pendingRegularisations: number; pendingLeaves: number;
  noSalary: number;
};

/**
 * Everything HR should look at before working out a month, taken from the biometric punches and attendance days.
 * Uses the service-role client: the caller must already have checked the role.
 */
export async function payrollReadiness(tenantId: string, month: string): Promise<Readiness> {
  const db = createAdminClient();
  const { from, to } = monthBounds(month);
  const today = istToday();
  const lo = new Date(`${from}T00:00:00+05:30`).toISOString(), hi = new Date(`${to}T23:59:59+05:30`).toISOString();

  const [devices, emps, days, un, cnt, last, regs, leaves, sal] = await Promise.all([
    db.from("attendance_devices").select("name,last_seen_at,active").eq("tenant_id", tenantId).order("name"),
    fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null; attendance_id: string | null }>((a, b) =>
      db.from("employees").select("id,first_name,last_name,employee_code,attendance_id").eq("tenant_id", tenantId).eq("status", "active").order("employee_code", { nullsFirst: false }).range(a, b)),
    fetchAll<{ employee_id: string; work_date: string; status: string; punch_count: number }>((a, b) =>
      db.from("attendance_days").select("employee_id,work_date,status,punch_count").eq("tenant_id", tenantId).gte("work_date", from).lte("work_date", to).order("employee_id").order("work_date").range(a, b)),
    db.from("attendance_punches").select("attendance_id").eq("tenant_id", tenantId).is("employee_id", null).gte("punched_at", lo).lte("punched_at", hi).limit(2000),
    db.from("attendance_punches").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("punched_at", lo).lte("punched_at", hi),
    db.from("attendance_punches").select("punched_at").eq("tenant_id", tenantId).order("punched_at", { ascending: false }).limit(1),
    db.from("regularisation_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending"),
    db.from("leave_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending"),
    db.from("salary_structures").select("employee_id").eq("tenant_id", tenantId).lte("effective_from", to),
  ]);

  const nm = (e: { first_name: string; last_name: string | null }) => [e.first_name, e.last_name].filter(Boolean).join(" ");
  const withSalary = new Set((sal.data ?? []).map((r) => r.employee_id as string));
  const byEmp = new Map<string, typeof days>();
  for (const d of days) (byEmp.get(d.employee_id) ?? byEmp.set(d.employee_id, []).get(d.employee_id)!).push(d);

  const missed: Readiness["missed"] = [];
  const noPunchAtAll: Readiness["noPunchAtAll"] = [];
  for (const e of emps) {
    const rec = byEmp.get(e.id) ?? [];
    const m = rec.filter((r) => r.status === "missed_punch" && r.work_date < today).map((r) => r.work_date);
    if (m.length) missed.push({ id: e.id, name: nm(e), code: e.employee_code, dates: m });
    if (!rec.some((r) => r.punch_count > 0) && rec.length) noPunchAtAll.push({ id: e.id, name: nm(e), code: e.employee_code });
  }
  const unIds = [...new Set((un.data ?? []).map((r) => String(r.attendance_id)))];
  return {
    month, isPast: to < today,
    devices: (devices.data ?? []) as Readiness["devices"],
    punches: cnt.count ?? 0, lastPunch: (last.data?.[0]?.punched_at as string) ?? null,
    employees: emps.length,
    noDeviceId: emps.filter((e) => !e.attendance_id && !e.employee_code).map((e) => ({ id: e.id, name: nm(e), code: e.employee_code })),
    noPunchAtAll, unmatched: { count: (un.data ?? []).length, ids: unIds.slice(0, 12) }, missed,
    pendingRegularisations: regs.count ?? 0, pendingLeaves: leaves.count ?? 0,
    noSalary: emps.filter((e) => !withSalary.has(e.id)).length,
  };
}
