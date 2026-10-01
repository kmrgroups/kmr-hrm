import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { aiConfigured } from "@/lib/ai/gateway";
import { p } from "@/lib/base-path";
import { addDaysIso, DOC_KINDS } from "@/lib/compliance/rules";
import { masters } from "@/app/app/qms/data";
import { CompTabs, dmy } from "../ui";
import { DocFields } from "./fields";
import { createDocument } from "../actions";

export const metadata = { title: "Documents & policies" };
export const maxDuration = 60;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ k?: string; w?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { k, w } = await searchParams;
  const db = await createClient();
  const today = istToday();
  let q = db.from("documents").select("id,doc_no,title,kind,owner_name,needs_ack,employee_access,active,sample,document_versions(revision,status,effective_from,review_due,ai_model)").order("doc_no");
  if (k && DOC_KINDS[k]) q = q.eq("kind", k);
  q = q.eq("active", w !== "1");
  const [{ data: docs }, m, { data: st }] = await Promise.all([q, masters(db), db.from("qms_settings").select("ai_enabled").maybeSingle()]);
  const ai = aiConfigured() && st?.ai_enabled !== false;

  return (
    <AppShell session={session} active="/app/compliance">
      <div className="pagehead"><div><h1>Documents &amp; policies</h1><p>HR policies, procedures, formats and work instructions under control: number, revision, prepared and approved by, effective date and review date. A new revision makes the old one obsolete. Policies ask each person to read and acknowledge them.</p></div>
        <a className="btn secondary" href={p("/api/compliance/master-list")}>Master list (PDF)</a></div>
      <CompTabs active="docs" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <a className={`badge${!k && w !== "1" ? " info" : ""}`} href={p("/app/compliance/documents")}>All in use</a>
        {Object.entries(DOC_KINDS).map(([x, l]) => <a key={x} className={`badge${k === x ? " info" : ""}`} href={p(`/app/compliance/documents?k=${x}`)}>{l}</a>)}
        <a className={`badge${w === "1" ? " info" : ""}`} href={p("/app/compliance/documents?w=1")}>Withdrawn</a>
      </div>
      <div className="card">
        {!docs?.length ? <Empty>No documents here yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Doc. no.</th><th>Title</th><th>Type</th><th>Current revision</th><th>Review due</th><th>Status</th></tr></thead>
            <tbody>{docs.map((d) => { const vs = (d.document_versions ?? []) as { revision: number; status: string; effective_from: string | null; review_due: string | null; ai_model: string | null }[];
              const cur = vs.find((v) => v.status === "approved"), dr = vs.find((v) => v.status === "draft"); const late = cur?.review_due && cur.review_due < today; return (
              <tr key={d.id}><td className="mono"><a href={p(`/app/compliance/documents/${d.id}`)}>{d.doc_no}</a></td>
                <td><a href={p(`/app/compliance/documents/${d.id}`)}><b>{d.title}</b></a>{d.needs_ack && <span className="badge warn" style={{ marginLeft: 6, fontSize: 11 }}>Acknowledge</span>}{d.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}
                  <div className="muted" style={{ fontSize: 12 }}>{d.owner_name ?? ""}{d.employee_access ? " · in the employee portal" : ""}</div></td>
                <td>{DOC_KINDS[d.kind]}</td>
                <td>{cur ? `Rev ${cur.revision} · ${dmy(cur.effective_from)}` : "—"}</td>
                <td>{cur?.review_due ? <span className={late ? "badge danger" : cur.review_due <= addDaysIso(today, 30) ? "badge warn" : ""}>{dmy(cur.review_due)}</span> : "—"}</td>
                <td>{cur ? <span className="badge ok">Approved</span> : <span className="badge warn">Not issued</span>}{dr && <div><span className="badge" style={{ fontSize: 11 }}>Rev {dr.revision} draft{dr.ai_model ? " (AI)" : ""}</span></div>}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>
      <div className="grid two">
        <div className="card">
          <h2>New document</h2>
          <ActionForm action={createDocument} submitLabel="Create (draft revision 0)" className="formgrid">
            <DocFields m={m} />
          </ActionForm>
        </div>
        <div className="card">
          <h2>Let the AI write the first draft</h2>
          {!ai ? <p className="muted" style={{ margin: 0 }}>Set up the free AI in QMS › AI &amp; review to have policies and procedures drafted from your points.</p> : <>
            <p className="muted" style={{ marginTop: 0 }}>Give the title and your points; the free AI writes a draft with Purpose, Scope, Policy / Procedure, Responsibilities. It adds no laws, figures or names of its own — it writes [to be filled]. You correct it; a named person approves it.</p>
            <ActionForm action={createDocument} submitLabel="Draft it with AI" pendingLabel="Writing…" className="formgrid" hidden={{ ai: "1" }}>
              <label className="field full">Your points<textarea name="points" rows={6} placeholder={"e.g. Mobile phones not allowed on the shop floor\nLockers at the gate\nSupervisors may carry phones for work\nEmergency calls through the security desk"} /></label>
              <DocFields m={m} />
            </ActionForm></>}
        </div>
      </div>
    </AppShell>
  );
}
