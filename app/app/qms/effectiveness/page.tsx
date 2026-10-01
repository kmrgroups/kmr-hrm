import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { EFF_RESULTS, SKILL_LEVELS, COMP_LEVELS, testOutcome } from "@/lib/qms/rules";
import { QmsTabs, Clause } from "../ui";
import { evaluate } from "../actions";

export const metadata = { title: "Training effectiveness" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function EffectivenessPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { v = "due" } = await searchParams;
  const today = istToday();
  const db = await createClient();
  let q = db.from("training_effectiveness").select("id,due_on,result,rating,evidence,evaluated_by_name,evaluated_at,retrain_need_id," +
    "employee:employees!training_effectiveness_employee_id_fkey(first_name,last_name,employee_code),evaluator:employees!training_effectiveness_evaluator_id_fkey(first_name,last_name)," +
    "attendance:training_attendance(pre_score,post_score),session:training_sessions(id,starts_at,program:training_programs(title,eval_method,pass_mark,competency_id,operation_id))");
  q = v === "done" ? q.not("result", "is", null).order("evaluated_at", { ascending: false }).limit(300) : q.is("result", null).order("due_on");
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; due_on: string; result: string | null; rating: number | null; evidence: string | null; evaluated_by_name: string | null; evaluated_at: string | null; retrain_need_id: string | null;
    employee: { first_name: string; last_name: string | null; employee_code: string | null } | null; evaluator: { first_name: string; last_name: string | null } | null;
    attendance: { pre_score: number | null; post_score: number | null } | null;
    session: { id: string; starts_at: string | null; program: { title: string; eval_method: string; pass_mark: number; competency_id: string | null; operation_id: string | null } | null } | null;
  }[];
  const { data: all } = await db.from("training_effectiveness").select("result").not("result", "is", null);
  const doneN = (all ?? []).length, eff = (all ?? []).filter((r) => r.result === "effective").length;

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Training effectiveness <Clause>ISO 9001 7.2(c) · IATF 7.2.1</Clause></h1>
        <p>Some weeks after a training, the supervisor checks on the job whether it worked. Not effective → the training is planned again automatically.</p></div>
        {doneN > 0 && <div className="card stat" style={{ minWidth: 180 }}><div className="label">Effective</div><div className="value">{Math.round((eff / doneN) * 100)}%</div><div className="hint">of {doneN} evaluated</div></div>}</div>
      <QmsTabs active="eff" hr={hr} />
      <div className="tabs" style={{ marginBottom: 12 }}>
        <a className={v !== "done" ? "active" : ""} href={p("/app/qms/effectiveness")}>To evaluate</a>
        <a className={v === "done" ? "active" : ""} href={p("/app/qms/effectiveness?v=done")}>Evaluated</a></div>

      <div className="card">
        {!rows.length ? <Empty>{v === "done" ? "Nothing evaluated yet." : "Nothing to evaluate."}</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Person</th><th>Training</th><th>Test</th><th>{v === "done" ? "Result" : "Due"}</th>{v !== "done" && <th style={{ minWidth: 300 }}>Evaluate</th>}</tr></thead>
            <tbody>{rows.map((r) => {
              const pr = one(r.session?.program), att = one(r.attendance);
              const t = pr?.eval_method === "test" ? testOutcome(att?.pre_score ?? null, att?.post_score ?? null, pr.pass_mark) : null;
              const over = !r.result && r.due_on < today, early = !r.result && r.due_on > today;
              return (
                <tr key={r.id}>
                  <td><b>{r.employee ? fullName(r.employee) : "—"}</b><div className="muted" style={{ fontSize: 12 }}>{r.employee?.employee_code}{r.evaluator ? ` · supervisor ${fullName(r.evaluator)}` : ""}</div></td>
                  <td><a href={p(`/app/qms/training/${r.session?.id}`)}>{pr?.title}</a><div className="muted" style={{ fontSize: 12 }}>on {fmtDate(r.session?.starts_at ?? null)}</div></td>
                  <td>{t ? <span className={`badge ${t.passed ? "ok" : "warn"}`} title={t.note}>{att?.post_score ?? "—"}%</span> : <span className="muted">—</span>}</td>
                  {v === "done" ? (
                    <td><span className={`badge ${r.result === "effective" ? "ok" : r.result === "partly" ? "warn" : "danger"}`}>{EFF_RESULTS[r.result!]}</span>{r.rating ? <span className="muted"> · {r.rating}/5</span> : null}
                      <div style={{ fontSize: 13 }}>{r.evidence}</div><div className="muted" style={{ fontSize: 12 }}>{r.evaluated_by_name} · {fmtDate(r.evaluated_at)}{r.retrain_need_id && <> · <a href={p("/app/qms/needs")}>retraining planned</a></>}</div></td>
                  ) : (<>
                    <td><span className={`badge ${over ? "danger" : early ? "" : "warn"}`}>{over ? "overdue " : early ? "from " : "due "}{fmtDate(r.due_on)}</span></td>
                    <td>
                      <details open={over}><summary className="btn secondary small">Record the result</summary>
                        <ActionForm action={evaluate} submitLabel="Save" hidden={{ id: r.id }}>
                          <div className="radios">{Object.entries(EFF_RESULTS).map(([k, l]) => <label key={k} className="check"><input type="radio" name="result" value={k} required /> {l}</label>)}</div>
                          <label className="field">What did you see on the job?<textarea name="evidence" rows={2} required maxLength={600} placeholder="e.g. Did first-off on OP20 alone for two weeks; all readings correct" /></label>
                          <label className="field">Rating<select name="rating" defaultValue=""><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} of 5</option>)}</select></label>
                          {(pr?.operation_id || pr?.competency_id) && <label className="field">New {pr.operation_id ? "skill" : "competency"} level<select name="new_level" defaultValue="">
                            <option value="">No change</option>{(pr.operation_id ? SKILL_LEVELS.map((l) => l.label) : COMP_LEVELS).map((l, i) => <option key={i} value={i}>{i} — {l}</option>)}</select></label>}
                        </ActionForm>
                      </details>
                    </td></>)}
                </tr>);
            })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
