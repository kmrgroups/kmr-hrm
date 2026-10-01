import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { NEED_SOURCES, NEED_STATUS, addMonths } from "@/lib/qms/rules";
import { QmsTabs, Clause, PriorityBadge, monthLabel } from "../ui";
import { people, masters, personLabel } from "../data";
import { addNeed, buildPlan, findTrainingNeeds, setNeedStatus } from "../actions";

export const metadata = { title: "Training needs (TNI)" };

interface Need { id: string; employee_id: string; topic: string; source: string; reason: string | null; priority: string; status: string; target_month: string | null;
  session_id: string | null; program_id: string | null; raised_by_name: string | null; created_at: string }

export default async function NeedsPage({ searchParams }: { searchParams: Promise<{ s?: string; src?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { s = "open", src } = await searchParams;
  const db = await createClient();
  const [ppl, m, { data: progs }, needs] = await Promise.all([
    people(db, { includeJoiners: true }), masters(db),
    db.from("training_programs").select("id,title,category").eq("active", true).order("title"),
    fetchAll<Need>((a, b) => {
      let q = db.from("training_needs").select("id,employee_id,topic,source,reason,priority,status,target_month,session_id,program_id,raised_by_name,created_at")
        .order("priority").order("target_month", { nullsFirst: false }).order("created_at", { ascending: false });
      if (s === "open") q = q.in("status", ["open", "planned"]); else if (s !== "all") q = q.eq("status", s);
      if (src && NEED_SOURCES[src]) q = q.eq("source", src);
      return q.range(a, b);
    }),
  ]);
  const who = (id: string) => ppl.find((e) => e.id === id);
  const month = istToday().slice(0, 7);
  const openN = needs.filter((n) => n.status === "open"), unlinked = openN.filter((n) => !n.program_id).length;
  const bySource = Object.entries(NEED_SOURCES).map(([k, v]) => [k, v, needs.filter((n) => n.source === k).length] as const).filter((x) => x[2]);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Training needs <Clause>IATF 7.2.1</Clause></h1>
        <p>From competency gaps, the skill matrix, new joiners, process or product changes, customer complaints, audit findings and requests.</p></div>
        {hr && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionForm action={findTrainingNeeds} submitLabel="Find training needs" pendingLabel="Checking the records…" className="inline" />
          <ActionForm action={buildPlan} submitLabel="Put open needs into the plan" variant="secondary" className="inline" />
        </div>}
      </div>
      <QmsTabs active="tni" hr={hr} />

      <div className="tabs" style={{ marginBottom: 12 }}>
        {[["open", "Open & planned"], ["trained", "Trained"], ["closed", "Closed"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) =>
          <a key={k} className={s === k ? "active" : ""} href={p(`/app/qms/needs?s=${k}${src ? `&src=${src}` : ""}`)}>{l}</a>)}
      </div>
      {bySource.length > 1 && <p style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
        <a className={`badge${!src ? " info" : ""}`} href={p(`/app/qms/needs?s=${s}`)}>All sources</a>
        {bySource.map(([k, v, n]) => <a key={k} className={`badge${src === k ? " info" : ""}`} href={p(`/app/qms/needs?s=${s}&src=${k}`)}>{v} {n}</a>)}</p>}

      <div className="card">
        {!needs.length ? <Empty>{s === "open" ? "No open training needs." : "Nothing here."}{hr && s === "open" ? " Press “Find training needs” to check the records." : ""}</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Person</th><th>Training</th><th>Why</th><th>Priority</th><th>By</th><th>Status</th>{hr && <th></th>}</tr></thead>
            <tbody>{needs.map((n) => { const e = who(n.employee_id); return (
              <tr key={n.id}>
                <td><b>{e?.name ?? "—"}</b><div className="muted" style={{ fontSize: 12 }}>{[e?.code, e?.designation].filter(Boolean).join(" · ")}</div></td>
                <td>{n.topic}{!n.program_id && n.status === "open" && <div className="muted" style={{ fontSize: 12 }}>no programme linked</div>}</td>
                <td><span className="badge">{NEED_SOURCES[n.source] ?? n.source}</span>{n.reason && <div className="muted" style={{ fontSize: 12, maxWidth: 320 }}>{n.reason}</div>}</td>
                <td><PriorityBadge p={n.priority} /></td>
                <td>{monthLabel(n.target_month)}<div className="muted" style={{ fontSize: 12 }}>{n.raised_by_name ?? ""} · {fmtDate(n.created_at)}</div></td>
                <td><span className={`badge ${n.status === "open" ? "warn" : n.status === "planned" ? "info" : n.status === "trained" || n.status === "closed" ? "ok" : ""}`}>{NEED_STATUS[n.status]}</span>
                  {n.session_id && <div><a style={{ fontSize: 12 }} href={p(`/app/qms/training/${n.session_id}`)}>session</a></div>}</td>
                {hr && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {(n.status === "open" || n.status === "planned") && <ActionForm action={setNeedStatus} submitLabel="Cancel" variant="secondary" className="inline" hidden={{ id: n.id, status: "cancelled" }} confirm="Cancel this training need?" />}
                  {n.status === "trained" && <ActionForm action={setNeedStatus} submitLabel="Close" variant="secondary" className="inline" hidden={{ id: n.id, status: "closed" }} />}
                  {(n.status === "cancelled" || n.status === "closed") && <ActionForm action={setNeedStatus} submitLabel="Reopen" variant="secondary" className="inline" hidden={{ id: n.id, status: "open" }} />}
                </td>}
              </tr>); })}</tbody>
          </table></div>)}
        {hr && unlinked > 0 && <p className="muted" style={{ marginBottom: 0 }}>{unlinked} open need{unlinked === 1 ? " has" : "s have"} no programme: add the person to a session on the Training plan, or create a programme for it.</p>}
      </div>

      <div className="card">
        <h2>{hr ? "Record a training need" : "Ask for training for your team"}</h2>
        <ActionForm action={addNeed} submitLabel={hr ? "Record" : "Ask HR"} className="formgrid" resetOnSuccess>
          <label className="field full">People<select name="employee_id" multiple size={6}>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select>
            <span className="help">Hold Ctrl (or Cmd) to choose several.</span></label>
          {hr && <>
            <label className="field">…or everyone in a department<select name="department_id" defaultValue=""><option value="">—</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="field">…or everyone with a designation<select name="designation_id" defaultValue=""><option value="">—</option>{m.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          </>}
          <label className="field">Programme<select name="program_id" defaultValue=""><option value="">— (describe below)</option>{(progs ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
          <label className="field">Training needed<input name="topic" maxLength={200} placeholder="Blank = the programme's name" /></label>
          {hr && <label className="field">Why<select name="source" defaultValue="process_change">
            {["process_change", "customer_complaint", "audit_finding", "request", "awareness"].map((k) => <option key={k} value={k}>{NEED_SOURCES[k]}</option>)}</select></label>}
          <label className="field">Priority<select name="priority" defaultValue="normal"><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
          <label className="field">By (month)<input type="month" name="target_month" defaultValue={addMonths(month, 1)} /></label>
          <label className="field full">Reason / reference<input name="reason" maxLength={500} placeholder="e.g. 8D C-2291 burr in cross hole; EC-118 new washing chemical; audit finding NC-07" /></label>
        </ActionForm>
      </div>
    </AppShell>
  );
}
