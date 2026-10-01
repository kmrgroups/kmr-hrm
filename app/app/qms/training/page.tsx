import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { fmtWhen } from "@/lib/recruit/format";
import { EVAL_METHODS, PROGRAM_CATEGORIES } from "@/lib/qms/rules";
import { QmsTabs, Clause, monthLabel } from "../ui";
import { people, personLabel } from "../data";
import { saveProgram, saveSession } from "../actions";

export const metadata = { title: "Training plan" };
export const maxDuration = 60;
const STATUS: Record<string, [string, string]> = { planned: ["Planned", ""], scheduled: ["Scheduled", "info"], done: ["Done", "ok"], cancelled: ["Cancelled", ""] };

export default async function TrainingPlan({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const today = istToday();
  const { y } = await searchParams;
  const year = /^\d{4}$/.test(y ?? "") ? y! : today.slice(0, 4);
  const db = await createClient();
  const [ppl, { data: sessions }, { data: progs }, { data: comps }, { data: ops }] = await Promise.all([
    people(db),
    db.from("training_sessions").select("id,plan_month,starts_at,venue,trainer,status,sample,program:training_programs(title,category,duration_hours),training_attendance(attended)")
      .gte("plan_month", `${year}-01`).lte("plan_month", `${year}-12`).order("plan_month").order("starts_at", { nullsFirst: false }),
    db.from("training_programs").select("id,title,category,competency_id,operation_id,duration_hours,eval_method,eff_days,pass_mark,content,active,sample").order("category").order("title"),
    db.from("competencies").select("id,name").eq("active", true).order("name"),
    db.from("operations").select("id,line,code,name").eq("active", true).order("line").order("code"),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const list = sessions ?? [];
  const activeProgs = (progs ?? []).filter((g) => g.active);
  const ProgramFields = ({ g }: { g?: NonNullable<typeof progs>[number] }) => (<>
    <label className="field full">Training<input name="title" required maxLength={160} defaultValue={g?.title ?? ""} placeholder="e.g. Bore gauge usage and care" /></label>
    <label className="field">Category<select name="category" defaultValue={g?.category ?? "technical"}>{Object.entries(PROGRAM_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Hours<input name="duration_hours" inputMode="decimal" required defaultValue={g?.duration_hours ?? 2} /></label>
    <label className="field">Builds competency<select name="competency_id" defaultValue={g?.competency_id ?? ""}><option value="">—</option>{(comps ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="field">…or qualifies for operation<select name="operation_id" defaultValue={g?.operation_id ?? ""}><option value="">—</option>{(ops ?? []).map((o) => <option key={o.id} value={o.id}>{o.line} · {o.code} {o.name}</option>)}</select></label>
    <label className="field">Effectiveness checked by<select name="eval_method" defaultValue={g?.eval_method ?? "observation"}>{Object.entries(EVAL_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Check after<select name="eff_days" defaultValue={String(g?.eff_days ?? "")}><option value="">Company setting</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
    <label className="field">Pass mark (%)<input name="pass_mark" inputMode="numeric" defaultValue={g?.pass_mark ?? 60} /></label>
    <label className="field full">Content<textarea name="content" rows={2} maxLength={3000} defaultValue={g?.content ?? ""} /></label>
  </>);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Training plan {year} <Clause>ISO 9001 7.2 · IATF 7.2.1, 7.3</Clause></h1>
        <p>Sessions month by month. “Put open needs into the plan” on the Training needs tab fills it from the needs.</p></div>
        <div style={{ display: "flex", gap: 6 }}><a className="btn secondary small" href={p(`/app/qms/training?y=${+year - 1}`)}>‹ {+year - 1}</a><a className="btn secondary small" href={p(`/app/qms/training?y=${+year + 1}`)}>{+year + 1} ›</a></div></div>
      <QmsTabs active="plan" hr={hr} />

      <div className="card">
        {!list.length ? <Empty>No sessions planned for {year}.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Month</th><th>Training</th><th>When &amp; where</th><th className="num">People</th><th>Status</th></tr></thead>
            <tbody>{months.flatMap((mo) => list.filter((s) => s.plan_month === mo).map((s, i) => {
              const pr = (Array.isArray(s.program) ? s.program[0] : s.program) as { title: string; category: string; duration_hours: number } | null;
              const att = s.training_attendance as { attended: boolean | null }[];
              return (
                <tr key={s.id} style={mo === today.slice(0, 7) ? { background: "var(--surface-2)" } : undefined}>
                  <td>{i === 0 ? <b>{monthLabel(mo)}</b> : ""}</td>
                  <td><a href={p(`/app/qms/training/${s.id}`)}><b>{pr?.title}</b></a>{s.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}
                    <div className="muted" style={{ fontSize: 12 }}>{PROGRAM_CATEGORIES[pr?.category ?? ""]} · {pr?.duration_hours} h</div></td>
                  <td>{s.starts_at ? fmtWhen(s.starts_at) : <span className="muted">date not set</span>}<div className="muted" style={{ fontSize: 12 }}>{[s.venue, s.trainer].filter(Boolean).join(" · ")}</div></td>
                  <td className="num">{s.status === "done" ? `${att.filter((a) => a.attended).length} / ${att.length}` : att.length}</td>
                  <td><span className={`badge ${STATUS[s.status]?.[1] ?? ""}`}>{STATUS[s.status]?.[0] ?? s.status}</span></td>
                </tr>);
            }))}</tbody>
          </table></div>)}
      </div>

      {hr && (
        <div className="grid two">
          <div className="card">
            <h2>Add a session</h2>
            <ActionForm action={saveSession} submitLabel="Add to the plan" className="formgrid" resetOnSuccess>
              <label className="field full">Programme<select name="program_id" required defaultValue=""><option value="" disabled>Choose…</option>{activeProgs.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
              <label className="field">Month<input type="month" name="plan_month" defaultValue={today.slice(0, 7)} /></label>
              <label className="field">Date (if fixed)<input type="date" name="date" /></label>
              <label className="field">From<input type="time" name="start" defaultValue="10:00" /></label>
              <label className="field">To<input type="time" name="end" defaultValue="12:00" /></label>
              <label className="field">Venue<input name="venue" maxLength={120} placeholder="Training hall, Plant 1" /></label>
              <label className="field">Trainer<input name="trainer" maxLength={120} placeholder="Name (internal or external)" /></label>
              <label className="field full">People<select name="employee_id" multiple size={5}>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select>
                <span className="help">Optional now — you can add people (or a whole department) on the session page.</span></label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>Training programmes ({progs?.length ?? 0})</h2>
            <div className="stack" style={{ gap: 6 }}>{(progs ?? []).map((g) => (
              <details key={g.id}><summary>{g.title} <span className="muted">· {PROGRAM_CATEGORIES[g.category]} · {g.duration_hours} h · {EVAL_METHODS[g.eval_method]}</span>
                {!g.active && <span className="badge" style={{ marginLeft: 6 }}>not used</span>}{g.sample && <span className="badge" style={{ marginLeft: 6 }}>Sample</span>}</summary>
                <ActionForm action={saveProgram} submitLabel="Save" className="formgrid" hidden={{ id: g.id }}>
                  <ProgramFields g={g} />
                  <label className="field full check"><input type="checkbox" name="inactive" defaultChecked={!g.active} /> Not used any more</label>
                </ActionForm></details>))}</div>
            <details style={{ marginTop: 12 }}><summary className="btn secondary small">Add a programme</summary>
              <ActionForm action={saveProgram} submitLabel="Add" className="formgrid" resetOnSuccess><ProgramFields /></ActionForm></details>
          </div>
        </div>
      )}
    </AppShell>
  );
}
