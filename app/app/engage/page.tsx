import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday, addDays } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { questionResults, engagementIndex, suggestionStats, REC_CATEGORIES, SUG_STATUS, type Question } from "@/lib/engage/rules";
import { namesOf } from "@/lib/engage/data";
import { EngageTabs, Bar, inr, monthName } from "./ui";

export const metadata = { title: "Engagement" };

export default async function EngageHome() {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const db = await createClient();
  const today = istToday(), year = today.slice(0, 4), month = today.slice(0, 7);
  const [emps, sugg, recs, anns, reads, surveys] = await Promise.all([
    fetchAll<{ id: string }>((a, b) => db.from("employees").select("id").eq("status", "active").range(a, b)),
    fetchAll<{ id: string; ref: string; title: string; status: string; created_at: string; decided_at: string | null; saving_per_year: number | null; category: string; employee_id: string }>((a, b) =>
      db.from("suggestions").select("id,ref,title,status,created_at,decided_at,saving_per_year,category,employee_id").gte("created_at", `${year}-01-01`).range(a, b)),
    db.from("recognitions").select("id,employee_id,category,message,month,created_at").eq("visible", true).gte("created_at", addDays(today, -180)).order("created_at", { ascending: false }).limit(1000).then((r) => r.data ?? []),
    hr ? db.from("announcements").select("id,title,needs_ack,audience,department_id,plant_id,published_at").eq("status", "published").eq("needs_ack", true).then((r) => r.data ?? []) : Promise.resolve([]),
    hr ? fetchAll<{ announcement_id: string; acknowledged_at: string | null }>((a, b) => db.from("announcement_reads").select("announcement_id,acknowledged_at").range(a, b)) : Promise.resolve([]),
    hr ? db.from("surveys").select("id,title,status,closes_on,questions,audience").in("status", ["open", "closed"]).order("created_at", { ascending: false }).limit(5).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const head = emps.length;
  const st = suggestionStats(sugg, head);
  const recMonth = recs.filter((r) => r.created_at.slice(0, 7) === month);
  const recognised6 = new Set(recs.map((r) => r.employee_id)).size;
  const eom = recs.find((r) => r.category === "employee_of_month");

  // the latest survey's figures (HR)
  let sv: { id: string; title: string; status: string; n: number; part: number | null; index: number | null; enps: number | null } | null = null;
  // the newest survey with results (5+ answers); otherwise the newest one
  const cands = await Promise.all(surveys.map(async (s0) => {
    const [{ data: resp }, { count }] = await Promise.all([
      db.from("survey_responses").select("answers").eq("survey_id", s0.id).limit(5000),
      db.from("survey_participants").select("employee_id", { count: "exact", head: true }).eq("survey_id", s0.id),
    ]);
    const res = (resp?.length ?? 0) >= 5 ? questionResults(s0.questions as Question[], resp as { answers: Record<string, unknown> }[]) : [];
    return { id: s0.id, title: s0.title, status: s0.status, n: resp?.length ?? 0, part: head && s0.audience === "all" ? Math.round(((count ?? 0) / head) * 100) : null,
      index: engagementIndex(res), enps: res.find((r) => r.type === "enps")?.enps?.score ?? null };
  }));
  sv = cands.find((c) => c.n >= 5) ?? cands[0] ?? null;

  // what needs attention (fixed rules)
  const attention: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if (st.waitingOver7) attention.push({ text: `${st.waitingOver7} suggestion${st.waitingOver7 === 1 ? " has" : "s have"} waited more than 7 days for an answer`, href: "/app/engage/suggestions?s=waiting", tone: "danger" });
  for (const a of anns) {
    if (!a.published_at || (Date.now() - new Date(a.published_at).getTime()) / 864e5 < 3) continue;
    const acked = reads.filter((r) => r.announcement_id === a.id && r.acknowledged_at).length;
    const pct = head ? Math.round((acked / head) * 100) : 0;
    if (a.audience === "all" && pct < 80) attention.push({ text: `“${a.title}”: only ${pct}% have acknowledged it`, href: `/app/engage/announcements/${a.id}`, tone: "warn" });
  }
  for (const c of cands) if (c.status === "open" && c.part != null && c.part < 50) attention.push({ text: `Survey “${c.title}”: ${c.part}% have answered so far`, href: `/app/engage/surveys/${c.id}`, tone: "warn" });
  if (head && recognised6 / head < 0.3) attention.push({ text: `Only ${recognised6} of ${head} people were recognised in the last 6 months`, href: "/app/engage/recognition", tone: "warn" });

  const names = await namesOf(session.tenant.id, [...recs.slice(0, 6).map((r) => r.employee_id), eom?.employee_id, ...sugg.filter((x) => x.status === "implemented").map((x) => x.employee_id)]);
  const kaizen = sugg.filter((x) => x.status === "implemented").sort((a, b) => Number(b.saving_per_year ?? 0) - Number(a.saving_per_year ?? 0)).slice(0, 5);

  const Stat = ({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: string; href: string }) => (
    <a className="card stat" href={p(href)} style={{ textDecoration: "none", color: "inherit" }}><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</a>);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>Engagement</h1>
        <p>Announcements, recognition, suggestions and surveys — how people feel, what they suggest and who did good work. IATF 16949 7.3.2 (employee motivation and empowerment).</p></div></div>
      <EngageTabs active="home" hr={hr} />

      <div className="grid four" style={{ marginBottom: 16 }}>
        <Stat label={`Suggestions ${year}`} value={st.total} hint={`${st.per100 ?? 0} per 100 people · ${st.participation ?? 0}% of people gave one`} href="/app/engage/suggestions" />
        <Stat label="Implemented" value={st.implemented} hint={`${st.implementedPct ?? 0}% of ideas · saving ${inr(st.saving)} a year`} href="/app/engage/suggestions?s=implemented" />
        <Stat label="Recognitions this month" value={recMonth.length} hint={`${recognised6} people recognised in 6 months`} href="/app/engage/recognition" />
        {hr ? <Stat label={sv ? `Latest survey${sv.status === "open" ? " (open)" : ""}` : "Surveys"} value={sv?.index != null ? `${sv.index}%` : sv ? `${sv.n} answer${sv.n === 1 ? "" : "s"}` : "—"}
          hint={sv ? `${sv.index != null ? "favourable" : "results from 5 answers"}${sv.enps != null ? ` · eNPS ${sv.enps > 0 ? "+" : ""}${sv.enps}` : ""}${sv.part != null ? ` · ${sv.part}% answered` : ""}` : "No survey yet"} href={sv ? `/app/engage/surveys/${sv.id}` : "/app/engage/surveys"} />
          : <Stat label="Waiting for your answer" value={st.waiting} hint={st.waitingOver7 ? `${st.waitingOver7} over 7 days` : "suggestions from your team"} href="/app/engage/suggestions?s=waiting" />}
      </div>

      {attention.length > 0 && <div className="card"><h2>Needs attention</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{attention.map((a) => <li key={a.text} style={{ marginBottom: 4 }}><span className={`badge ${a.tone}`} style={{ marginRight: 6 }}>{a.tone === "danger" ? "Act" : "Check"}</span><a href={p(a.href)}>{a.text}</a></li>)}</ul></div>}

      <div className="grid two">
        <div className="card">
          <h2>Recognition wall</h2>
          {eom && <p style={{ marginTop: 0 }}><span className="badge ok">Employee of the month · {monthName(eom.month)}</span> <b>{names.get(eom.employee_id)?.name ?? "—"}</b> — {eom.message}</p>}
          {!recs.length ? <Empty>No recognition yet. A thank-you costs nothing.</Empty> :
            <ul style={{ margin: 0, paddingLeft: 18 }}>{recs.filter((r) => r.category !== "employee_of_month").slice(0, 6).map((r) => <li key={r.id} style={{ marginBottom: 4 }}>
              <b>{names.get(r.employee_id)?.name ?? "—"}</b> <span className="badge">{REC_CATEGORIES[r.category]}</span> {r.message}</li>)}</ul>}
          <p style={{ marginBottom: 0 }}><a href={p("/app/engage/recognition")}>Recognise someone ›</a></p>
        </div>
        <div className="card">
          <h2>Kaizen board — {year}</h2>
          {!kaizen.length ? <Empty>No suggestion implemented yet this year.</Empty> : (
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{kaizen.map((k) => (
              <tr key={k.id}><td><a href={p(`/app/engage/suggestions/${k.id}`)}>{k.title}</a><div className="muted" style={{ fontSize: 12 }}>{k.ref} · {names.get(k.employee_id)?.name ?? ""}</div></td>
                <td className="num">{k.saving_per_year ? inr(Number(k.saving_per_year)) : "—"}</td></tr>))}</tbody></table></div>)}
          <div style={{ marginTop: 8 }}>{Object.entries(SUG_STATUS).map(([k, v]) => { const n = sugg.filter((x) => x.status === k).length; return n ? <div key={k} style={{ fontSize: 13 }}><span style={{ display: "inline-block", width: 150 }}>{v}</span><Bar pct={(n / Math.max(1, sugg.length)) * 100} /> {n}</div> : null; })}</div>
        </div>
      </div>
    </AppShell>
  );
}
