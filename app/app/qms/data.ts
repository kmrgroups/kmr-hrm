import "server-only";
import { fetchAll } from "@/lib/attendance/service";
import { fullName } from "@/components/ui";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export interface PersonRow {
  id: string; name: string; code: string | null; status: string; designation_id: string | null; department_id: string | null; plant_id: string | null;
  designation: string | null; department: string | null; plant: string | null; date_of_joining: string | null; reporting_manager_id: string | null;
  position_id: string | null;
  employment_type: string; mobile: string | null; email: string | null;
}

/** the people this user may see (HR: everybody; a manager: his team, through row-level security) */
export async function people(db: Db, opts: { includeJoiners?: boolean } = {}): Promise<PersonRow[]> {
  const statuses = opts.includeJoiners ? ["active", "invited", "onboarding", "submitted"] : ["active"];
  const rows = await fetchAll<Record<string, unknown>>((a, b) => db.from("employees")
    .select("id,first_name,last_name,employee_code,status,designation_id,department_id,plant_id,position_id,date_of_joining,reporting_manager_id,employment_type,mobile,email,designation:designations(name),department:departments(name),plant:plants(name)")
    .in("status", statuses).order("first_name").range(a, b));
  return rows.map((r) => ({
    id: r.id as string, name: fullName(r as { first_name: string; last_name: string | null }), code: (r.employee_code as string) ?? null, status: r.status as string,
    designation_id: (r.designation_id as string) ?? null, department_id: (r.department_id as string) ?? null, plant_id: (r.plant_id as string) ?? null,
    designation: one(r.designation as { name: string })?.name ?? null, department: one(r.department as { name: string })?.name ?? null, plant: one(r.plant as { name: string })?.name ?? null,
    date_of_joining: (r.date_of_joining as string) ?? null, reporting_manager_id: (r.reporting_manager_id as string) ?? null, position_id: (r.position_id as string) ?? null,
    employment_type: r.employment_type as string, mobile: (r.mobile as string) ?? null, email: (r.email as string) ?? null,
  }));
}

export interface QmsSettings { quality_policy: string | null; objectives: string[]; csr: string[]; min_qualified: number; eff_days: number; new_joiner_days: number }
export async function qmsSettings(db: Db): Promise<QmsSettings> {
  const { data } = await db.from("qms_settings").select("quality_policy,objectives,csr,min_qualified,eff_days,new_joiner_days").maybeSingle();
  return { quality_policy: data?.quality_policy ?? null, objectives: data?.objectives ?? [], csr: data?.csr ?? [], min_qualified: data?.min_qualified ?? 2,
    eff_days: data?.eff_days ?? 30, new_joiner_days: data?.new_joiner_days ?? 30 };
}

export async function masters(db: Db) {
  const [d, dep, pl] = await Promise.all([
    db.from("designations").select("id,name").eq("active", true).order("name"),
    db.from("departments").select("id,name").eq("active", true).order("name"),
    db.from("plants").select("id,name,code").eq("active", true).order("code"),
  ]);
  return { designations: d.data ?? [], departments: dep.data ?? [], plants: pl.data ?? [] };
}

export const personLabel = (p: { name: string; code: string | null; designation?: string | null }) =>
  `${p.name}${p.code ? ` (${p.code})` : ""}${p.designation ? ` — ${p.designation}` : ""}`;

export interface PositionRow { id: string; title: string; role: string | null; department_id: string | null; department: string | null; family: string | null; active: boolean; sample: boolean }
export async function positions(db: Db): Promise<PositionRow[]> {
  const { data } = await db.from("positions").select("id,title,role,department_id,family,active,sample,department:departments(name)").order("title");
  return (data ?? []).map((p) => ({ ...p, department: one(p.department as unknown as { name: string } | null)?.name ?? null })) as PositionRow[];
}
/** "Calibration Incharge — Calibration & gauge control (Quality)" */
export const positionLabel = (p: { title: string; role: string | null; department?: string | null }) =>
  `${p.title}${p.role ? ` — ${p.role}` : ""}${p.department ? ` (${p.department})` : ""}`;
