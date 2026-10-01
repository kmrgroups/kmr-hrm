import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate } from "@/components/ui";
import { p } from "@/lib/base-path";
import { lakh } from "@/lib/recruit/format";
import { createRequisition } from "../actions";
import { RecruitTabs, ReqStatus, SampleTag } from "../ui";
import { RequisitionFields } from "../forms";
import { masters } from "../data";

export const metadata = { title: "Requisitions" };
export const maxDuration = 60;

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, ["hr_manager", "hr_executive"]);
  const { s } = await searchParams;
  const db = await createClient();
  const m = await masters(db);
  let q = db.from("requisitions").select("id,ref_no,title,sample,status,published,headcount,ctc_min,ctc_max,exp_min,exp_max,required_by,raised_by_name,created_at,department:departments(name)").order("created_at", { ascending: false }).limit(300);
  if (s === "active") q = q.in("status", ["pending", "approved", "open", "on_hold"]);
  const [{ data: reqs }, { data: counts }] = await Promise.all([q, db.from("applications").select("requisition_id")]);
  const n = (id: string) => (counts ?? []).filter((c) => c.requisition_id === id).length;
  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>Requisitions</h1><p>{hr ? "Every opening, from request to closing." : "Ask HR for people: raise a requisition and follow it here."}</p></div></div>
      <RecruitTabs active="reqs" hr={hr} />
      <div className="card">
        <h2>All requisitions <span className="toolbar" style={{ margin: 0 }}><a className={`btn small${s === "active" ? "" : " secondary"}`} href={p("/app/recruitment/requisitions?s=active")}>Active</a><a className={`btn small${s === "active" ? " secondary" : ""}`} href={p("/app/recruitment/requisitions")}>All</a></span></h2>
        {!reqs?.length ? <Empty>No requisitions yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Role</th><th>Department</th><th className="num">Posts</th><th>Experience</th><th>Salary</th><th className="num">Candidates</th><th>Status</th><th>Raised</th></tr></thead>
            <tbody>{reqs.map((r) => <tr key={r.id}>
              <td><a href={p(`/app/recruitment/requisitions/${r.id}`)}><b>{r.title}</b></a><SampleTag on={r.sample} /><div className="muted mono" style={{ fontSize: 12 }}>{r.ref_no}</div></td>
              <td>{(Array.isArray(r.department) ? r.department[0] : r.department as { name: string } | null)?.name ?? "—"}</td>
              <td className="num">{r.headcount}</td>
              <td>{r.exp_min ?? "?"}–{r.exp_max ?? "?"} y</td>
              <td>{r.ctc_max ? `${lakh(r.ctc_min)} – ${lakh(r.ctc_max)}` : "—"}</td>
              <td className="num">{n(r.id)}</td>
              <td><ReqStatus status={r.status} published={r.published} /></td>
              <td>{fmtDate(r.created_at)}<div className="muted" style={{ fontSize: 12 }}>{r.raised_by_name}</div></td>
            </tr>)}</tbody>
          </table></div>)}
      </div>
      <div className="card" id="new">
        <h2>New requisition</h2>
        <p className="muted">{hr ? "HR requisitions are approved straight away; a job description is drafted for you to check." : "HR will review and approve it, then write the job description and start hiring."}</p>
        <ActionForm action={createRequisition} submitLabel={hr ? "Create requisition" : "Send to HR"} className="formgrid">
          <RequisitionFields desigs={m.desigs} depts={m.depts} plants={m.plants} titles={m.titles} roles={m.roles} comps={m.comps} />
        </ActionForm>
      </div>
    </AppShell>
  );
}
