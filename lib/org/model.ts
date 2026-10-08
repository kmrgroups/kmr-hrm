// Turns the employee records (reporting manager) and the boxes entered directly into one list of chart items.
import type { OrgItem } from "./layout";

export interface OrgEmployee {
  id: string; name: string; code: string | null; status: string; manager_id: string | null;
  designation: string | null; position: string | null; department: string | null; plant_id: string | null; department_id: string | null;
}
export interface OrgNode { id: string; title: string; subtitle: string | null; kind: "person" | "vacant" | "external"; parent_employee_id: string | null; parent_node_id: string | null; department: string | null; sort_order: number }
export interface OrgLink { employee_id: string; parent_node_id: string }
export interface OrgFilter { plantId?: string | null; departmentId?: string | null }

/** active people only; a person whose manager has left (or is filtered out) hangs from the nearest manager still on the chart */
export function buildItems(emps: OrgEmployee[], nodes: OrgNode[], links: OrgLink[], f: OrgFilter = {}): OrgItem[] {
  const byId = new Map(emps.map((e) => [e.id, e]));
  const linkOf = new Map(links.map((l) => [l.employee_id, l.parent_node_id]));
  const shown = new Set(emps.filter((e) => e.status === "active" && (!f.plantId || e.plant_id === f.plantId) && (!f.departmentId || e.department_id === f.departmentId)).map((e) => e.id));
  const filtered = !!(f.plantId || f.departmentId);
  const nearest = (id: string | null): string | null => {
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) { if (shown.has(cur)) return cur; seen.add(cur); cur = byId.get(cur)?.manager_id ?? null; }
    return null;
  };
  const nodeIds = new Set(nodes.map((n) => n.id));
  const items: OrgItem[] = [];
  for (const e of emps) {
    if (!shown.has(e.id)) continue;
    const mgr = nearest(e.manager_id);
    const link = linkOf.get(e.id);
    const parent = mgr ? `e:${mgr}` : link && nodeIds.has(link) ? `n:${link}` : null;
    items.push({
      key: `e:${e.id}`, parent, title: e.name, subtitle: e.position || e.designation || undefined,
      line3: [e.code, e.department].filter(Boolean).join(" · ") || undefined, group: e.department ?? "", kind: "person", order: 0,
    });
  }
  const keys = new Set(items.map((i) => i.key));
  for (const n of nodes) {
    const parent = n.parent_employee_id ? `e:${n.parent_employee_id}` : n.parent_node_id ? `n:${n.parent_node_id}` : null;
    if (filtered && parent && !keys.has(parent) && !nodeIds.has(parent.slice(2))) continue;
    items.push({ key: `n:${n.id}`, parent, title: n.title, subtitle: n.subtitle ?? undefined, line3: n.kind === "vacant" ? "VACANT" : n.kind === "external" ? "External" : n.department ?? undefined,
      group: n.department ?? "", kind: n.kind, order: n.sort_order });
  }
  // a box hanging under a person who is not on the chart (filtered out / left) becomes a top box rather than vanishing
  const have = new Set(items.map((i) => i.key));
  return items.map((i) => (i.parent && !have.has(i.parent) ? { ...i, parent: null } : i));
}

/** would giving `employeeId` this manager make a loop? (A reports to B reports to … A) */
export function wouldLoop(emps: { id: string; manager_id: string | null }[], employeeId: string, newManagerId: string): boolean {
  const by = new Map(emps.map((e) => [e.id, e.manager_id]));
  let cur: string | null = newManagerId; const seen = new Set<string>();
  while (cur && !seen.has(cur)) { if (cur === employeeId) return true; seen.add(cur); cur = by.get(cur) ?? null; }
  return false;
}

/** same chart content ⇒ same text: used to tell whether the chart changed since the last issued revision */
export function fingerprint(items: OrgItem[]): string {
  return items.map((i) => [i.key, i.parent ?? "", i.title, i.subtitle ?? "", i.line3 ?? "", i.kind, i.order].join("|")).sort().join("\n");
}
