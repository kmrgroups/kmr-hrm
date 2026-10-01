import { redirect } from "next/navigation";
import { requireSession, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { fmtWhen } from "@/lib/recruit/format";
import { SKILL_LEVELS, COMP_LEVELS, EFF_RESULTS, NEED_STATUS, addMonths, kpiAchievement } from "@/lib/qms/rules";
import { LevelPie, monthLabel } from "@/app/app/qms/ui";
import { ackAwareness, ackRr } from "@/app/app/qms/actions";

export const metadata = { title: "My skills & training" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function MyDevelopment() {
  const session = await requireSession();
  const emp = session.user.employee_id;
  if (!emp) redirect(homeFor(session.user));
  const db = await createClient();
  const today = istToday();
  const { data: me } = await db.from("employees").select("designation_id,department_id,designation:designations(name)").eq("id", emp).single();
  const [{ data: rrs }, { data: acks }, { data: st }, { data: att }, { data: skills }, { data: comps }, { data: req }, { data: needs }, { data: kpis }, { data: vals }] = await Promise.all([
    db.from("rr_roles").select("*").eq("status", "approved").eq("designation_id", me?.designation_id ?? "00000000-0000-0000-0000-000000000000"),
    db.from("rr_acks").select("rr_id,version,acknowledged_at").eq("employee_id", emp),
    db.from("qms_settings").select("quality_policy,objectives,csr").maybeSingle(),
    db.from("training_attendance").select("id,attended,acknowledged_at,post_score,session:training_sessions(starts_at,plan_month,status,venue,program:training_programs(title,eval_method,duration_hours)),effectiveness:training_effectiveness(result)").eq("employee_id", emp),
    db.from("skill_levels").select("level,valid_until,operation:operations(line,code,name)").eq("employee_id", emp),
    db.from("employee_competencies").select("competency_id,level").eq("employee_id", emp),
    db.from("role_competencies").select("competency_id,required_level,competency:competencies(name)").eq("designation_id", me?.designation_id ?? "00000000-0000-0000-0000-000000000000"),
    db.from("training_needs").select("topic,status,target_month").eq("employee_id", emp).in("status", ["open", "planned"]),
    db.from("kpis").select("id,name,unit,target,direction").eq("active", true).eq("designation_id", me?.designation_id ?? "00000000-0000-0000-0000-000000000000"),
    db.from("kpi_values").select("kpi_id,month,actual").eq("employee_id", emp).gte("month", addMonths(today.slice(0, 7), -3)),
  ]);
  const rr = (rrs ?? []).find((r) => r.department_id === me?.department_id) ?? (rrs ?? []).find((r) => !r.department_id);
  const acked = rr && (acks ?? []).some((a) => a.rr_id === rr.id && a.version === rr.version);
  const rows = (att ?? []).map((a) => { const s = one(a.session as unknown as { starts_at: string | null; plan_month: string; status: string; venue: string | null; program: unknown } | null);
    return { ...a, s, pr: one(s?.program as unknown as { title: string; eval_method: string; duration_hours: number } | null), eff: one(a.effectiveness as unknown as { result: string | null } | null) }; });
  const signoff = rows.filter((r) => r.attended && r.pr?.eval_method === "signoff" && !r.acknowledged_at && r.s?.status === "done");
  const upcoming = rows.filter((r) => r.s && (r.s.status === "scheduled" || r.s.status === "planned")).sort((a, b) => (a.s!.starts_at ?? "z").localeCompare(b.s!.starts_at ?? "z"));
  const done = rows.filter((r) => r.s?.status === "done" && r.attended).sort((a, b) => (b.s!.starts_at ?? "").localeCompare(a.s!.starts_at ?? ""));
  const lvl = (c: string) => (comps ?? []).find((x) => x.competency_id === c)?.level ?? 0;
  const desig = one(me?.designation as unknown as { name: string } | null)?.name;

  return (
    <AppShell session={session} active="/me/development">
      <div className="pagehead"><div><h1>My skills &amp; training</h1><p>{desig ? `${desig} — ` : ""}what the role needs, what you can do, and your training.</p></div></div>

      {(rr && !acked) || signoff.length ? (
        <div className="card" style={{ borderTop: "3px solid var(--accent)" }}>
          <h2>Please read and sign</h2>
          {rr && !acked && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Your roles &amp; responsibilities (version {rr.version})</h3>
              {rr.purpose && <p><b>Purpose:</b> {rr.purpose}</p>}
              <b>Responsibilities</b><ul>{rr.responsibilities.map((x: string) => <li key={x}>{x}</li>)}</ul>
              {rr.authorities.length > 0 && <><b>Your authority</b><ul>{rr.authorities.map((x: string) => <li key={x}>{x}</li>)}</ul></>}
              {rr.deputy && <p><b>Your deputy:</b> {rr.deputy}</p>}
              <ActionForm action={ackRr} submitLabel="I have read and understood my roles & responsibilities" hidden={{ id: rr.id }} />
            </div>)}
          {signoff.map((r) => (
            <div key={r.id} style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>{r.pr?.title} <span className="muted" style={{ fontWeight: 400 }}>— {fmtDate(r.s?.starts_at ?? null)}</span></h3>
              {/policy/i.test(r.pr?.title ?? "") && st?.quality_policy && <p style={{ whiteSpace: "pre-line" }}>{st.quality_policy}</p>}
              {/policy/i.test(r.pr?.title ?? "") && (st?.objectives ?? []).length > 0 && <ul>{st!.objectives.map((o: string) => <li key={o}>{o}</li>)}</ul>}
              {/customer/i.test(r.pr?.title ?? "") && (st?.csr ?? []).length > 0 && <ul>{st!.csr.map((o: string) => <li key={o}>{o}</li>)}</ul>}
              <ActionForm action={ackAwareness} submitLabel="I attended and understood this" hidden={{ id: r.id }} />
            </div>))}
        </div>) : null}

      <div className="grid two">
        <div className="card">
          <h2>What my role needs</h2>
          {!(req ?? []).length ? <Empty>No competencies set for your role yet.</Empty> : (
            <table><tbody>{(req ?? []).map((r) => { const l = lvl(r.competency_id); return (
              <tr key={r.competency_id}><td>{one(r.competency as unknown as { name: string } | null)?.name}</td>
                <td className="num"><span className={`badge ${l >= r.required_level ? "ok" : "warn"}`} title={`${COMP_LEVELS[l]} — the role needs ${COMP_LEVELS[r.required_level]}`}>{l} of {r.required_level}</span></td></tr>); })}</tbody></table>)}
        </div>
        <div className="card">
          <h2>Operations I am qualified on</h2>
          {!(skills ?? []).length ? <Empty>None recorded yet.</Empty> : (
            <table><tbody>{(skills ?? []).map((s, i) => { const o = one(s.operation as unknown as { line: string; code: string; name: string } | null); const ex = s.level >= 3 && s.valid_until && s.valid_until < today; return (
              <tr key={i}><td><LevelPie level={s.level} expired={!!ex} /></td><td>{o?.code} {o?.name}<div className="muted" style={{ fontSize: 12 }}>{o?.line}</div></td>
                <td>{SKILL_LEVELS[s.level]?.label}{s.valid_until && s.level >= 3 && <div className={ex ? "bad" : "muted"} style={{ fontSize: 12 }}>{ex ? "re-certification due" : `valid to ${fmtDate(s.valid_until)}`}</div>}</td></tr>); })}</tbody></table>)}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Coming up</h2>
          {!upcoming.length && !(needs ?? []).length ? <Empty>No training planned for you.</Empty> : (<>
            {upcoming.map((r) => <p key={r.id} style={{ margin: "0 0 8px" }}><b>{r.pr?.title}</b><br /><span className="muted">{r.s?.starts_at ? fmtWhen(r.s.starts_at) : `in ${monthLabel(r.s?.plan_month)}`}{r.s?.venue ? ` · ${r.s.venue}` : ""}</span></p>)}
            {(needs ?? []).filter((n) => n.status === "open").map((n, i) => <p key={i} style={{ margin: "0 0 8px" }}>{n.topic} <span className="muted">— {NEED_STATUS[n.status]}{n.target_month ? `, by ${monthLabel(n.target_month)}` : ""}</span></p>)}
          </>)}
        </div>
        <div className="card">
          <h2>My training record</h2>
          {!done.length ? <Empty>No training recorded yet.</Empty> : (
            <table><tbody>{done.map((r) => (
              <tr key={r.id}><td>{fmtDate(r.s?.starts_at ?? null)}</td><td>{r.pr?.title}<div className="muted" style={{ fontSize: 12 }}>{r.pr?.duration_hours} h{r.post_score != null ? ` · test ${r.post_score}%` : ""}</div></td>
                <td>{r.eff?.result ? <span className={`badge ${r.eff.result === "effective" ? "ok" : "warn"}`}>{EFF_RESULTS[r.eff.result]}</span> : r.acknowledged_at ? <span className="badge ok">signed</span> : null}</td></tr>))}</tbody></table>)}
        </div>
      </div>

      {(kpis ?? []).length > 0 && (
        <div className="card">
          <h2>My KPIs</h2>
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>KPI</th><th className="num">Target</th>{[3, 2, 1].map((k) => <th key={k} className="num">{monthLabel(addMonths(today.slice(0, 7), -k))}</th>)}</tr></thead>
            <tbody>{(kpis ?? []).map((k) => (
              <tr key={k.id}><td>{k.name}</td><td className="num">{k.direction === "lower" ? "≤" : "≥"} {Number(k.target)} {k.unit}</td>
                {[3, 2, 1].map((n) => { const v = (vals ?? []).find((x) => x.kpi_id === k.id && x.month === addMonths(today.slice(0, 7), -n)); const a = v ? kpiAchievement(Number(k.target), Number(v.actual), k.direction) : null;
                  return <td key={n} className="num">{v ? <span className={`badge ${a! >= 95 ? "ok" : a! >= 80 ? "warn" : "danger"}`}>{Number(v.actual)}</span> : "—"}</td>; })}</tr>))}</tbody>
          </table></div>
        </div>)}
    </AppShell>
  );
}
