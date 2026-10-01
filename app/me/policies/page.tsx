import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { DOC_KINDS } from "@/lib/compliance/rules";

export const metadata = { title: "Policies" };
const dmy = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

export default async function MyPolicies() {
  const session = await requireSession();
  if (!session.user.employee_id) redirect("/account");
  const db = await createClient();
  // row-level security: only documents open to this person, and only their approved revision
  const [{ data: docs }, { data: acks }] = await Promise.all([
    db.from("documents").select("id,doc_no,title,kind,needs_ack,employee_access,document_versions(id,revision,effective_from,status)").eq("employee_access", true).order("title"),
    db.from("document_acks").select("version_id,acknowledged_at").eq("employee_id", session.user.employee_id),
  ]);
  const acked = new Map((acks ?? []).map((a) => [a.version_id, a.acknowledged_at]));
  const list = (docs ?? []).map((d) => ({ ...d, cur: (d.document_versions as { id: string; revision: number; effective_from: string | null; status: string }[]).find((v) => v.status === "approved") }))
    .filter((d) => d.cur).map((d) => ({ ...d, pending: d.needs_ack && !acked.has(d.cur!.id) })).sort((a, b) => Number(b.pending) - Number(a.pending));
  const pending = list.filter((d) => d.pending).length;

  return (
    <AppShell session={session} active="/me/policies">
      <div className="pagehead"><div><h1>Policies</h1><p>The company&apos;s policies and procedures that apply to you.{pending ? ` ${pending} to read and acknowledge.` : ""}</p></div></div>
      <div className="card">
        {!list.length ? <Empty>Nothing yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table><tbody>{list.map((d) => (
            <tr key={d.id}><td><a href={p(`/me/policies/${d.id}`)}><b>{d.title}</b></a><div className="muted" style={{ fontSize: 12 }}>{d.doc_no} · {DOC_KINDS[d.kind]} · revision {d.cur!.revision} · effective {dmy(d.cur!.effective_from)}</div></td>
              <td style={{ textAlign: "right" }}>{d.pending ? <a className="btn small" href={p(`/me/policies/${d.id}`)}>Read and acknowledge</a> : d.needs_ack ? <span className="badge ok">Acknowledged {dmy(acked.get(d.cur!.id))}</span> : <a href={p(`/me/policies/${d.id}`)}>Read</a>}</td></tr>))}</tbody></table></div>)}
      </div>
    </AppShell>
  );
}
