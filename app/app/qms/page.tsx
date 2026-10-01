import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { loadHealth } from "@/lib/qms/health";
import { aiConfigured } from "@/lib/ai/gateway";
import { AgentCard } from "./ai/AgentCard";
import { QmsTabs, Clause } from "./ui";

export const metadata = { title: "QMS — people development" };
export const maxDuration = 60;

export default async function QmsHome() {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const db = await createClient();
  const today = istToday(), month = today.slice(0, 7), yearStart = `${today.slice(0, 4)}-01-01`;
  const h = await loadHealth(db, hr, today);
  const { st, ops, alerts, gaps, compCov, covered, sessions, doneSess, hours, planned, effDue, effOver, effDone, effRate, ojt, ojtLate, auditors, audStat, ackPending, noPosition, signoffPending, needs, open } = h;
  const rr = h.approvedRr;
  const agent = hr ? await db.from("qms_settings").select("agent_result,agent_run_at").maybeSingle().then((r) => r.data) : null;
  const ai = hr && aiConfigured();

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

      {hr && <AgentCard findings={h.findings} saved={agent?.agent_result ?? null} runAt={agent?.agent_run_at ?? null} ai={ai} />}

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
