import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { AUDITOR_KINDS, CORE_TOOLS, STANDARDS, addDaysIso, auditorStatus } from "@/lib/qms/rules";
import { QmsTabs, Clause } from "../ui";
import { people, personLabel } from "../data";
import { addAudit, saveAuditor } from "../actions";

export const metadata = { title: "Internal auditors" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function AuditorsPage() {
  const session = await requireRole(["hr_manager", "hr_executive"]);
  const today = istToday();
  const db = await createClient();
  const [ppl, { data: list }, { data: audits }] = await Promise.all([
    people(db),
    db.from("auditors").select("*,employee:employees(first_name,last_name,employee_code)").order("active", { ascending: false }).order("valid_until"),
    db.from("auditor_audits").select("id,auditor_id,audit_date,area,audit_type,role,findings").order("audit_date", { ascending: false }).limit(500),
  ]);
  const last12 = (id: string) => (audits ?? []).filter((a) => a.auditor_id === id && a.audit_date >= addDaysIso(today, -365)).length;
  type A = NonNullable<typeof list>[number];
  const Fields = ({ a }: { a?: A }) => (<>
    {!a && <label className="field full">Employee<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>}
    {a && <input type="hidden" name="employee_id" value={a.employee_id} />}
    <label className="field">Auditor for<select name="kind" defaultValue={a?.kind ?? "qms"}>{Object.entries(AUDITOR_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Audits a year to stay qualified<input name="audits_per_year" inputMode="numeric" defaultValue={a?.audits_per_year ?? 2} /></label>
    <label className="field full">Qualification<input name="qualification" maxLength={200} defaultValue={a?.qualification ?? ""} placeholder="IATF 16949 internal auditor (2 days, external body)" /></label>
    <label className="field">Trained on<input type="date" name="trained_on" defaultValue={a?.trained_on ?? ""} /></label>
    <label className="field">Valid until<input type="date" name="valid_until" defaultValue={a?.valid_until ?? ""} /></label>
    <label className="field">Certificate no.<input name="certificate_no" maxLength={60} defaultValue={a?.certificate_no ?? ""} /></label>
    <fieldset className="field full chips"><legend>Standards</legend>{STANDARDS.map((s) => <label key={s} className="check"><input type="checkbox" name="standards" value={s} defaultChecked={a?.standards?.includes(s)} /> {s}</label>)}</fieldset>
    <fieldset className="field full chips"><legend>Core tools understood</legend>{CORE_TOOLS.map((s) => <label key={s} className="check"><input type="checkbox" name="core_tools" value={s} defaultChecked={a?.core_tools?.includes(s)} /> {s}</label>)}</fieldset>
    <label className="field full check"><input type="checkbox" name="csr_trained" defaultChecked={a?.csr_trained} /> Trained on the customer-specific requirements</label>
  </>);

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>Internal auditors <Clause>IATF 7.2.3</Clause></h1>
        <p>Who may audit what, their qualification, core-tools knowledge and the audits they did — with a warning before a qualification lapses.</p></div></div>
      <QmsTabs active="auditors" />

      <div className="card">
        {!list?.length ? <Empty>No auditors in the register yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Auditor</th><th>For</th><th>Qualification</th><th>Core tools · CSR</th><th className="num">Audits (12 mo.)</th><th>Status</th></tr></thead>
            <tbody>{list.map((a) => { const e = one(a.employee as { first_name: string; last_name: string | null; employee_code: string | null } | null); const n = last12(a.id); const st = auditorStatus(a, n, today); return (
              <tr key={a.id}>
                <td><b>{e ? fullName(e) : "—"}</b><div className="muted" style={{ fontSize: 12 }}>{e?.employee_code}</div></td>
                <td>{AUDITOR_KINDS[a.kind]}<div className="muted" style={{ fontSize: 12 }}>{(a.standards ?? []).join(", ")}</div></td>
                <td>{a.qualification ?? "—"}<div className="muted" style={{ fontSize: 12 }}>{a.certificate_no ? `${a.certificate_no} · ` : ""}{a.trained_on ? `trained ${fmtDate(a.trained_on)}` : ""}{a.valid_until ? ` · valid to ${fmtDate(a.valid_until)}` : ""}</div></td>
                <td>{(a.core_tools ?? []).join(", ") || "—"}{a.csr_trained ? <span className="badge ok" style={{ marginLeft: 6 }}>CSR</span> : <span className="badge warn" style={{ marginLeft: 6 }}>no CSR</span>}</td>
                <td className="num">{n} / {a.audits_per_year}</td>
                <td><span className={`badge ${st.tone}`}>{st.text}</span></td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Record an audit done</h2>
          {!list?.length ? <Empty>Add an auditor first.</Empty> : (
            <ActionForm action={addAudit} submitLabel="Record" className="formgrid" resetOnSuccess>
              <label className="field full">Auditor<select name="auditor_id" required defaultValue=""><option value="" disabled>Choose…</option>
                {list.map((a) => { const e = one(a.employee as { first_name: string; last_name: string | null } | null); return <option key={a.id} value={a.id}>{e ? fullName(e) : "—"} — {AUDITOR_KINDS[a.kind]}</option>; })}</select></label>
              <label className="field">Date<input type="date" name="audit_date" required defaultValue={today} /></label>
              <label className="field">Type<select name="audit_type" defaultValue="process"><option value="system">System</option><option value="process">Process</option><option value="product">Product</option><option value="supplier">Supplier</option><option value="layered">Layered process audit</option></select></label>
              <label className="field full">Area / process audited<input name="area" required maxLength={160} placeholder="Turning cell 1 — PFMEA and control plan" /></label>
              <label className="field">Role<select name="role" defaultValue="auditor"><option value="lead">Lead auditor</option><option value="auditor">Auditor</option><option value="observer">Observer (in training)</option></select></label>
              <label className="field">Findings<input name="findings" inputMode="numeric" placeholder="0" /></label>
            </ActionForm>)}
          {(audits ?? []).length > 0 && <><h3 style={{ marginTop: 18 }}>Recent audits</h3><ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{(audits ?? []).slice(0, 10).map((x) => {
            const a = list?.find((y) => y.id === x.auditor_id); const e = one(a?.employee as { first_name: string; last_name: string | null } | null);
            return <li key={x.id}>{fmtDate(x.audit_date)} · {x.area} · {e ? fullName(e) : "—"} ({x.role}){x.findings != null ? ` · ${x.findings} findings` : ""}</li>; })}</ul></>}
        </div>
        <div className="card">
          <h2>Add an auditor</h2>
          <ActionForm action={saveAuditor} submitLabel="Add to the register" className="formgrid" resetOnSuccess><Fields /></ActionForm>
          {(list ?? []).length > 0 && <><h3 style={{ marginTop: 18 }}>Edit</h3>{list!.map((a) => { const e = one(a.employee as { first_name: string; last_name: string | null } | null); return (
            <details key={a.id}><summary>{e ? fullName(e) : "—"} — {AUDITOR_KINDS[a.kind]}</summary>
              <ActionForm action={saveAuditor} submitLabel="Save" className="formgrid" hidden={{ id: a.id }}><Fields a={a} />
                <label className="field full check"><input type="checkbox" name="inactive" defaultChecked={!a.active} /> No longer an auditor</label></ActionForm></details>); })}</>}
        </div>
      </div>
    </AppShell>
  );
}
