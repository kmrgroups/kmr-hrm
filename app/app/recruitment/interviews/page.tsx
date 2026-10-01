import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { fmtWhen, modeLabel } from "@/lib/recruit/format";
import { RecruitTabs } from "../ui";

export const metadata = { title: "Interviews" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const STATUS: Record<string, [string, string]> = { scheduled: ["Scheduled", "info"], confirmed: ["Candidate confirmed", "ok"], reschedule_requested: ["Asked for another time", "warn"], done: ["Held", "ok"], cancelled: ["Cancelled", "danger"], no_show: ["Did not come", "warn"] };

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<{ past?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager", "interviewer"]);
  const hr = hasRole(session.user, ["hr_manager", "hr_executive"]);
  const { past } = await searchParams;
  const db = await createClient();
  const since = new Date(Date.now() - 6 * 36e5).toISOString();
  let q = db.from("interviews").select("id,starts_at,mode,round,title,status,venue,video_link,panel,panel_names,application:applications(id,candidate:candidates(full_name),requisition:requisitions(title)),feedback:interview_feedback(panelist_id)");
  q = past ? q.lt("starts_at", since).order("starts_at", { ascending: false }).limit(200) : q.gte("starts_at", since).order("starts_at").limit(200);
  if (!hr) q = q.contains("panel", [session.user.id]);
  const { data: ivs } = await q;
  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>{hr ? "Interviews" : "My interviews"}</h1><p>{hr ? "Every scheduled interview and its scorecards." : "Interviews you sit on. After each one, fill in your scorecard."}</p></div></div>
      <RecruitTabs active="interviews" hr={hr} />
      <div className="toolbar"><a className={`btn small${past ? " secondary" : ""}`} href={p("/app/recruitment/interviews")}>Coming up</a><a className={`btn small${past ? "" : " secondary"}`} href={p("/app/recruitment/interviews?past=1")}>Past</a></div>
      <div className="card">
        {!ivs?.length ? <Empty>{past ? "No past interviews." : "No interviews coming up."}</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>When</th><th>Candidate</th><th>Round</th><th>Where</th><th>Status</th><th>Scorecards</th><th></th></tr></thead>
            <tbody>{ivs.map((i) => { const a = one(i.application as unknown as { id: string; candidate: { full_name: string }; requisition: { title: string } });
              const fb = (i.feedback as { panelist_id: string }[]) ?? [], mine = fb.some((f) => f.panelist_id === session.user.id), onPanel = (i.panel as string[]).includes(session.user.id);
              const [label, tone] = STATUS[i.status] ?? [i.status, ""];
              return <tr key={i.id}><td>{fmtWhen(i.starts_at)}</td><td><b>{one(a?.candidate)?.full_name}</b><div className="muted" style={{ fontSize: 12 }}>{one(a?.requisition)?.title}</div></td>
                <td>{i.round}. {i.title}<div className="muted" style={{ fontSize: 12 }}>{(i.panel_names as string[]).join(", ")}</div></td>
                <td>{modeLabel(i.mode)}<div className="muted" style={{ fontSize: 12 }}>{i.mode === "video" ? <a href={i.video_link ?? "#"} target="_blank" rel="noreferrer">Join link</a> : i.venue}</div></td>
                <td><span className={`badge ${tone}`}>{label}</span></td><td>{fb.length} of {(i.panel as string[]).length}</td>
                <td style={{ textAlign: "right" }}><a className={`btn small${onPanel && !mine && i.status !== "cancelled" ? "" : " secondary"}`} href={p(`/app/recruitment/interviews/${i.id}`)}>{onPanel && !mine ? "Fill in scorecard" : "Open"}</a></td></tr>; })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
