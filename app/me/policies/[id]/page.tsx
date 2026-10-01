import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { p } from "@/lib/base-path";
import { DOC_KINDS } from "@/lib/compliance/rules";
import { acknowledgePolicy } from "../actions";

export const metadata = { title: "Policy" };
const dmy = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

export default async function MyPolicy({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.user.employee_id) redirect("/account");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: d } = await db.from("documents").select("id,doc_no,title,kind,needs_ack,owner_name").eq("id", id).maybeSingle();
  if (!d) notFound();
  const { data: v } = await db.from("document_versions").select("id,revision,body,file_path,file_name,effective_from,approved_by_name,change_note").eq("document_id", id).eq("status", "approved").maybeSingle();
  if (!v) notFound();
  const { data: ack } = await db.from("document_acks").select("acknowledged_at").eq("version_id", v.id).eq("employee_id", session.user.employee_id).maybeSingle();

  return (
    <AppShell session={session} active="/me/policies">
      <div className="pagehead"><div><h1>{d.title}</h1><p>{d.doc_no} · {DOC_KINDS[d.kind]} · revision {v.revision} · effective {dmy(v.effective_from)} · approved by {v.approved_by_name ?? "—"}</p></div>
        <a className="btn secondary" href={p("/me/policies")}>All policies</a></div>
      <div className="card">
        {v.change_note && v.revision > 0 && <div className="alert info" style={{ marginBottom: 12 }}>What changed in this revision: {v.change_note}</div>}
        {v.body && <div style={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>{v.body}</div>}
        {v.file_path && <p><a href={p(`/api/compliance/file?version=${v.id}`)} target="_blank" rel="noreferrer">📄 {v.file_name ?? "Open the PDF"}</a></p>}
        {d.needs_ack && <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 12 }}>
          {ack ? <span className="badge ok">You acknowledged this revision on {dmy(ack.acknowledged_at)}</span>
            : <ActionForm action={acknowledgePolicy} submitLabel="I have read and understood this policy" variant="accent" hidden={{ version_id: v.id }} />}
        </div>}
      </div>
    </AppShell>
  );
}
