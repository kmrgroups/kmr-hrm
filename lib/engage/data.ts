import "server-only";
// Names for the recognition wall, the Kaizen board and colleague lists. An employee can read only his own record,
// so names (name, designation, department — nothing else) are looked up with the service client, for this company only.
import { createAdminClient } from "@/lib/supabase/admin";
import { fullName } from "@/components/ui";

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
export interface NameRow { id: string; name: string; code: string | null; designation: string | null; department: string | null; photo_path: string | null }

export async function namesOf(tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, NameRow>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, NameRow>();
  for (let i = 0; i < want.length; i += 300) {
    const { data } = await createAdminClient().from("employees").select("id,first_name,last_name,employee_code,photo_path,designation:designations(name),department:departments(name)")
      .eq("tenant_id", tenantId).in("id", want.slice(i, i + 300));
    for (const e of data ?? []) out.set(e.id, { id: e.id, name: fullName(e), code: e.employee_code, photo_path: e.photo_path,
      designation: one(e.designation as unknown as { name: string } | null)?.name ?? null, department: one(e.department as unknown as { name: string } | null)?.name ?? null });
  }
  return out;
}

/** colleagues to thank: active people of the company (name, code, department) */
export async function colleagues(tenantId: string): Promise<NameRow[]> {
  const { data } = await createAdminClient().from("employees").select("id,first_name,last_name,employee_code,photo_path,designation:designations(name),department:departments(name)")
    .eq("tenant_id", tenantId).eq("status", "active").order("first_name").limit(3000);
  return (data ?? []).map((e) => ({ id: e.id, name: fullName(e), code: e.employee_code, photo_path: e.photo_path,
    designation: one(e.designation as unknown as { name: string } | null)?.name ?? null, department: one(e.department as unknown as { name: string } | null)?.name ?? null }));
}
