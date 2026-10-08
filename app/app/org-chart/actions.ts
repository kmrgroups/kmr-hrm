"use server";
import { revalidatePath } from "next/cache";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { istToday } from "@/lib/attendance/time";
import { fetchAll } from "@/lib/attendance/service";
import type { ActionState } from "@/app/app/employees/actions";
import { loadOrg, chartItems } from "@/lib/org/data";
import { wouldLoop } from "@/lib/org/model";

const PATH = "/app/org-chart";
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const str = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const KINDS = ["person", "vacant", "external"] as const;

/** "Reports to" value: "e:<employee id>", "n:<box id>" or "" (top of the chart) */
function parseParent(v: string): { emp: string | null; node: string | null } | null {
  if (!v) return { emp: null, node: null };
  const m = /^([en]):([0-9a-f-]{36})$/.exec(v);
  return m ? (m[1] === "e" ? { emp: m[2]!, node: null } : { emp: null, node: m[2]! }) : null;
}

export async function saveNode(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const db = await createClient();
    const id = str(f, "id", 40);
    const title = str(f, "title", 120);
    if (title.length < 2) return { error: "Enter the name or position for this box." };
    const kind = KINDS.find((k) => k === f.get("kind")) ?? "person";
    const parent = parseParent(str(f, "parent", 60));
    if (!parent) return { error: "Choose who this box reports to." };
    const dept = str(f, "department_id", 40);
    if (id && parent.node === id) return { error: "A box cannot report to itself." };
    if (id && parent.node) {                                   // no loop of boxes
      const { data: all } = await db.from("org_nodes").select("id,parent_node_id");
      const up = new Map((all ?? []).map((n) => [n.id as string, n.parent_node_id as string | null]));
      for (let cur: string | null = parent.node, hops = 0; cur && hops < 500; cur = up.get(cur) ?? null, hops++) if (cur === id) return { error: "That would make a loop: the chosen box already reports (directly or not) to this one." };
    }
    const row = { tenant_id: tenant.id, title, subtitle: str(f, "subtitle", 160) || null, kind, parent_employee_id: parent.emp, parent_node_id: parent.node,
      department_id: isId(dept) ? dept : null, sort_order: Math.max(0, Math.min(9999, Math.round(Number(f.get("sort_order")) || 0))), note: str(f, "note", 300) || null };
    const q = id ? db.from("org_nodes").update(row).eq("id", id).select("id").maybeSingle() : db.from("org_nodes").insert({ ...row, created_by: user.id }).select("id").single();
    const { data, error } = await q;
    if (error) return { error: error.message };
    if (!data) return { error: "Box not found." };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: id ? "org.box_changed" : "org.box_added", entity: "org_nodes", entityId: data.id, data: { title, kind } });
    revalidatePath(PATH);
    return { ok: id ? `${title} saved.` : `${title} added to the chart.` };
  } catch (e) { return fail(e); }
}

export async function deleteNode(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const id = str(f, "id", 40);
    if (!isId(id)) return { error: "Box not found." };
    const db = await createClient();
    const { data: n } = await db.from("org_nodes").select("title").eq("id", id).maybeSingle();
    if (!n) return { error: "Box not found." };
    const { error } = await db.from("org_nodes").delete().eq("id", id);     // boxes hanging under it are removed with it; people reporting to it become top boxes
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "org.box_deleted", entity: "org_nodes", entityId: id, data: { title: n.title } });
    revalidatePath(PATH);
    return { ok: `${n.title} removed.` };
  } catch (e) { return fail(e); }
}

/** the reporting line of one person: another employee (the "Reporting manager" on the employee record) or a box entered directly */
export async function setReportsTo(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const emp = str(f, "employee_id", 40);
    if (!isId(emp)) return { error: "Choose the employee." };
    const parent = parseParent(str(f, "parent", 60));
    if (!parent) return { error: "Choose who this person reports to." };
    const db = await createClient();
    const { data: me } = await db.from("employees").select("id,first_name,last_name").eq("id", emp).maybeSingle();
    if (!me) return { error: "Employee not found." };
    if (parent.emp === emp) return { error: "A person cannot report to themselves." };
    if (parent.emp) {
      const all = await fetchAll<{ id: string; manager_id: string | null }>((a, b) => db.from("employees").select("id,manager_id:reporting_manager_id").range(a, b));
      if (!all.some((e) => e.id === parent.emp)) return { error: "The manager is not in this company." };
      if (wouldLoop(all, emp, parent.emp)) return { error: "That would make a loop: the chosen manager already reports (directly or not) to this person." };
    }
    const { error } = await db.from("employees").update({ reporting_manager_id: parent.emp }).eq("id", emp);
    if (error) return { error: error.message };
    if (parent.node) { const { error: e2 } = await db.from("org_employee_links").upsert({ employee_id: emp, tenant_id: tenant.id, parent_node_id: parent.node }); if (e2) return { error: e2.message }; }
    else await db.from("org_employee_links").delete().eq("employee_id", emp);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "org.reporting_line_changed", entity: "employees", entityId: emp, data: { manager: parent.emp, box: parent.node } });
    revalidatePath(PATH); revalidatePath(`/app/employees/${emp}`);
    return { ok: "Reporting line saved." };
  } catch (e) { return fail(e); }
}

export async function saveChartSettings(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const title = str(f, "title", 80), doc = str(f, "doc_no", 40);
    if (title.length < 2 || doc.length < 2) return { error: "Enter the chart title and the document number." };
    const db = await createClient();
    const { error } = await db.from("org_chart_settings").upsert({ tenant_id: tenant.id, title, doc_no: doc, updated_at: new Date().toISOString() });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "org.settings_saved", entity: "org_chart_settings", entityId: tenant.id, data: { title, doc_no: doc } });
    revalidatePath(PATH);
    return { ok: "Saved." };
  } catch (e) { return fail(e); }
}

/** Issue the chart as a numbered revision: what it looked like is kept (so the old revision can be printed again), with who prepared and approved it */
export async function issueRevision(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const note = str(f, "change_note", 400), prepared = str(f, "prepared_by", 80), approved = str(f, "approved_by", 80);
    if (note.length < 3) return { error: "Say what changed (for the revision history)." };
    if (!prepared || !approved) return { error: "Enter who prepared and who approved this revision." };
    const db = await createClient();
    const org = await loadOrg(db);
    const items = chartItems(org);
    if (!items.length) return { error: "The chart is empty — there is nothing to issue." };
    const next = (org.issues[0]?.rev_no ?? -1) + 1;
    const { error } = await db.from("org_chart_issues").insert({ tenant_id: tenant.id, rev_no: next, issued_on: istToday(), change_note: note, prepared_by: prepared, approved_by: approved,
      snapshot: { items, title: org.settings.title, doc_no: org.settings.doc_no }, created_by: user.id });
    if (error) return { error: /duplicate/.test(error.message) ? "Someone just issued a revision — reload and try again." : error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "org.revision_issued", entity: "org_chart_issues", entityId: tenant.id, data: { rev_no: next, note } });
    revalidatePath(PATH);
    return { ok: `Revision ${String(next).padStart(2, "0")} issued.` };
  } catch (e) { return fail(e); }
}
