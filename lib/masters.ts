import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Option { id: string; name: string; extra?: string | null }

/** Dropdown data for employee forms (RLS limits it to the user's company) */
export async function loadMasters() {
  const supabase = await createClient();
  const [plants, departments, designations, managers] = await Promise.all([
    supabase.from("plants").select("id,name,code").eq("active", true).order("name"),
    supabase.from("departments").select("id,name").eq("active", true).order("name"),
    supabase.from("designations").select("id,name,grade").eq("active", true).order("name"),
    supabase.from("employees").select("id,first_name,last_name,employee_code").eq("status", "active").order("first_name").limit(1000),
  ]);
  return {
    plants: (plants.data ?? []).map((p) => ({ id: p.id, name: p.name, extra: p.code })) as Option[],
    departments: (departments.data ?? []).map((d) => ({ id: d.id, name: d.name })) as Option[],
    designations: (designations.data ?? []).map((d) => ({ id: d.id, name: d.name, extra: d.grade })) as Option[],
    managers: (managers.data ?? []).map((m) => ({
      id: m.id, name: [m.first_name, m.last_name].filter(Boolean).join(" "), extra: m.employee_code,
    })) as Option[],
  };
}
export type Masters = Awaited<ReturnType<typeof loadMasters>>;
