import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { addDaysIso, daysBetween, periodLabel, taskState, STATE_LABEL, STATE_TONE, KINDS } from "@/lib/compliance/rules";
import { ensureTasks } from "@/lib/compliance/service";
import { CompTabs, dmy } from "../ui";
import { completeTask } from "../actions";

export const metadata = { title: "Compliance register" };

type Row = { id: string; due_on: string; status: string; done_on: string | null; done_by_name: string | null; reference: string | null; evidence_path: string | null; evidence_name: string | null; note: string | null; sample: boolean;
  item: { title: string; law: string | null; frequency: string; kind: string; remind_days: number; code: string; valid_until: string | null; licence_no: string | null; owner_name: string | null } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ s?: string; k?: string }> }) {
  const session = await requireRole([...HR_ROLES, "payroll"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { s = "todo", k } = await searchParams;
  const today = istToday();
  await ensureTasks(session.tenant.id, today);
  const db = await createClient();
  const rows = await fetchAll<Row>((a, b) => {
    let q = db.from("compliance_tasks").select("id,due_on,status,done_on,done_by_name,reference,evidence_path,evidence_name,note,sample,item:compliance_items!inner(title,law,frequency,kind,remind_days,code,valid_until,licence_no,owner_name)");
    if (s === "todo") q = q.eq("status", "open").lte("due_on", addDaysIso(today, 60)).order("due_on");
    else if (s === "done") q = q.neq("status", "open").gte("due_on", addDaysIso(today, -400)).order("due_on", { ascending: false });
    else q = q.gte("due_on", addDaysIso(today, -400)).order("due_on", { ascending: false });
    if (k && KINDS[k]) q = q.eq("item.kind", k);
    return q.range(a, b) as never;
  });

  return (
    <AppShell session={session} active="/app/compliance">
      <div className="pagehead"><div><h1>Compliance register</h1><p>Every statutory payment, return, notice and renewal as it falls due. Mark it done with the challan / acknowledgement no. and attach the proof — an auditor or inspector sees it here.</p></div></div>
      <CompTabs active="reg" hr={hr} />
      <div className="spread" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ border: 0, margin: 0 }}>{[["todo", "To do"], ["done", "Done"], ["all", "All (13 months)"]].map(([x, l]) =>
          <a key={x} className={s === x ? "active" : ""} href={p(`/app/compliance/register?s=${x}${k ? `&k=${k}` : ""}`)}>{l}</a>)}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><a className={`badge${!k ? " info" : ""}`} href={p(`/app/compliance/register?s=${s}`)}>All kinds</a>
          {Object.entries(KINDS).map(([x, l]) => <a key={x} className={`badge${k === x ? " info" : ""}`} href={p(`/app/compliance/register?s=${s}&k=${x}`)}>{l}</a>)}</div>
      </div>

      <div className="card">
        {!rows.length ? <Empty>{s === "todo" ? "Nothing to do in the next 60 days." : "Nothing here."}</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>What</th><th>Due</th><th>Status</th><th>Done</th><th style={{ width: 340 }}></th></tr></thead>
            <tbody>{rows.map((t) => { const state = taskState(t, today, t.item.remind_days); const lic = t.item.frequency === "once"; return (
              <tr key={t.id} style={{ verticalAlign: "top" }}>
                <td><b>{t.item.title}</b> <span className="muted">{periodLabel(t.item, t.due_on)}</span>{t.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}
                  <div className="muted" style={{ fontSize: 12 }}>{t.item.law}{lic && t.item.valid_until ? ` · licence ${t.item.licence_no ?? ""} valid until ${dmy(t.item.valid_until)}` : ""}{t.item.owner_name ? ` · ${t.item.owner_name}` : ""}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{dmy(t.due_on)}{t.status === "open" && <div className="muted" style={{ fontSize: 12 }}>{t.due_on < today ? `${daysBetween(t.due_on, today)} days late` : t.due_on === today ? "today" : `in ${daysBetween(today, t.due_on)} days`}</div>}</td>
                <td><span className={`badge ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span></td>
                <td style={{ fontSize: 13 }}>{t.status !== "open" ? <>{dmy(t.done_on)}{t.reference ? ` · ${t.reference}` : ""}{t.evidence_path && <> · <a href={p(`/api/compliance/file?task=${t.id}`)} target="_blank" rel="noreferrer">proof</a></>}
                  <div className="muted">{t.done_by_name}{t.note ? ` — ${t.note}` : ""}</div></> : "—"}</td>
                <td>{t.status === "open" ? <details><summary className="btn small secondary" style={{ display: "inline-block" }}>Mark done…</summary>
                  <ActionForm action={completeTask} submitLabel="Save as done" className="stack" hidden={{ id: t.id, how: "done" }}>
                    <label className="field">Done on<input type="date" name="done_on" defaultValue={today} max={today} /></label>
                    <label className="field">Reference no. <span className="help">challan / TRRN / acknowledgement</span><input name="reference" maxLength={120} /></label>
                    <label className="field">Proof <span className="help">PDF / photo, up to 5 MB</span><input type="file" name="evidence" accept="application/pdf,image/jpeg,image/png" /></label>
                    {lic && <label className="field">New valid-until date<input type="date" name="new_valid_until" required /></label>}
                    <label className="field">Note<input name="note" maxLength={1000} /></label>
                  </ActionForm>
                  <ActionForm action={completeTask} submitLabel="Does not apply" variant="secondary" className="stack" hidden={{ id: t.id, how: "na" }}>
                    <label className="field">Why it does not apply<input name="note" maxLength={1000} placeholder="e.g. no employees covered this month" /></label>
                  </ActionForm></details>
                  : <ActionForm action={completeTask} submitLabel="Reopen" variant="secondary" className="inline" hidden={{ id: t.id, how: "reopen" }} confirm="Open this again?" />}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
