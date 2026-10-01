import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { fullName } from "@/components/ui";
import { addDaysIso, NEED_SOURCES, NEED_STATUS, AUDITOR_KINDS } from "@/lib/qms/rules";
import { buildAuditPack, type PackPerson } from "@/lib/qms/audit-pack";
import { logAudit } from "@/lib/audit";

export const maxDuration = 60;
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const isId = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);

/** GET ?dept=<id>&desig=<id>&emp=<id>&emp=<id> → the Audit Pack PDF for those people (HR only) */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !hasRole(s.user, HR_ROLES)) return NextResponse.json({ error: "Only HR can download the audit pack." }, { status: 403 });
  const url = new URL(req.url);
  const dept = url.searchParams.get("dept"), desig = url.searchParams.get("desig"), emps = url.searchParams.getAll("emp").filter(isId);
  const db = await createClient();
  let q = db.from("employees").select("id,first_name,last_name,employee_code,designation_id,department_id,date_of_joining,designation:designations(name),department:departments(name),plant:plants(name)")
    .in("status", ["active"]).order("first_name");
  if (emps.length) q = q.in("id", emps);
  if (isId(dept)) q = q.eq("department_id", dept);
  if (isId(desig)) q = q.eq("designation_id", desig);
  const { data: ppl } = await q.limit(200);
  if (!ppl?.length) return NextResponse.json({ error: "Nobody matches — choose a department, designation or people." }, { status: 400 });
  const ids = ppl.map((e) => e.id);
  const today = istToday();

  const [st, comps, req2, ec, ops, sl, att, eff, ojt, auds, audits, rr, acks, needs] = await Promise.all([
    db.from("qms_settings").select("quality_policy,objectives").maybeSingle().then((r) => r.data),
    db.from("competencies").select("id,name").then((r) => r.data ?? []),
    db.from("role_competencies").select("designation_id,competency_id,required_level").then((r) => r.data ?? []),
    fetchAll<{ employee_id: string; competency_id: string; level: number; assessed_on: string; assessed_by_name: string | null }>((a, b) => db.from("employee_competencies").select("employee_id,competency_id,level,assessed_on,assessed_by_name").in("employee_id", ids).range(a, b)),
    db.from("operations").select("id,line,code,name").then((r) => r.data ?? []),
    fetchAll<{ employee_id: string; operation_id: string; level: number; certified_on: string | null; valid_until: string | null }>((a, b) => db.from("skill_levels").select("employee_id,operation_id,level,certified_on,valid_until").in("employee_id", ids).range(a, b)),
    fetchAll<{ id: string; employee_id: string; attended: boolean | null; pre_score: number | null; post_score: number | null; acknowledged_at: string | null; session: unknown }>((a, b) =>
      db.from("training_attendance").select("id,employee_id,attended,pre_score,post_score,acknowledged_at,session:training_sessions(starts_at,plan_month,status,program:training_programs(title,duration_hours,eval_method))").in("employee_id", ids).range(a, b)),
    fetchAll<{ attendance_id: string; result: string | null; evidence: string | null; evaluated_by_name: string | null }>((a, b) => db.from("training_effectiveness").select("attendance_id,result,evidence,evaluated_by_name").in("employee_id", ids).range(a, b)),
    db.from("ojt_records").select("employee_id,status,done,completed_on,signed_off_name,template:ojt_templates(title,items)").in("employee_id", ids).then((r) => r.data ?? []),
    db.from("auditors").select("id,employee_id,kind,qualification,valid_until").in("employee_id", ids).eq("active", true).then((r) => r.data ?? []),
    db.from("auditor_audits").select("auditor_id,audit_date").gte("audit_date", addDaysIso(today, -365)).then((r) => r.data ?? []),
    db.from("rr_roles").select("id,designation_id,department_id,version").eq("status", "approved").then((r) => r.data ?? []),
    db.from("rr_acks").select("rr_id,employee_id,version,acknowledged_at").in("employee_id", ids).then((r) => r.data ?? []),
    db.from("training_needs").select("employee_id,topic,source,status").in("employee_id", ids).in("status", ["open", "planned"]).then((r) => r.data ?? []),
  ]);

  const people: PackPerson[] = ppl.map((e) => {
    const role = rr.find((x) => x.designation_id === e.designation_id && x.department_id === e.department_id) ?? rr.find((x) => x.designation_id === e.designation_id && !x.department_id);
    const ack = role ? acks.find((a) => a.rr_id === role.id && a.employee_id === e.id && a.version === role.version) : null;
    const aud = auds.find((a) => a.employee_id === e.id);
    return {
      name: fullName(e), code: e.employee_code, designation: one(e.designation as unknown as { name: string } | null)?.name ?? null, department: one(e.department as unknown as { name: string } | null)?.name ?? null,
      plant: one(e.plant as unknown as { name: string } | null)?.name ?? null, joined: e.date_of_joining,
      rr: role ? { version: role.version, acknowledged: ack?.acknowledged_at ?? null } : null,
      competencies: req2.filter((r) => r.designation_id === e.designation_id).map((r) => { const a = ec.find((x) => x.employee_id === e.id && x.competency_id === r.competency_id);
        return { name: comps.find((c) => c.id === r.competency_id)?.name ?? "-", required: r.required_level, actual: a?.level ?? 0, assessed: a?.assessed_on ?? null, by: a?.assessed_by_name ?? null }; }),
      skills: sl.filter((x) => x.employee_id === e.id).map((x) => { const o = ops.find((y) => y.id === x.operation_id); return { op: o ? `${o.line} - ${o.code} ${o.name}` : "-", level: x.level, certified: x.certified_on, valid: x.valid_until }; }),
      training: att.filter((a) => a.employee_id === e.id).map((a) => {
        const se = one(a.session as unknown as { starts_at: string | null; plan_month: string; status: string; program: unknown } | null);
        const pr = one(se?.program as unknown as { title: string; duration_hours: number; eval_method: string } | null);
        const ev = eff.find((x) => x.attendance_id === a.id);
        return { se, row: { date: se?.starts_at ?? null, title: pr?.title ?? "-", hours: Number(pr?.duration_hours ?? 0), attended: !!a.attended, pre: a.pre_score, post: a.post_score,
          signed: pr?.eval_method === "signoff" ? a.acknowledged_at : null, result: ev?.result ?? null, evidence: ev?.evidence ?? null, by: ev?.evaluated_by_name ?? null } };
      }).filter((x) => x.se?.status === "done").map((x) => x.row).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
      ojt: ojt.filter((o) => o.employee_id === e.id).map((o) => { const t = one(o.template as unknown as { title: string; items: unknown[] } | null);
        return { title: t?.title ?? "-", status: o.status, done: ((o.done as number[]) ?? []).length, total: t?.items.length ?? 0, signed: o.signed_off_name, on: o.completed_on }; }),
      auditor: aud ? { kind: AUDITOR_KINDS[aud.kind] ?? aud.kind, qualification: aud.qualification, valid: aud.valid_until, audits: audits.filter((x) => x.auditor_id === aud.id).length } : null,
      needs: needs.filter((n) => n.employee_id === e.id).map((n) => ({ topic: n.topic, source: NEED_SOURCES[n.source] ?? n.source, status: NEED_STATUS[n.status] ?? n.status })),
    };
  });
  const scope = emps.length ? `${people.length} chosen people` : [one(ppl[0]!.department as unknown as { name: string } | null)?.name && isId(dept) ? one(ppl[0]!.department as unknown as { name: string } | null)!.name : null,
    isId(desig) ? one(ppl[0]!.designation as unknown as { name: string } | null)?.name : null].filter(Boolean).join(" - ") || "All active employees";
  const bytes = await buildAuditPack(s.tenant, { scope, generatedBy: s.user.full_name, policy: st?.quality_policy ?? null, objectives: st?.objectives ?? [], people });
  await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "qms.audit_pack", entity: "employees", data: { people: people.length, scope } });
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="audit-pack-${today}.pdf"` } });
}
