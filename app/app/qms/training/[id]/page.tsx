import { notFound } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName } from "@/components/ui";
import { p } from "@/lib/base-path";
import { fmtWhen, toLocal } from "@/lib/recruit/format";
import { EVAL_METHODS, PROGRAM_CATEGORIES, testOutcome, EFF_RESULTS } from "@/lib/qms/rules";
import { QmsTabs, Clause, monthLabel } from "../../ui";
import { people, masters, personLabel } from "../../data";
import { addAttendees, cancelSession, completeSession, removeAttendee, saveAttendance, saveSession, scanAttendance, sendInvites } from "../../actions";
import { ScanCard } from "./ScanCard";

export const metadata = { title: "Training session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: s } = await db.from("training_sessions").select("*,program:training_programs(id,title,category,duration_hours,eval_method,eff_days,pass_mark,content)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const pr = (Array.isArray(s.program) ? s.program[0] : s.program) as { id: string; title: string; category: string; duration_hours: number; eval_method: string; eff_days: number | null; pass_mark: number; content: string | null };
  const [ppl, m, { data: att }, { data: eff }] = await Promise.all([
    hr ? people(db) : Promise.resolve([]), hr ? masters(db) : Promise.resolve({ designations: [], departments: [], plants: [] }),
    db.from("training_attendance").select("id,employee_id,attended,method,pre_score,post_score,acknowledged_at,need_id,employee:employees(first_name,last_name,employee_code,designation:designations(name))").eq("session_id", id),
    db.from("training_effectiveness").select("attendance_id,due_on,result").eq("session_id", id),
  ]);
  const list = (att ?? []).map((a) => {
    const e = (Array.isArray(a.employee) ? a.employee[0] : a.employee) as { first_name: string; last_name: string | null; employee_code: string | null; designation: { name: string } | { name: string }[] | null } | null;
    const d = e?.designation ? (Array.isArray(e.designation) ? e.designation[0] : e.designation) : null;
    return { ...a, name: e ? fullName(e) : "—", code: e?.employee_code ?? null, desig: d?.name ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const open = s.status === "planned" || s.status === "scheduled";
  const test = pr.eval_method === "test", signoff = pr.eval_method === "signoff";
  const present = list.filter((a) => a.attended).length;
  const local = s.starts_at ? toLocal(s.starts_at) : null, localEnd = s.ends_at ? toLocal(s.ends_at) : null;

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>{pr.title}{s.sample && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>Sample</span>}</h1>
        <p>{PROGRAM_CATEGORIES[pr.category]} · {pr.duration_hours} h · {EVAL_METHODS[pr.eval_method]} · {s.starts_at ? fmtWhen(s.starts_at) : `planned for ${monthLabel(s.plan_month)}`}
          {s.venue ? ` · ${s.venue}` : ""}{s.trainer ? ` · trainer ${s.trainer}` : ""}</p></div>
        <span className={`badge ${s.status === "done" ? "ok" : s.status === "scheduled" ? "info" : ""}`} style={{ fontSize: 14 }}>{({ planned: "Planned", scheduled: "Scheduled", done: "Done", cancelled: "Cancelled" } as Record<string, string>)[s.status]}</span></div>
      <QmsTabs active="plan" hr={hr} />

      {pr.category === "awareness" && <div className="alert info" style={{ marginBottom: 16 }}>Awareness session <Clause>IATF 7.3</Clause> — each person signs off in his portal after attending (or tick “signed on paper”).</div>}

      <div className="grid two">
        <div className="card">
          <h2>Attendance ({present} present of {list.length})</h2>
          {!list.length ? <Empty>Nobody on the list yet.</Empty> : (
            <ActionForm action={saveAttendance} submitLabel="Save attendance" hidden={{ session_id: id }}>
              <div className="tablewrap" style={{ border: 0 }}><table>
                <thead><tr><th>Present</th><th>Person</th>{test && <><th className="num">Before %</th><th className="num">After %</th></>}{signoff && <th>Signed off</th>}{s.status === "done" && !signoff && <th>Effectiveness</th>}</tr></thead>
                <tbody>{list.map((a) => { const ev = (eff ?? []).find((x) => x.attendance_id === a.id); const t = test ? testOutcome(a.pre_score, a.post_score, pr.pass_mark) : null; return (
                  <tr key={a.id}>
                    <td><input type="checkbox" name={`att_${a.id}`} defaultChecked={!!a.attended} disabled={!hr || s.status === "cancelled"} aria-label={`${a.name} present`} />
                      {a.method === "scan" && a.attended && <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>scanned</span>}</td>
                    <td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{[a.code, a.desig].filter(Boolean).join(" · ")}{a.need_id ? " · from a training need" : ""}</div></td>
                    {test && <><td className="num"><input name={`pre_${a.id}`} inputMode="numeric" defaultValue={a.pre_score ?? ""} style={{ width: 64 }} disabled={!hr} /></td>
                      <td className="num"><input name={`post_${a.id}`} inputMode="numeric" defaultValue={a.post_score ?? ""} style={{ width: 64 }} disabled={!hr} />
                        {t && a.post_score != null && <div style={{ fontSize: 11 }} className={t.passed ? "" : "muted"}>{t.passed ? "passed" : "below pass mark"}</div>}</td></>}
                    {signoff && <td>{a.acknowledged_at ? <span className="badge ok">{fmtDate(a.acknowledged_at)}</span> : <label className="check" style={{ fontSize: 12 }}><input type="checkbox" name={`ack_${a.id}`} disabled={!hr} /> signed on paper</label>}</td>}
                    {s.status === "done" && !signoff && <td>{ev ? (ev.result ? <span className={`badge ${ev.result === "effective" ? "ok" : ev.result === "partly" ? "warn" : "danger"}`}>{EFF_RESULTS[ev.result]}</span> : <span className="muted">due {fmtDate(ev.due_on)}</span>) : "—"}</td>}
                  </tr>); })}</tbody>
              </table></div>
            </ActionForm>)}
          {hr && open && list.some((a) => !a.attended) && (
            <details style={{ marginTop: 12 }}><summary className="muted">Take someone off the list</summary>
              <ActionForm action={removeAttendee} submitLabel="Remove" variant="secondary" className="inline">
                <select name="id" required defaultValue="" aria-label="Person"><option value="" disabled>Choose…</option>{list.filter((a) => !a.attended).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </ActionForm></details>)}
          {hr && open && list.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <ActionForm action={completeSession} submitLabel="Close the training" variant="accent" className="inline" hidden={{ session_id: id }}
              confirm="Close this training? Absent people's needs go back to open; effectiveness checks are scheduled for the people who attended." />
          </div>}
        </div>

        {hr && open && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="card">
              <h2>Mark attendance by ID card</h2>
              <ScanCard sessionId={id} action={scanAttendance} />
            </div>
            <div className="card">
              <h2>Date, venue and trainer</h2>
              <ActionForm action={saveSession} submitLabel="Save" className="formgrid" hidden={{ id, program_id: pr.id, plan_month: s.plan_month }}>
                <label className="field">Date<input type="date" name="date" defaultValue={local?.slice(0, 10) ?? ""} /></label>
                <label className="field">From<input type="time" name="start" defaultValue={local?.slice(11, 16) ?? "10:00"} /></label>
                <label className="field">To<input type="time" name="end" defaultValue={localEnd?.slice(11, 16) ?? "12:00"} /></label>
                <label className="field">Venue<input name="venue" maxLength={120} defaultValue={s.venue ?? ""} /></label>
                <label className="field full">Trainer<input name="trainer" maxLength={120} defaultValue={s.trainer ?? ""} /></label>
                <label className="field full">Notes<input name="notes" maxLength={1000} defaultValue={s.notes ?? ""} /></label>
              </ActionForm>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <ActionForm action={sendInvites} submitLabel={s.invited_at ? "Send the invitations again" : "Send invitations (e-mail + WhatsApp)"} variant="secondary" className="inline" hidden={{ session_id: id }} />
                <ActionForm action={cancelSession} submitLabel="Cancel the session" variant="secondary" className="inline" hidden={{ session_id: id }} confirm="Cancel this session? Its training needs go back to open." />
              </div>
              {s.invited_at && <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Invitations sent {fmtDate(s.invited_at)}. A reminder goes the day before.</p>}
            </div>
            <div className="card">
              <h2>Add people</h2>
              <ActionForm action={addAttendees} submitLabel="Add" hidden={{ session_id: id }} resetOnSuccess>
                <label className="field">People<select name="employee_id" multiple size={6}>{ppl.filter((e) => !list.some((a) => a.employee_id === e.id)).map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
                <label className="field">…or everyone in a department<select name="department_id" defaultValue=""><option value="">—</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              </ActionForm>
            </div>
          </div>
        )}
        {(!hr || !open) && pr.content && <div className="card"><h2>Content</h2><p style={{ whiteSpace: "pre-line", margin: 0 }}>{pr.content}</p></div>}
      </div>
      <p><a href={p("/app/qms/training")}>‹ Training plan</a></p>
    </AppShell>
  );
}
