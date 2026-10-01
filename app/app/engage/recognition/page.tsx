import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday, addDays } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { REC_CATEGORIES } from "@/lib/engage/rules";
import { colleagues } from "@/lib/engage/data";
import { EngageTabs, Bar, when, monthName } from "../ui";
import { giveRecognition, toggleRecognition } from "../actions";

export const metadata = { title: "Recognition" };

export default async function RecognitionPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { c } = await searchParams;
  const db = await createClient();
  const today = istToday();
  let q = db.from("recognitions").select("id,employee_id,category,message,month,given_by_name,kind,visible,sample,created_at").order("created_at", { ascending: false }).limit(300);
  if (c && REC_CATEGORIES[c]) q = q.eq("category", c);
  const [{ data: recs }, all, { data: team }] = await Promise.all([q, colleagues(session.tenant.id), db.from("employees").select("id").eq("status", "active")]);
  const names = new Map(all.map((x) => [x.id, x]));
  const mine = new Set((team ?? []).map((x) => x.id));
  const list = (recs ?? []).filter((r) => hr || r.visible);
  const eoms = list.filter((r) => r.category === "employee_of_month");
  const since = addDays(today, -90);
  const recent = list.filter((r) => r.created_at.slice(0, 10) >= since && r.visible);
  const byDept = new Map<string, number>();
  for (const r of recent) { const d = names.get(r.employee_id)?.department ?? "—"; byDept.set(d, (byDept.get(d) ?? 0) + 1); }
  const deptMax = Math.max(1, ...byDept.values());
  const options = all.filter((x) => x.id !== session.user.employee_id);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>Recognition</h1><p>Say well done where everybody can see it. Managers recognise their team, colleagues thank each other from their portal, HR names the Employee of the month. An implemented suggestion recognises its author automatically.</p></div></div>
      <EngageTabs active="rec" hr={hr} />

      <div className="grid two">
        <div className="card">
          <h2>Recognise someone</h2>
          <ActionForm action={giveRecognition} submitLabel="Put it on the wall" className="formgrid" resetOnSuccess>
            <label className="field full">Who<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>
              {options.map((x) => <option key={x.id} value={x.id}>{x.name}{x.code ? ` (${x.code})` : ""}{x.department ? ` — ${x.department}` : ""}{!hr && mine.has(x.id) ? " · my team" : ""}</option>)}</select></label>
            <label className="field">For<select name="category" required defaultValue="">
              <option value="" disabled>Choose…</option>{Object.entries(REC_CATEGORIES).filter(([k]) => hr || k !== "employee_of_month").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {hr ? <label className="field">Month <span className="help">for Employee of the month</span><input type="month" name="month" defaultValue={today.slice(0, 7)} /></label> : <div />}
            <label className="field full">What they did<textarea name="message" rows={3} required maxLength={1000} placeholder="e.g. Found the cracked fixture before the shift started and stopped a batch of rejections." /></label>
          </ActionForm>
        </div>
        <div className="card">
          <h2>Last 90 days by department</h2>
          {!byDept.size ? <Empty>No recognition in the last 90 days.</Empty> :
            [...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => <div key={d} style={{ fontSize: 14, marginBottom: 4 }}><span style={{ display: "inline-block", width: 200 }}>{d}</span><Bar pct={(n / deptMax) * 100} /> {n}</div>)}
          {eoms.length > 0 && <><h3 style={{ marginTop: 16 }}>Employee of the month</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{eoms.slice(0, 6).map((r) => <li key={r.id}>{monthName(r.month)}: <b>{names.get(r.employee_id)?.name ?? "—"}</b></li>)}</ul></>}
        </div>
      </div>

      <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>The wall</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><a className={`badge${!c ? " info" : ""}`} href={p("/app/engage/recognition")}>All</a>
            {Object.entries(REC_CATEGORIES).map(([k, v]) => <a key={k} className={`badge${c === k ? " info" : ""}`} href={p(`/app/engage/recognition?c=${k}`)}>{v}</a>)}</div></div>
        {!list.length ? <Empty>Nothing yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0, marginTop: 10 }}><table><tbody>{list.map((r) => { const n = names.get(r.employee_id); return (
            <tr key={r.id} style={{ opacity: r.visible ? 1 : 0.5 }}>
              <td style={{ width: 220 }}><b>{n?.name ?? "—"}</b><div className="muted" style={{ fontSize: 12 }}>{[n?.designation, n?.department].filter(Boolean).join(" · ")}</div></td>
              <td><span className={`badge${r.category === "employee_of_month" ? " ok" : ""}`}>{REC_CATEGORIES[r.category]}{r.month ? ` · ${monthName(r.month)}` : ""}</span> {r.message}
                <div className="muted" style={{ fontSize: 12 }}>{r.kind === "auto" ? "Automatic — suggestion implemented" : r.kind === "peer" ? `Thanks from ${r.given_by_name ?? "a colleague"}` : `From ${r.given_by_name ?? "—"}`} · {when(r.created_at)}{r.sample ? " · Sample" : ""}{!r.visible ? " · hidden" : ""}</div></td>
              {hr && <td style={{ textAlign: "right" }}><ActionForm action={toggleRecognition} submitLabel={r.visible ? "Hide" : "Show"} variant="secondary" className="inline" hidden={{ id: r.id }} /></td>}
            </tr>); })}</tbody></table></div>)}
      </div>
    </AppShell>
  );
}
