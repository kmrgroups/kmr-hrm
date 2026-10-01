import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { p } from "@/lib/base-path";
import { QmsTabs, Clause } from "../ui";
import { people, masters, personLabel } from "../data";

export const metadata = { title: "Audit pack" };

export default async function AuditPackPage() {
  const session = await requireRole(["hr_manager", "hr_executive"]);
  const db = await createClient();
  const [ppl, m] = await Promise.all([people(db), masters(db)]);
  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Audit pack <Clause>IATF 16949 7.2 / 7.3</Clause></h1>
        <p>One PDF for the auditor: for each person, roles &amp; responsibilities acknowledged, competence required vs assessed, skill-matrix qualifications,
          training with test scores and effectiveness, on-the-job training, auditor qualification and open needs — with the clause on every section.</p></div></div>
      <QmsTabs active="pack" />
      <div className="grid two">
        <div className="card">
          <h2>By department or designation</h2>
          <form method="get" action={p("/api/qms/audit-pack")} className="formgrid" target="_blank">
            <label className="field">Department<select name="dept" defaultValue=""><option value="">All</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="field">Designation<select name="desig" defaultValue=""><option value="">All</option>{m.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <div className="full"><button className="btn">Download the audit pack (PDF)</button></div>
          </form>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Auditors usually sample a line or a department: choose it here. Up to 200 people per pack.</p>
        </div>
        <div className="card">
          <h2>For chosen people</h2>
          <form method="get" action={p("/api/qms/audit-pack")} className="stack" target="_blank">
            <label className="field">People<select name="emp" multiple size={10} required>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select>
              <span className="help">Hold Ctrl (or Cmd) to choose several — e.g. the people the auditor met on the shop floor.</span></label>
            <div><button className="btn">Download (PDF)</button></div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
