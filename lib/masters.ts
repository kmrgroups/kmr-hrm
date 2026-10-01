import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Option { id: string; name: string; extra?: string | null }

/** Dropdown data for employee forms (RLS limits it to the user's company) */
export async function loadMasters() {
  const supabase = await createClient();
  const [plants, departments, designations, managers, positions] = await Promise.all([
    supabase.from("plants").select("id,name,code").eq("active", true).order("name"),
    supabase.from("departments").select("id,name").eq("active", true).order("name"),
    supabase.from("designations").select("id,name,grade").eq("active", true).order("name"),
    supabase.from("employees").select("id,first_name,last_name,employee_code").eq("status", "active").order("first_name").limit(1000),
    supabase.from("positions").select("id,title,role,department:departments(name)").eq("active", true).order("title"),
  ]);
  return {
    plants: (plants.data ?? []).map((p) => ({ id: p.id, name: p.name, extra: p.code })) as Option[],
    departments: (departments.data ?? []).map((d) => ({ id: d.id, name: d.name })) as Option[],
    designations: (designations.data ?? []).map((d) => ({ id: d.id, name: d.name, extra: d.grade })) as Option[],
    positions: (positions.data ?? []).map((p) => {
      const d = (Array.isArray(p.department) ? p.department[0] : p.department) as { name: string } | null;
      return { id: p.id, name: `${p.title}${p.role ? ` — ${p.role}` : ""}`, extra: d?.name ?? null };
    }) as Option[],
    managers: (managers.data ?? []).map((m) => ({
      id: m.id, name: [m.first_name, m.last_name].filter(Boolean).join(" "), extra: m.employee_code,
    })) as Option[],
  };
}
export type Masters = Awaited<ReturnType<typeof loadMasters>>;
