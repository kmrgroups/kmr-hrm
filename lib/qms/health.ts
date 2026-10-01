import "server-only";
// The QMS health check: what the overview shows, and the findings an auditor would raise — worked out by fixed rules.
// The QMS agent asks the free AI only to put these findings in the order HR should work on them.
import { fetchAll } from "@/lib/attendance/service";
import { coverage, competencyCoverage, competencyGaps, auditorStatus, addDaysIso } from "./rules";
import { people, qmsSettings } from "@/app/app/qms/data";
import type { Finding } from "./ai";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function loadHealth(db: Db, hr: boolean, today: string) {
  const [ppl, st, ops, skills, req, assessed, needs, sessions, eff, ojt, auditors, audits, rr, acks, awareness, jds, aiPrograms, aiQuiz] = await Promise.all([
    people(db), qmsSettings(db),
    db.from("operations").select("id,line,code,name,critical,min_qualified").eq("active", true).then((r) => r.data ?? []),
    fetchAll<{ employee_id: string; operation_id: string; level: number; valid_until: string | null }>((a, b) => db.from("skill_levels").select("employee_id,operation_id,level,valid_until").range(a, b)),
    db.from("role_competencies").select("position_id,competency_id,required_level").not("position_id", "is", null).then((r) => (r.data ?? []) as { position_id: string; competency_id: string; required_level: number }[]),
    fetchAll<{ employee_id: string; competency_id: string; level: number }>((a, b) => db.from("employee_competencies").select("employee_id,competency_id,level").range(a, b)),
    fetchAll<{ status: string; source: string; priority: string; program_id: string | null }>((a, b) => db.from("training_needs").select("status,source,priority,program_id").in("status", ["open", "planned"]).range(a, b)),
    db.from("training_sessions").select("id,status,plan_month,starts_at,program:training_programs(duration_hours),training_attendance(attended)").gte("plan_month", `${today.slice(0, 4)}-01`).then((r) => r.data ?? []),
    db.from("training_effectiveness").select("due_on,result").then((r) => r.data ?? []),
    db.from("ojt_records").select("status,started_on,template:ojt_templates(days)").eq("status", "in_progress").then((r) => r.data ?? []),
    hr ? db.from("auditors").select("id,valid_until,audits_per_year,active").eq("active", true).then((r) => r.data ?? []) : Promise.resolve([]),
    hr ? db.from("auditor_audits").select("auditor_id,audit_date").gte("audit_date", addDaysIso(today, -365)).then((r) => r.data ?? []) : Promise.resolve([]),
    db.from("rr_roles").select("id,position_id,version,status").not("position_id", "is", null).then((r) => r.data ?? []),
    db.from("rr_acks").select("rr_id,employee_id,version").then((r) => r.data ?? []),
    db.from("training_attendance").select("acknowledged_at,session:training_sessions!inner(status,program:training_programs!inner(eval_method))").eq("attended", true).is("acknowledged_at", null).then((r) => r.data ?? []),
    db.from("job_descriptions").select("position_id,status").not("position_id", "is", null).then((r) => r.data ?? []),
    hr ? db.from("training_programs").select("id", { count: "exact", head: true }).eq("ai_proposed", true).is("reviewed_at", null).then((r) => r.count ?? 0) : Promise.resolve(0),
    hr ? db.from("training_programs").select("id", { count: "exact", head: true }).eq("quiz_status", "ai_draft").then((r) => r.count ?? 0) : Promise.resolve(0),
  ]);
  const approvedRr = rr.filter((r) => r.status === "approved");
  const cov = coverage(ops, skills, st.min_qualified, today);
  const alerts = cov.filter((c) => c.alert);
  const gaps = competencyGaps(ppl, req, assessed);
  const compCov = competencyCoverage(ppl, req, assessed);
  const covered = cov.filter((c) => !c.short && !c.expired).length;
  const doneSess = sessions.filter((s) => s.status === "done");
  const hours = doneSess.reduce((sum, s) => {
    const pr = one(s.program as { duration_hours: number } | { duration_hours: number }[] | null);
    const present = (s.training_attendance as { attended: boolean | null }[]).filter((a) => a.attended).length;
    return sum + (pr?.duration_hours ?? 0) * present;
  }, 0);
  const planned = sessions.filter((s) => s.status !== "cancelled");
  const effDue = eff.filter((e) => !e.result), effOver = effDue.filter((e) => e.due_on < today), effDone = eff.filter((e) => e.result);
  const effRate = effDone.length ? Math.round((effDone.filter((e) => e.result === "effective").length / effDone.length) * 100) : null;
  const ojtLate = ojt.filter((o) => { const t = one(o.template as { days: number } | { days: number }[] | null); return addDaysIso(o.started_on, t?.days ?? 15) < today; }).length;
  const audStat = auditors.map((a) => auditorStatus(a, audits.filter((x) => x.auditor_id === a.id).length, today));
  const ackPending = ppl.filter((e) => approvedRr.some((r) => r.position_id === e.position_id && !acks.some((k) => k.rr_id === r.id && k.employee_id === e.id && k.version === r.version))).length;
  const noPosition = ppl.filter((e) => !e.position_id).length;
  const signoffPending = awareness.filter((a) => {
    const s = one(a.session as unknown as { program: { eval_method: string } | { eval_method: string }[] } | null);
    return (s ? one(s.program) : null)?.eval_method === "signoff";
  }).length;
  const open = needs.filter((n) => n.status === "open");
  const held = [...new Set(ppl.map((e) => e.position_id).filter((x): x is string => !!x))];
  const noSheet = held.filter((pid) => !approvedRr.some((r) => r.position_id === pid)).length;
  const noJd = held.filter((pid) => !jds.some((j) => j.position_id === pid && j.status === "approved")).length;
  const unassessed = ppl.filter((e) => e.position_id && req.some((r) => r.position_id === e.position_id) && !assessed.some((a) => a.employee_id === e.id)).length;

  // ---------- findings (fixed rules; severity 3 = an auditor would raise a nonconformity)
  const F: Finding[] = [];
  const add = (key: string, clause: string, severity: 1 | 2 | 3, count: number, text: string, href: string) => { if (count > 0) F.push({ key, clause, severity, count, text, href }); };
  add("no_position", "ISO 9001 5.3", 2, noPosition, `${noPosition} active ${noPosition === 1 ? "person has" : "people have"} no position, so no R&R, competency need or KPI sheet applies to them.`, "/app/qms/positions");
  add("no_jd", "ISO 9001 5.3", 2, noJd, `${noJd} position${noJd === 1 ? "" : "s"} held by people ${noJd === 1 ? "has" : "have"} no approved job description.`, "/app/qms/positions");
  add("no_sheet", "ISO 9001 5.3", 3, noSheet, `${noSheet} position${noSheet === 1 ? "" : "s"} held by people ${noSheet === 1 ? "has" : "have"} no approved R&R sheet (roles, responsibilities, authority).`, "/app/qms/positions");
  add("ack_pending", "ISO 9001 5.3", 1, ackPending, `${ackPending} R&R acknowledgement${ackPending === 1 ? "" : "s"} pending from the people holding the positions.`, "/app/qms/positions");
  add("unassessed", "IATF 7.2.1", 3, unassessed, `${unassessed} ${unassessed === 1 ? "person has" : "people have"} never been assessed against the competencies their position needs.`, "/app/qms/competency");
  add("comp_gaps", "IATF 7.2.1", 2, gaps.length, `${gaps.length} competency gap${gaps.length === 1 ? "" : "s"} (assessed level below what the position needs); ${compCov}% of needs met.`, "/app/qms/competency");
  const zero = alerts.filter((a) => a.qualified === 0).length;
  add("skill_zero", "IATF 7.2.1", 3, zero, `${zero} operation${zero === 1 ? " has" : "s have"} nobody qualified (level 3 or 4).`, "/app/qms/skills");
  add("skill_short", "IATF 7.2.1", 2, alerts.length - zero, `${alerts.length - zero} operation${alerts.length - zero === 1 ? " has" : "s have"} fewer qualified people than needed, or lapsed re-certifications.`, "/app/qms/skills");
  const noProg = open.filter((n) => !n.program_id).length;
  add("needs_no_programme", "ISO 9001 7.2", 2, noProg, `${noProg} open training need${noProg === 1 ? " has" : "s have"} no training programme, so they cannot be planned.`, "/app/qms/needs");
  const high = open.filter((n) => n.priority === "high").length;
  add("needs_high", "IATF 7.2.1", 2, high, `${high} high-priority training need${high === 1 ? " is" : "s are"} still open (not in the calendar).`, "/app/qms/needs");
  add("eff_overdue", "ISO 9001 7.2(c)", 3, effOver.length, `${effOver.length} training effectiveness check${effOver.length === 1 ? " is" : "s are"} overdue.`, "/app/qms/effectiveness");
  add("ojt_late", "IATF 7.2.2", 1, ojtLate, `${ojtLate} on-the-job training record${ojtLate === 1 ? " is" : "s are"} past the planned days.`, "/app/qms/ojt");
  const audD = audStat.filter((s) => s.tone === "danger").length, audW = audStat.filter((s) => s.tone === "warn").length;
  add("auditor_lapsed", "IATF 7.2.3", 3, audD, `${audD} internal auditor qualification${audD === 1 ? " has" : "s have"} lapsed.`, "/app/qms/auditors");
  add("auditor_attention", "IATF 7.2.3", 2, audW, `${audW} internal auditor${audW === 1 ? " needs" : "s need"} attention (too few audits, or the qualification lapses soon).`, "/app/qms/auditors");
  add("signoff_pending", "IATF 7.3", 1, signoffPending, `${signoffPending} awareness sign-off${signoffPending === 1 ? " is" : "s are"} pending.`, "/app/qms/training");
  add("no_policy", "IATF 7.3", 2, st.quality_policy ? 0 : 1, "The quality policy is not written in the HRM, so awareness sessions and the audit pack cannot carry it.", "/app/settings/qms");
  add("ai_review", "Review", 1, aiPrograms + aiQuiz, `${aiPrograms + aiQuiz} AI draft${aiPrograms + aiQuiz === 1 ? " waits" : "s wait"} for a person to review (programmes, test questions).`, "/app/qms/ai");

  return { ppl, st, ops, cov, alerts, gaps, compCov, covered, sessions, doneSess, hours, planned, effDue, effOver, effDone, effRate, ojt, ojtLate, auditors, audStat,
    approvedRr, ackPending, noPosition, signoffPending, needs, open, findings: F };
}
