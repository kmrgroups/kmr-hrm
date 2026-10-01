import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { coverage, competencyCoverage, competencyGaps, auditorStatus, addDaysIso } from "@/lib/qms/rules";
import { QmsTabs, Clause } from "./ui";
import { people, qmsSettings } from "./data";

export const metadata = { title: "QMS — people development" };

export default async function QmsHome() {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const db = await createClient();
  const today = istToday(), month = today.slice(0, 7), yearStart = `${today.slice(0, 4)}-01-01`;
  const [ppl, st, ops, skills, req, assessed, needs, sessions, eff, ojt, auditors, audits, rr, acks, awareness] = await Promise.all([
    people(db), qmsSettings(db),
    db.from("operations").select("id,line,code,name,critical,min_qualified").eq("active", true).then((r) => r.data ?? []),
    fetchAll<{ employee_id: string; operation_id: string; level: number; valid_until: string | null }>((a, b) => db.from("skill_levels").select("employee_id,operation_id,level,valid_until").range(a, b)),
    db.from("role_competencies").select("position_id,competency_id,required_level").not("position_id", "is", null).then((r) => (r.data ?? []) as { position_id: string; competency_id: string; required_level: number }[]),
    fetchAll<{ employee_id: string; competency_id: string; level: number }>((a, b) => db.from("employee_competencies").select("employee_id,competency_id,level").range(a, b)),
    fetchAll<{ status: string; source: string; priority: string }>((a, b) => db.from("training_needs").select("status,source,priority").in("status", ["open", "planned"]).range(a, b)),
    db.from("training_sessions").select("id,status,plan_month,starts_at,program:training_programs(duration_hours),training_attendance(attended)").gte("plan_month", `${today.slice(0, 4)}-01`).then((r) => r.data ?? []),
    db.from("training_effectiveness").select("due_on,result").then((r) => r.data ?? []),
    db.from("ojt_records").select("status,started_on,template:ojt_templates(days)").eq("status", "in_progress").then((r) => r.data ?? []),
    hr ? db.from("auditors").select("id,valid_until,audits_per_year,active").eq("active", true).then((r) => r.data ?? []) : Promise.resolve([]),
    hr ? db.from("auditor_audits").select("auditor_id,audit_date").gte("audit_date", addDaysIso(today, -365)).then((r) => r.data ?? []) : Promise.resolve([]),
    db.from("rr_roles").select("id,position_id,version,status").eq("status", "approved").not("position_id", "is", null).then((r) => r.data ?? []),
    db.from("rr_acks").select("rr_id,employee_id,version").then((r) => r.data ?? []),
    db.from("training_attendance").select("acknowledged_at,session:training_sessions!inner(status,program:training_programs!inner(eval_method))").eq("attended", true).is("acknowledged_at", null).then((r) => r.data ?? []),
  ]);
  const cov = coverage(ops, skills, st.min_qualified, today);
  const alerts = cov.filter((c) => c.alert);
  const gaps = competencyGaps(ppl, req, assessed);
  const compCov = competencyCoverage(ppl, req, assessed);
  const covered = cov.filter((c) => !c.short && !c.expired).length;
  const doneSess = sessions.filter((s) => s.status === "done");
  const hours = doneSess.reduce((sum, s) => {
    const pr = (Array.isArray(s.program) ? s.program[0] : s.program) as { duration_hours: number } | null;
    const present = (s.training_attendance as { attended: boolean | null }[]).filter((a) => a.attended).length;
    return sum + (pr?.duration_hours ?? 0) * present;
  }, 0);
  const planned = sessions.filter((s) => s.status !== "cancelled");
  const effDue = eff.filter((e) => !e.result), effOver = effDue.filter((e) => e.due_on < today), effDone = eff.filter((e) => e.result);
  const effRate = effDone.length ? Math.round((effDone.filter((e) => e.result === "effective").length / effDone.length) * 100) : null;
  const ojtLate = ojt.filter((o) => { const t = (Array.isArray(o.template) ? o.template[0] : o.template) as { days: number } | null; return addDaysIso(o.started_on, t?.days ?? 15) < today; }).length;
  const audStat = auditors.map((a) => auditorStatus(a, audits.filter((x) => x.auditor_id === a.id).length, today));
  const ackPending = ppl.filter((e) => rr.some((r) => r.position_id === e.position_id && !acks.some((k) => k.rr_id === r.id && k.employee_id === e.id && k.version === r.version))).length;
  const noPosition = ppl.filter((e) => !e.position_id).length;
  const signoffPending = awareness.filter((a) => {
    const s = (Array.isArray(a.session) ? a.session[0] : a.session) as { program: { eval_method: string } | { eval_method: string }[] } | null;
    const pr = s ? (Array.isArray(s.program) ? s.program[0] : s.program) : null;
    return pr?.eval_method === "signoff";
  }).length;
  const open = needs.filter((n) => n.status === "open");

  const Stat = ({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href: string; tone?: "warn" | "danger" | "ok" }) => (
    <a className="card stat" href={p(href)} style={{ textDecoration: "none", color: "inherit", borderTop: tone ? `3px solid var(--${tone === "ok" ? "ok" : tone})` : undefined }}>
      <div className="label">{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}
    </a>);

  const rows: [string, string, string, string, "ok" | "warn" | "danger"][] = [
    ["ISO 9001 5.3", "Positions: roles, responsibilities & authority", `${rr.length} R&R sheets approved; ${ackPending} acknowledgement${ackPending === 1 ? "" : "s"} pending${noPosition ? `; ${noPosition} people without a position` : ""}`, "/app/qms/positions", ackPending || noPosition ? "warn" : "ok"],
    ["ISO 9001 6.2, 9.1", "KPI sheets per person", "KPI, target, review frequency, review method, actual", "/app/qms/kpi", "ok"],
    ["IATF 7.2.1", "Competency: required vs assessed", `${compCov}% of required competencies met; ${gaps.length} gap${gaps.length === 1 ? "" : "s"}`, "/app/qms/competency", gaps.length ? "warn" : "ok"],
    ["IATF 7.2.1, 7.2.3", "Skill matrix", `${covered} of ${ops.length} operations fully covered; ${alerts.length} alert${alerts.length === 1 ? "" : "s"}`, "/app/qms/skills", alerts.some((a) => a.qualified === 0) ? "danger" : alerts.length ? "warn" : "ok"],
    ["IATF 7.2.1", "Training needs (TNI)", `${open.length} open, ${needs.length - open.length} planned`, "/app/qms/needs", open.filter((n) => n.priority === "high").length ? "warn" : "ok"],
    ["ISO 9001 7.2", "Training plan & records", `${planned.length} sessions this year; ${doneSess.length} done; ${Math.round(hours)} person-hours`, "/app/qms/training", "ok"],
    ["ISO 9001 7.2(c)", "Training effectiveness", `${effDue.length} due (${effOver.length} overdue)${effRate != null ? `; ${effRate}% effective` : ""}`, "/app/qms/effectiveness", effOver.length ? "danger" : effDue.length ? "warn" : "ok"],
    ["IATF 7.2.2", "On-the-job training", `${ojt.length} in progress${ojtLate ? `; ${ojtLate} past the planned days` : ""}`, "/app/qms/ojt", ojtLate ? "warn" : "ok"],
    ...(hr ? [["IATF 7.2.3", "Internal auditor competency", `${auditors.length} auditors; ${audStat.filter((s) => s.tone !== "ok").length} need attention`, "/app/qms/auditors", audStat.some((s) => s.tone === "danger") ? "danger" : audStat.some((s) => s.tone === "warn") ? "warn" : "ok"] as [string, string, string, string, "ok" | "warn" | "danger"]] : []),
    ["IATF 7.3", "Awareness (policy, objectives, CSR, product safety)", `${signoffPending} sign-off${signoffPending === 1 ? "" : "s"} pending`, "/app/qms/training", signoffPending ? "warn" : "ok"],
  ];

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>QMS — people development</h1>
        <p>Competence, training and awareness records for IATF 16949 7.2 / 7.3 and ISO 9001, kept as a by-product of daily work.{hr ? " " : ""}{hr && <a href={p("/app/settings/qms")}>Quality policy &amp; settings</a>}</p></div>
        {hr && <a className="btn secondary" href={p("/app/qms/audit-pack")}>Audit pack (PDF)</a>}</div>
      <QmsTabs active="home" hr={hr} />
      <div className="flowline" style={{ marginBottom: 16 }}>{[["Requisition", "/app/recruitment/requisitions"], ["Job description", "/app/qms/positions"], ["R&R sheet", "/app/qms/positions"], ["Competency mapping", "/app/qms/competency"],
        ["KPI sheet", "/app/qms/kpi"], ["Training needs", "/app/qms/needs"], ["Training calendar", "/app/qms/training"], ["Attendance", "/app/qms/training"], ["Effectiveness", "/app/qms/effectiveness"]]
        .map(([x, h], i) => <span key={x}>{i > 0 && <i>›</i>}<a href={p(h!)}>{x}</a></span>)}</div>

      <div className="grid four">
        <Stat label="Skill matrix alerts" value={alerts.length} hint={`${covered} of ${ops.length} operations fully covered`} href="/app/qms/skills" tone={alerts.length ? "warn" : "ok"} />
        <Stat label="Competency met" value={`${compCov}%`} hint={`${gaps.length} gaps against the role needs`} href="/app/qms/competency" tone={compCov < 80 ? "warn" : "ok"} />
        <Stat label="Training needs open" value={open.length} hint={`${open.filter((n) => n.priority === "high").length} high priority`} href="/app/qms/needs" />
        <Stat label="Effectiveness due" value={effDue.length} hint={effOver.length ? `${effOver.length} overdue` : "none overdue"} href="/app/qms/effectiveness" tone={effOver.length ? "danger" : undefined} />
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <h2>Skill matrix alerts <Clause>IATF 7.2.1</Clause></h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{alerts.slice(0, 12).map((a) => {
            const o = ops.find((x) => x.id === a.operation_id)!;
            return <li key={a.operation_id}><b>{o.line}</b> · {a.alert}{o.critical && <span className="badge danger" style={{ marginLeft: 6 }}>critical</span>}</li>;
          })}</ul>
          <p className="muted" style={{ marginBottom: 0 }}>“Find training needs” on the Training needs tab turns these into needs for the people already learning these operations.</p>
        </div>
      )}

      <div className="card">
        <h2>Auditor&apos;s view — clause by clause</h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Clause</th><th>Record</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map(([cl, rec, status, href, tone]) => (
            <tr key={rec}><td><span className="badge info">{cl}</span></td><td><b>{rec}</b></td>
              <td><span className={`badge ${tone}`} style={{ marginRight: 8 }}>{tone === "ok" ? "OK" : tone === "warn" ? "Attention" : "Action"}</span>{status}</td>
              <td style={{ textAlign: "right" }}><a href={p(href)}>Open</a></td></tr>))}</tbody>
        </table></div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>This year&apos;s training</h2>
          <p style={{ margin: 0 }}>{planned.length} sessions planned since January, {doneSess.length} done, {Math.round(hours)} person-hours delivered.
            {" "}{sessions.filter((s) => s.plan_month === month && s.status !== "done" && s.status !== "cancelled").length} still to run this month.</p>
          <p className="muted" style={{ marginBottom: 0 }}>Since {yearStart.slice(0, 4)}-01: effectiveness checked for {effDone.length} people{effRate != null ? `, ${effRate}% effective` : ""}.</p>
        </div>
        <div className="card">
          <h2>Quality policy <Clause>IATF 7.3</Clause></h2>
          {st.quality_policy ? <p style={{ margin: 0, whiteSpace: "pre-line" }}>{st.quality_policy}</p> : <p className="muted" style={{ margin: 0 }}>Not written yet.{hr && <> <a href={p("/app/settings/qms")}>Add it</a> so awareness sessions and the audit pack carry it.</>}</p>}
          {st.objectives.length > 0 && <ul style={{ marginBottom: 0 }}>{st.objectives.map((o) => <li key={o}>{o}</li>)}</ul>}
        </div>
      </div>
    </AppShell>
  );
}
