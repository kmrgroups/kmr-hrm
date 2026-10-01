import { redirect } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { fmtWhen, modeLabel } from "@/lib/recruit/format";
import { RecruitTabs, ReqStatus, ScoreBar, RecoBadge } from "./ui";

export const metadata = { title: "Recruitment" };

export default async function RecruitmentHome() {
  const session = await requireRole([...HR_ROLES, "manager", "interviewer"]);
  if (!hasRole(session.user, ["hr_manager", "hr_executive"])) redirect(hasRole(session.user, ["manager"]) ? "/app/recruitment/requisitions" : "/app/recruitment/interviews");
  const db = await createClient();
  const now = new Date().toISOString();
  const [{ data: reqs }, { data: apps }, { data: ivs }, { data: offers }] = await Promise.all([
    db.from("requisitions").select("id,ref_no,title,status,published,headcount,required_by").in("status", ["pending", "approved", "open", "on_hold"]).order("created_at", { ascending: false }),
    db.from("applications").select("id,status,score,recommendation,requisition_id,created_at,candidate:candidates(full_name)").order("created_at", { ascending: false }).limit(1000),
    db.from("interviews").select("id,starts_at,mode,round,title,status,application:applications(id,candidate:candidates(full_name),requisition:requisitions(title))").gte("starts_at", now).in("status", ["scheduled", "confirmed", "reschedule_requested"]).order("starts_at").limit(10),
    db.from("offers").select("id,status,ref_no,valid_until,application_id").in("status", ["draft", "sent"]),
  ]);
  const count = (s: string[]) => (apps ?? []).filter((a) => s.includes(a.status)).length;
  const fresh = (apps ?? []).filter((a) => a.status === "new").sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 8);
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>Recruitment</h1><p>From requisition to offer: the system writes the JD, reads and scores every resume, schedules interviews and sends the offer — free.</p></div>
        <a className="btn" href={p("/app/recruitment/requisitions#new")}>New requisition</a></div>
      <RecruitTabs active="home" />
      <div className="card">
        <h2>Pipeline</h2>
        <div className="funnel">
          {([["Open roles", (reqs ?? []).filter((r) => r.status === "open").length], ["New resumes", count(["new"])], ["Shortlisted", count(["shortlisted", "interview"])],
            ["Selected", count(["selected"])], ["Offers out", (offers ?? []).filter((o) => o.status === "sent").length], ["Accepted", count(["joined"])]] as [string, number][]).map(([l, n]) =>
            <div key={l}><b>{n}</b><span>{l}</span></div>)}
        </div>
      </div>
      <div className="grid two">
        <div className="card">
          <h2>Active requisitions <a className="btn secondary small" href={p("/app/recruitment/requisitions")}>All</a></h2>
          {!reqs?.length ? <Empty>No active requisitions. Raise one to start.</Empty> : (
            <ul className="timeline">{reqs.map((r) => {
              const n = (apps ?? []).filter((a) => a.requisition_id === r.id).length;
              return <li key={r.id}><span><a href={p(`/app/recruitment/requisitions/${r.id}`)}><b>{r.title}</b></a> <span className="muted">{r.ref_no} · {r.headcount} post{r.headcount > 1 ? "s" : ""} · {n} candidate{n === 1 ? "" : "s"}</span></span><ReqStatus status={r.status} published={r.published} /></li>;
            })}</ul>)}
        </div>
        <div className="card">
          <h2>Next interviews <a className="btn secondary small" href={p("/app/recruitment/interviews")}>All</a></h2>
          {!ivs?.length ? <Empty>No interviews scheduled.</Empty> : (
            <ul className="timeline">{ivs.map((i) => {
              const a = one(i.application as unknown as { id: string; candidate: { full_name: string } | { full_name: string }[]; requisition: { title: string } | { title: string }[] });
              return <li key={i.id}><span><a href={p(`/app/recruitment/candidates/${a?.id}`)}><b>{one(a?.candidate)?.full_name}</b></a> <span className="muted">{one(a?.requisition)?.title} · round {i.round} · {modeLabel(i.mode)}</span></span>
                <span>{fmtWhen(i.starts_at)}{i.status === "reschedule_requested" ? <span className="badge warn" style={{ marginLeft: 6 }}>wants another time</span> : i.status === "confirmed" ? <span className="badge ok" style={{ marginLeft: 6 }}>confirmed</span> : null}</span></li>;
            })}</ul>)}
        </div>
      </div>
      <div className="card">
        <h2>New resumes to review</h2>
        {!fresh.length ? <Empty>Nothing waiting — every resume has a decision.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Candidate</th><th>Score</th><th>Recommendation</th><th></th></tr></thead>
            <tbody>{fresh.map((a) => <tr key={a.id}><td><b>{one(a.candidate as unknown as { full_name: string })?.full_name}</b></td><td><ScoreBar score={a.score} /></td><td><RecoBadge reco={a.recommendation} /></td>
              <td style={{ textAlign: "right" }}><a className="btn secondary small" href={p(`/app/recruitment/candidates/${a.id}`)}>Review</a></td></tr>)}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
