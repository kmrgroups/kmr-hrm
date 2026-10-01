import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday, addDays } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { KINDS, STATUS, daysSinceLti, ltifr, pyramid, severityRate, ppeFor, dueState, type PpeItem, type PpeIssue } from "@/lib/safety/rules";
import { people } from "@/app/app/qms/data";
import { Bar } from "@/app/app/engage/ui";
import { SafetyTabs, dmy, KIND_TONE } from "./ui";
import { saveSafetySettings } from "./actions";

export const metadata = { title: "Safety" };

export default async function SafetyHome() {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const db = await createClient();
  const today = istToday(), from = addDays(today, -365);
  const [incs, { data: acts }, { data: items }, issues, ppl, { data: med }, { data: st }, { data: mh }] = await Promise.all([
    fetchAll<{ id: string; ref: string; kind: string; status: string; occurred_at: string; area: string | null; days_lost: number; created_at: string }>((a, b) =>
      db.from("incidents").select("id,ref,kind,status,occurred_at,area,days_lost,created_at").gte("occurred_at", `${addDays(today, -730)}T00:00:00+05:30`).order("occurred_at", { ascending: false }).range(a, b)),
    db.from("incident_actions").select("id,action,due_on,status,owner_name,incident_id").eq("status", "open"),
    db.from("ppe_items").select("id,name,life_months,departments,for_all,active"),
    fetchAll<PpeIssue>((a, b) => db.from("ppe_issues").select("employee_id,item_id,issued_on,next_due").range(a, b)),
    people(db),
    hr ? db.from("medical_checks").select("employee_id,next_due").then((r) => r) : Promise.resolve({ data: [] as { employee_id: string; next_due: string | null }[] }),
    db.from("safety_settings").select("*").maybeSingle(),
    db.rpc("man_hours", { p_from: from, p_to: today }),
  ]);
  const year = incs.filter((i) => i.occurred_at.slice(0, 10) >= from);
  const manHours = Number(mh ?? 0);
  const lti = year.filter((i) => i.kind === "lost_time"), daysLost = year.reduce((s, i) => s + (i.days_lost ?? 0), 0);
  const fr = ltifr(lti.length, manHours), sr = severityRate(daysLost, manHours), since = daysSinceLti(incs, today);
  const pyr = pyramid(year);
  const late = (acts ?? []).filter((a) => a.due_on < today);
  const unseen = incs.filter((i) => i.status === "reported");
  let ppeOver = 0, ppeNever = 0;
  const ppeShort = new Set<string>();
  for (const e of ppl) for (const x of ppeFor(e, (items ?? []) as PpeItem[], issues, today)) { if (x.state === "overdue") { ppeOver++; ppeShort.add(e.id); } if (x.state === "never") { ppeNever++; ppeShort.add(e.id); } }
  const lastMed = new Map<string, string | null>();
  for (const m of (med ?? []) as { employee_id: string; next_due: string | null }[]) { const c = lastMed.get(m.employee_id); if (!c || (m.next_due ?? "") > c) lastMed.set(m.employee_id, m.next_due); }
  const medDue = [...lastMed.values()].filter((d) => ["overdue", "due_soon"].includes(dueState(d, today))).length;
  const pyrMax = Math.max(1, pyr.nearMiss + pyr.unsafe, pyr.firstAid, pyr.injury, pyr.lti);

  const Stat = ({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href: string; tone?: string }) => (
    <a className="card stat" href={p(href)} style={{ textDecoration: "none", color: "inherit", borderTop: tone ? `3px solid var(--${tone})` : undefined }}><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</a>);

  return (
    <AppShell session={session} active="/app/safety">
      <div className="pagehead"><div><h1>Safety</h1><p>Incidents and near misses, their causes and actions; PPE; medical examination dates. ISO 45001 9.1, 10.2.</p></div>
        <a className="btn" href={p("/app/safety/incidents#report")}>Report an incident</a></div>
      <SafetyTabs active="home" hr={hr} />

      <div className="grid four" style={{ marginBottom: 16 }}>
        <Stat label="Days without a lost-time injury" value={since ?? "—"} hint={since == null ? "none on record" : `last: ${dmy(incs.find((i) => i.kind === "lost_time")!.occurred_at)}`} href="/app/safety/incidents" tone={since != null && since < 30 ? "danger" : "ok"} />
        <Stat label="LTIFR (12 months)" value={fr ?? "—"} hint={`${lti.length} LTI per ${manHours ? `${Math.round(manHours).toLocaleString("en-IN")} man-hours` : "— no attendance hours yet"} · per million hours${st?.ltifr_target != null ? ` · target ${st.ltifr_target}` : ""}`} href="/app/safety/incidents" />
        <Stat label="Severity rate (12 months)" value={sr ?? "—"} hint={`${daysLost} man-days lost · per million hours`} href="/app/safety/incidents" />
        <Stat label="Actions overdue" value={late.length} hint={`${(acts ?? []).length} open · ${unseen.length} report${unseen.length === 1 ? "" : "s"} not looked at`} href="/app/safety/incidents" tone={late.length || unseen.length ? "danger" : undefined} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Last 12 months</h2>
          {[["Near misses & unsafe acts / conditions", pyr.nearMiss + pyr.unsafe, "info"], ["First aid", pyr.firstAid, "warn"], ["Injuries (medical treatment)", pyr.injury, "danger"], ["Lost-time injuries", pyr.lti, "danger"]].map(([l, n, t]) =>
            <div key={l as string} style={{ fontSize: 14, marginBottom: 6 }}><span style={{ display: "inline-block", width: 260 }}>{l}</span><Bar pct={((n as number) / pyrMax) * 100} tone={t === "info" ? "brand" : (t as "warn" | "danger")} /> <b>{n}</b></div>)}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{pyr.ratio != null ? `${pyr.ratio} near misses / unsafe reports for every injury.` : "No injuries in 12 months."} More reports of near misses means problems are found before someone is hurt — encourage them.</p>
        </div>
        <div className="card">
          <h2>To do</h2>
          {!late.length && !unseen.length && !ppeShort.size && !medDue ? <Empty>Nothing pending.</Empty> : <ul style={{ margin: 0, paddingLeft: 18 }}>
            {unseen.map((i) => <li key={i.id}><span className={`badge ${KIND_TONE[i.kind]}`}>{KINDS[i.kind]}</span> <a href={p(`/app/safety/incidents/${i.id}`)}>{i.ref}</a> at {i.area ?? "—"} — reported {dmy(i.occurred_at)}, not looked at yet</li>)}
            {late.slice(0, 10).map((a) => <li key={a.id}><span className="badge danger">Action overdue</span> <a href={p(`/app/safety/incidents/${a.incident_id}`)}>{a.action}</a> — due {dmy(a.due_on)}{a.owner_name ? ` · ${a.owner_name}` : ""}</li>)}
            {ppeShort.size > 0 && <li><span className="badge warn">PPE</span> <a href={p("/app/safety/ppe")}>{ppeShort.size} people without PPE they need</a> ({ppeOver} overdue for replacement, {ppeNever} never issued)</li>}
            {medDue > 0 && <li><span className="badge warn">Medical</span> <a href={p("/app/safety/medical")}>{medDue} periodic examination{medDue === 1 ? "" : "s"} due within 30 days or overdue</a></li>}
          </ul>}
        </div>
      </div>

      <div className="card">
        <h2>Latest</h2>
        {!incs.length ? <Empty>Nothing recorded yet.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table><tbody>{incs.slice(0, 8).map((i) => (
          <tr key={i.id}><td className="mono"><a href={p(`/app/safety/incidents/${i.id}`)}>{i.ref}</a></td><td><span className={`badge ${KIND_TONE[i.kind]}`}>{KINDS[i.kind]}</span></td><td>{i.area ?? "—"}</td><td>{dmy(i.occurred_at)}</td><td>{STATUS[i.status]}</td></tr>))}</tbody></table></div>}
      </div>

      {hr && <div className="card">
        <h2>Settings</h2>
        <ActionForm action={saveSafetySettings} submitLabel="Save" className="formgrid">
          <label className="field">Safety officer<input name="officer_name" maxLength={120} defaultValue={st?.officer_name ?? ""} /></label>
          <label className="field">Safety officer&apos;s e-mail <span className="help">new reports and the daily list go here (blank: HR managers)</span><input type="email" name="officer_email" maxLength={200} defaultValue={st?.officer_email ?? ""} /></label>
          <label className="field">Hours a working day <span className="help">for man-hours when attendance has no worked time</span><input name="hours_per_day" inputMode="decimal" defaultValue={st?.hours_per_day ?? 8} /></label>
          <label className="field">LTIFR target<input name="ltifr_target" inputMode="decimal" defaultValue={st?.ltifr_target ?? ""} /></label>
        </ActionForm>
      </div>}
    </AppShell>
  );
}
