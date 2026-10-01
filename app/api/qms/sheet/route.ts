import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { fullName } from "@/components/ui";
import { addMonths, kpiAchievement } from "@/lib/qms/rules";
import { rrSheetPdf, mappingPdf, kpiSheetPdf } from "@/lib/qms/sheet-pdf";

export const maxDuration = 60;
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const isId = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** GET ?kind=rr|mapping|kpi&position=<id>[&month=YYYY-MM][&emp=<id>] → landscape PDF (HR; a manager sees his team) */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !hasRole(s.user, [...HR_ROLES, "manager"])) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind"), pid = url.searchParams.get("position"), emp = url.searchParams.get("emp");
  if (!isId(pid) || !["rr", "mapping", "kpi"].includes(kind ?? "")) return NextResponse.json({ error: "Choose a position." }, { status: 400 });
  const db = await createClient();
  const { data: pos } = await db.from("positions").select("id,title,role,department:departments(name)").eq("id", pid).maybeSingle();
  if (!pos) return NextResponse.json({ error: "Position not found." }, { status: 404 });
  const dept = one(pos.department as unknown as { name: string } | null)?.name ?? null;
  const today = istToday(), slug = pos.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const send = (bytes: Uint8Array, name: string) => new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"` } });

  if (kind === "rr") {
    const [{ data: rr }, { data: comps }, { data: kpis }] = await Promise.all([
      db.from("rr_roles").select("*,jd:job_descriptions(version)").eq("position_id", pid).maybeSingle(),
      db.from("role_competencies").select("required_level,competency:competencies(name)").eq("position_id", pid),
      db.from("kpis").select("name,unit,target,direction,frequency,review_method").eq("position_id", pid).eq("active", true).order("sort_order"),
    ]);
    if (!rr) return NextResponse.json({ error: "This position has no R&R sheet yet." }, { status: 404 });
    const bytes = await rrSheetPdf(s.tenant, {
      position: pos.title, role: pos.role, department: dept, purpose: rr.purpose, roles: rr.roles ?? [], responsibilities: rr.responsibilities ?? [], authorities: rr.authorities ?? [],
      competencies: (comps ?? []).map((c) => ({ name: one(c.competency as unknown as { name: string } | null)?.name ?? "-", level: c.required_level })).sort((a, b) => b.level - a.level),
      kpis: (kpis ?? []).map((k) => ({ ...k, target: k.target == null ? null : Number(k.target) })),
      docNo: rr.doc_no ?? "HR-RR", version: rr.version, date: rr.approved_at ?? rr.updated_at, status: rr.status, jdVersion: one(rr.jd as unknown as { version: number } | null)?.version ?? null,
    });
    return send(bytes, `RR-${slug}.pdf`);
  }

  const [{ data: rc }, ppl] = await Promise.all([
    db.from("role_competencies").select("competency_id,required_level,competency:competencies(name)").eq("position_id", pid),
    fetchAll<Record<string, unknown>>((a, b) => {
      let q = db.from("employees").select("id,first_name,last_name,employee_code,designation:designations(name),department:departments(name)").eq("position_id", pid).eq("status", "active").order("first_name");
      if (isId(emp)) q = q.eq("id", emp);
      return q.range(a, b);
    }),
  ]);
  const peopleRows = ppl.map((e) => ({ id: e.id as string, name: fullName(e as { first_name: string; last_name: string | null }), code: (e.employee_code as string) ?? null,
    designation: one(e.designation as { name: string } | null)?.name ?? null, department: one(e.department as { name: string } | null)?.name ?? null }));

  if (kind === "mapping") {
    const ids = peopleRows.map((p) => p.id);
    const ec = ids.length ? await fetchAll<{ employee_id: string; competency_id: string; level: number; assessed_on: string }>((a, b) =>
      db.from("employee_competencies").select("employee_id,competency_id,level,assessed_on").in("employee_id", ids).range(a, b)) : [];
    const bytes = await mappingPdf(s.tenant, {
      position: pos.title, role: pos.role, department: dept, docNo: "HR-CM", date: today,
      competencies: (rc ?? []).map((c) => ({ id: c.competency_id, name: one(c.competency as unknown as { name: string } | null)?.name ?? "-", required: c.required_level })).sort((a, b) => b.required - a.required),
      people: peopleRows.map((p) => ({ ...p, levels: Object.fromEntries(ec.filter((x) => x.employee_id === p.id).map((x) => [x.competency_id, x.level])), assessed: null })),
    });
    return send(bytes, `competency-mapping-${slug}.pdf`);
  }

  // KPI sheets: the chosen month and the two before it
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get("month") ?? "") ? url.searchParams.get("month")! : addMonths(today.slice(0, 7), -1);
  const months = [addMonths(month, -2), addMonths(month, -1), month];
  const { data: kpis } = await db.from("kpis").select("id,name,unit,target,direction,frequency,review_method,data_source").eq("position_id", pid).eq("active", true).order("sort_order");
  const ids = peopleRows.map((p) => p.id);
  const vals = ids.length && kpis?.length ? await fetchAll<{ kpi_id: string; employee_id: string; month: string; actual: number }>((a, b) =>
    db.from("kpi_values").select("kpi_id,employee_id,month,actual").in("employee_id", ids).in("month", months).range(a, b)) : [];
  const bytes = await kpiSheetPdf(s.tenant, {
    position: pos.title, role: pos.role, months, monthLabels: months.map(monthLabel), date: today, docNo: "HR-KPI",
    people: peopleRows.map((p) => ({ ...p, rows: (kpis ?? []).map((k) => {
      const actuals = months.map((m) => { const v = vals.find((x) => x.kpi_id === k.id && x.employee_id === p.id && x.month === m); return v ? Number(v.actual) : null; });
      const last = [...actuals].reverse().find((a) => a != null) ?? null;
      return { ...k, target: k.target == null ? null : Number(k.target), actuals, achievement: last != null && k.target != null ? kpiAchievement(Number(k.target), last, k.direction) : null };
    }) })),
  });
  return send(bytes, `kpi-sheet-${slug}-${month}.pdf`);
}
