import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { dueState } from "@/lib/safety/rules";
import { people, personLabel } from "@/app/app/qms/data";
import { SafetyTabs, dmy } from "../ui";
import { saveMedical } from "../actions";

export const metadata = { title: "Medical examinations" };
const KINDS: Record<string, string> = { pre_employment: "Pre-employment", periodic: "Periodic", hearing: "Hearing (audiometry)", vision: "Vision", lung_function: "Lung function", other: "Other" };

export default async function MedicalPage() {
  const session = await requireRole(HR_ROLES);
  const db = await createClient();
  const today = istToday();
  const [{ data: recs }, ppl] = await Promise.all([db.from("medical_checks").select("*").order("done_on", { ascending: false, nullsFirst: false }), people(db)]);
  const latest = new Map<string, NonNullable<typeof recs>[number]>();
  for (const r of recs ?? []) { const k = `${r.employee_id}|${r.kind}`; const c = latest.get(k); if (!c || (r.next_due ?? "") > (c.next_due ?? "")) latest.set(k, r); }
  const due = [...latest.values()].map((r) => ({ r, st: dueState(r.next_due, today), e: ppl.find((x) => x.id === r.employee_id) })).filter((x) => x.e && x.st !== "ok" && x.st !== "none")
    .sort((a, b) => (a.r.next_due ?? "").localeCompare(b.r.next_due ?? ""));

  return (
    <AppShell session={session} active="/app/safety">
      <div className="pagehead"><div><h1>Medical examinations</h1>
        <p>Dates only — when each person was examined and when the next one is due (hazardous processes, food handlers, drivers …). The HRM keeps no medical findings; the certificate stays as a private PDF if you attach it.</p></div></div>
      <SafetyTabs active="med" />
      <div className="card">
        <h2>Due within 30 days or overdue</h2>
        {!due.length ? <Empty>Nothing due.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table><tbody>{due.map(({ r, st, e }) => (
          <tr key={r.id}><td>{e!.name} <span className="muted">{e!.code}</span></td><td>{e!.department ?? "—"}</td><td>{KINDS[r.kind]}</td><td>last {dmy(r.done_on)}</td>
            <td><span className={`badge ${st === "overdue" ? "danger" : "warn"}`}>{st === "overdue" ? "Overdue since" : "Due"} {dmy(r.next_due)}</span></td></tr>))}</tbody></table></div>}
      </div>
      <div className="grid two">
        <div className="card">
          <h2>Record an examination</h2>
          <ActionForm action={saveMedical} submitLabel="Save" className="formgrid" resetOnSuccess>
            <label className="field full">Person<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
            <label className="field">Kind<select name="kind" defaultValue="periodic">{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field">Done on<input type="date" name="done_on" max={today} /></label>
            <label className="field">Next due <span className="help">blank: a year later</span><input type="date" name="next_due" /></label>
            <label className="field">Doctor / clinic<input name="doctor" maxLength={160} /></label>
            <label className="field full">Certificate (PDF) <span className="help">optional, private</span><input type="file" name="certificate" accept="application/pdf,image/jpeg,image/png" /></label>
          </ActionForm>
        </div>
        <div className="card">
          <h2>Latest records</h2>
          {!recs?.length ? <Empty>Nothing yet.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table><tbody>{recs.slice(0, 30).map((r) => { const e = ppl.find((x) => x.id === r.employee_id); return (
            <tr key={r.id}><td>{e?.name ?? "—"}</td><td>{KINDS[r.kind]}</td><td>{dmy(r.done_on)}</td><td>next {dmy(r.next_due)}</td>
              <td>{r.certificate_path && <a href={p(`/api/safety/file?medical=${r.id}`)} target="_blank" rel="noreferrer">certificate</a>}</td></tr>); })}</tbody></table></div>}
        </div>
      </div>
    </AppShell>
  );
}
