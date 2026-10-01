import { getTenant } from "@/lib/tenant";
import { PublicFrame } from "@/components/PublicFrame";
import { interviewByToken } from "@/lib/recruit/links";
import { fmtWhen, modeLabel } from "@/lib/recruit/format";
import { InterviewReply } from "./InterviewReply";

export const metadata = { title: "Your interview" };
export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function InterviewLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await interviewByToken(token);
  if (!found) return <PublicFrame tenant={await getTenant()}><div className="card"><h1>Link not valid</h1><p>Please use the latest message from the company, or contact them.</p></div></PublicFrame>;
  const { iv, tenant } = found;
  const a = one(iv.application as unknown as { candidate: { full_name: string }; requisition: { title: string } });
  const past = new Date(iv.starts_at).getTime() < Date.now();
  return (
    <PublicFrame tenant={tenant}>
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Your interview</h1>
        <p style={{ margin: 0 }}>Dear {one(a?.candidate)?.full_name}, here are the details of your interview for <b>{one(a?.requisition)?.title}</b> at {tenant.name}.</p>
        <dl className="kv">
          <dt>When</dt><dd><b>{fmtWhen(iv.starts_at)}</b> ({iv.duration_min} minutes)</dd>
          <dt>Round</dt><dd>{iv.round} — {iv.title}</dd>
          <dt>How</dt><dd>{modeLabel(iv.mode)}</dd>
          {iv.mode === "in_person" && <><dt>Venue</dt><dd>{iv.venue} {iv.venue ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(iv.venue)}`} target="_blank" rel="noreferrer">(map)</a> : null}</dd></>}
          {iv.mode === "video" && <><dt>Join</dt><dd><a href={iv.video_link} target="_blank" rel="noreferrer">{iv.video_link}</a></dd></>}
          {iv.bring && <><dt>Please bring</dt><dd>{iv.bring}</dd></>}
        </dl>
        {iv.status === "cancelled" ? <div className="alert error">This interview has been cancelled. The company will contact you.</div>
          : past || iv.status === "done" ? <div className="alert ok">This interview has taken place. Thank you.</div>
          : <InterviewReply token={token} status={iv.status} />}
      </div>
    </PublicFrame>
  );
}
