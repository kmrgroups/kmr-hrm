import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/attendance/service";
import { fullName, one } from "@/components/ui";
import { buildItems, type OrgEmployee, type OrgFilter, type OrgLink, type OrgNode } from "./model";
import type { OrgItem } from "./layout";

export interface OrgSettings { title: string; doc_no: string }
export interface OrgIssue { id: string; rev_no: number; issued_on: string; change_note: string | null; prepared_by: string | null; approved_by: string | null; created_at: string }

export async function loadOrg(db: SupabaseClient) {
  const [emps, nodes, links, { data: plants }, { data: depts }, { data: st }, { data: issues }] = await Promise.all([
    fetchAll<{ id: string; first_name: string; last_name: string | null; employee_code: string | null; status: string; reporting_manager_id: string | null; plant_id: string | null; department_id: string | null;
      designation: { name: string } | { name: string }[] | null; department: { name: string } | { name: string }[] | null; position: { title: string } | { title: string }[] | null }>((a, b) =>
      db.from("employees").select("id,first_name,last_name,employee_code,status,reporting_manager_id,plant_id,department_id,designation:designations(name),department:departments(name),position:positions(title)")
        .order("employee_code", { nullsFirst: false }).range(a, b)),
    fetchAll<{ id: string; title: string; subtitle: string | null; kind: "person" | "vacant" | "external"; parent_employee_id: string | null; parent_node_id: string | null; sort_order: number; department_id: string | null; department: { name: string } | { name: string }[] | null }>((a, b) =>
      db.from("org_nodes").select("id,title,subtitle,kind,parent_employee_id,parent_node_id,sort_order,department_id,department:departments(name)").order("sort_order").order("title").range(a, b)),
    fetchAll<OrgLink>((a, b) => db.from("org_employee_links").select("employee_id,parent_node_id").range(a, b)),
    db.from("plants").select("id,name").eq("active", true).order("name"),
    db.from("departments").select("id,name").eq("active", true).order("name"),
    db.from("org_chart_settings").select("title,doc_no").maybeSingle(),
    db.from("org_chart_issues").select("id,rev_no,issued_on,change_note,prepared_by,approved_by,created_at").order("rev_no", { ascending: false }).limit(50),
  ]);
  const employees: OrgEmployee[] = emps.map((e) => ({
    id: e.id, name: fullName(e), code: e.employee_code, status: e.status, manager_id: e.reporting_manager_id, plant_id: e.plant_id, department_id: e.department_id,
    designation: one(e.designation)?.name ?? null, position: one(e.position)?.title ?? null, department: one(e.department)?.name ?? null,
  }));
  const boxes: OrgNode[] = nodes.map((n) => ({ id: n.id, title: n.title, subtitle: n.subtitle, kind: n.kind, parent_employee_id: n.parent_employee_id, parent_node_id: n.parent_node_id, department: one(n.department)?.name ?? null, sort_order: n.sort_order }));
  const settings: OrgSettings = { title: st?.title ?? "Organisation Chart", doc_no: st?.doc_no ?? "HR-ORG-01" };
  return { employees, boxes, links, plants: plants ?? [], departments: depts ?? [], settings, issues: (issues ?? []) as OrgIssue[] };
}
export type OrgData = Awaited<ReturnType<typeof loadOrg>>;

export const chartItems = (o: OrgData, f: OrgFilter = {}): OrgItem[] => buildItems(o.employees, o.boxes, o.links, f);
