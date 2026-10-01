import "server-only";
// Positions: Position title + Role + Department. The job description, the R&R sheet (roles, responsibilities,
// authority, competency, KPI), competency mapping and KPI sheets all hang on the position — never on a designation
// or a person.
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectFamily } from "@/lib/recruit/vocab";
import { sheetFromJd, competencyCategory } from "./sheet";
import { smartSheet, type Actor } from "./ai";

type Db = SupabaseClient;

/** the position for this title + role + department: found, or created */
export async function ensurePosition(db: Db, tenantId: string, p: { title: string; role: string | null; department_id: string | null; department?: string | null }, userId?: string): Promise<string> {
  const title = p.title.trim().slice(0, 120), role = p.role?.trim().slice(0, 160) || null;
  let q = db.from("positions").select("id,title,role").eq("tenant_id", tenantId).ilike("title", title.replace(/[%_]/g, "\\$&"));
  q = p.department_id ? q.eq("department_id", p.department_id) : q.is("department_id", null);
  const { data: found } = await q;
  const hit = (found ?? []).find((x) => (x.role ?? "").toLowerCase() === (role ?? "").toLowerCase());
  if (hit) return hit.id;
  const { data, error } = await db.from("positions").insert({ tenant_id: tenantId, title, role, department_id: p.department_id,
    family: detectFamily(title, role, p.department).key, created_by: userId ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** the position's current job description: the newest approved version */
export async function currentJd(db: Db, positionId: string) {
  const { data } = await db.from("job_descriptions").select("*").eq("position_id", positionId).eq("status", "approved").order("version", { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

/** the competency in the company's library with this name (added when it is new) */
async function libraryCompetency(db: Db, tenantId: string, name: string): Promise<string> {
  const { data: ex } = await db.from("competencies").select("id").eq("tenant_id", tenantId).ilike("name", name.replace(/[%_]/g, "\\$&")).limit(1);
  if (ex?.[0]) return ex[0].id;
  const { data, error } = await db.from("competencies").insert({ tenant_id: tenantId, name: name.slice(0, 120), category: competencyCategory(name) }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * Writes the position's R&R sheet from its approved job description. An approved sheet becomes a new draft version;
 * KPIs keep their history (a KPI no longer in the JD is switched off, not deleted).
 */
export async function writeSheetFromJd(db: Db, tenantId: string, positionId: string, actor?: Actor): Promise<{ version: number; created: boolean; model: string | null }> {
  const { data: pos } = await db.from("positions").select("id,title,role,department_id,departments(name)").eq("id", positionId).single();
  if (!pos) throw new Error("Position not found.");
  const jd = await currentJd(db, positionId);
  if (!jd) throw new Error("Approve the position's job description first — the sheet is written from it.");
  const department = (pos as unknown as { departments: { name: string } | null }).departments?.name ?? null;
  const { sheet: sh, model } = actor ? await smartSheet(db, actor, jd, { title: pos.title, role: pos.role, department }) : { sheet: sheetFromJd(jd, pos), model: null };
  const { data: rr } = await db.from("rr_roles").select("id,version,status").eq("position_id", positionId).maybeSingle();
  let version = 1;
  const fields = { purpose: sh.purpose, roles: sh.roles, responsibilities: sh.responsibilities, authorities: sh.authorities, jd_id: jd.id, department_id: pos.department_id, ai_model: model };
  if (rr) {
    version = rr.status === "approved" ? rr.version + 1 : rr.version;
    const { error } = await db.from("rr_roles").update({ ...fields, version, status: "draft", approved_at: null, approved_by: null }).eq("id", rr.id);
    if (error) throw new Error(error.message);
  } else {
    const { count } = await db.from("rr_roles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const { error } = await db.from("rr_roles").insert({ tenant_id: tenantId, position_id: positionId, ...fields, version: 1, status: "draft", doc_no: `HR-RR-${String((count ?? 0) + 1).padStart(3, "0")}` });
    if (error) throw new Error(error.message);
  }
  // competencies needed
  await db.from("role_competencies").delete().eq("position_id", positionId);
  for (const c of sh.competencies) {
    const cid = await libraryCompetency(db, tenantId, c.name);
    await db.from("role_competencies").insert({ tenant_id: tenantId, position_id: positionId, competency_id: cid, required_level: c.level });
  }
  // KPIs
  const { data: cur } = await db.from("kpis").select("id,name").eq("position_id", positionId);
  const keep = new Set<string>();
  let i = 0;
  for (const k of sh.kpis) {
    i++;
    const ex = (cur ?? []).find((x) => x.name.toLowerCase() === k.name.toLowerCase());
    const row = { tenant_id: tenantId, position_id: positionId, name: k.name.slice(0, 120), unit: k.unit, target: k.target, direction: k.direction, frequency: k.frequency,
      review_method: k.review_method, data_source: k.data_source, weight: i <= 2 ? 2 : 1, sort_order: i, active: true };
    if (ex) { keep.add(ex.id); await db.from("kpis").update(row).eq("id", ex.id); } else await db.from("kpis").insert(row);
  }
  const off = (cur ?? []).filter((x) => !keep.has(x.id)).map((x) => x.id);
  if (off.length) await db.from("kpis").update({ active: false }).in("id", off);
  return { version, created: !rr, model };
}
