import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { FREQS, KINDS } from "@/lib/compliance/rules";
import { CompTabs, dmy } from "../ui";
import { saveItem } from "../actions";

export const metadata = { title: "What we must comply with" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface It { id?: string; code?: string; title?: string; law?: string | null; kind?: string; frequency?: string; due_months?: number[]; due_day?: number; state?: string | null; licence_no?: string | null;
  valid_until?: string | null; renew_days?: number; remind_days?: number; owner_name?: string | null; owner_email?: string | null; notes?: string | null; active?: boolean }

function ItemFields({ it = {} }: { it?: It }) {
  return <>
    <label className="field">Code<input name="code" required maxLength={30} defaultValue={it.code ?? ""} placeholder="e.g. PF" /></label>
    <label className="field">Kind<select name="kind" defaultValue={it.kind ?? "return"}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field full">Title<input name="title" required maxLength={160} defaultValue={it.title ?? ""} /></label>
    <label className="field full">Law / rule<input name="law" maxLength={200} defaultValue={it.law ?? ""} /></label>
    <label className="field">How often<select name="frequency" defaultValue={it.frequency ?? "monthly"}>{Object.entries(FREQS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Due day of the month <span className="help">31 = last day</span><input name="due_day" inputMode="numeric" defaultValue={it.due_day ?? 15} /></label>
    <fieldset className="chips full"><span className="muted" style={{ fontSize: 13, width: "100%" }}>Months it falls due (quarterly / twice a year / yearly):</span>
      {MONTHS.map((m, i) => <label key={m} className="field check" style={{ margin: 0 }}><input type="checkbox" name="due_months" value={i + 1} defaultChecked={(it.due_months ?? []).includes(i + 1)} /> {m}</label>)}</fieldset>
    <label className="field">Licence / registration no.<input name="licence_no" maxLength={80} defaultValue={it.licence_no ?? ""} /></label>
    <label className="field">Valid until <span className="help">licences</span><input type="date" name="valid_until" defaultValue={it.valid_until ?? ""} /></label>
    <label className="field">Start renewal (days before expiry)<input name="renew_days" inputMode="numeric" defaultValue={it.renew_days ?? 60} /></label>
    <label className="field">Remind (days before due)<input name="remind_days" inputMode="numeric" defaultValue={it.remind_days ?? 7} /></label>
    <label className="field">Looked after by<input name="owner_name" maxLength={120} defaultValue={it.owner_name ?? ""} placeholder="e.g. Payroll Executive" /></label>
    <label className="field">Reminder e-mail <span className="help">blank: the HR managers</span><input type="email" name="owner_email" maxLength={200} defaultValue={it.owner_email ?? ""} /></label>
    <label className="field">State<input name="state" maxLength={40} defaultValue={it.state ?? ""} /></label>
    <label className="field">In use<select name="active" defaultValue={it.active === false ? "off" : "on"}><option value="on">Yes</option><option value="off">No — not for us</option></select></label>
    <label className="field full">Notes<input name="notes" maxLength={1000} defaultValue={it.notes ?? ""} /></label>
  </>;
}

export default async function ItemsPage() {
  const session = await requireRole(HR_ROLES);
  const db = await createClient();
  const { data: items } = await db.from("compliance_items").select("*").order("active", { ascending: false }).order("kind").order("code");
  const when = (it: It) => it.frequency === "once" ? (it.valid_until ? `renew from ${dmy(it.valid_until)} minus ${it.renew_days} days` : "valid-until not entered")
    : it.frequency === "monthly" ? `day ${it.due_day} of every month` : `day ${it.due_day} of ${(it.due_months ?? []).map((m) => MONTHS[m - 1]).join(", ")}`;

  return (
    <AppShell session={session} active="/app/compliance">
      <div className="pagehead"><div><h1>What we must comply with</h1>
        <p>The statutory list the register is made from. It starts with common Karnataka items — <b>check the due dates with your consultant</b>, switch off what does not apply, add licences with their numbers and valid-until dates.</p></div></div>
      <CompTabs active="items" />
      <div className="card">
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Item</th><th>Kind</th><th>Falls due</th><th>Looked after by</th><th></th></tr></thead>
          <tbody>{(items ?? []).map((it) => (
            <tr key={it.id} style={{ opacity: it.active ? 1 : 0.55, verticalAlign: "top" }}>
              <td><b>{it.code}</b> {it.title}{it.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}<div className="muted" style={{ fontSize: 12 }}>{it.law}{it.state ? ` · ${it.state}` : ""}{it.notes ? ` · ${it.notes}` : ""}</div></td>
              <td>{KINDS[it.kind]}</td><td style={{ fontSize: 13 }}>{when(it)}{it.licence_no && <div className="muted">{it.licence_no}</div>}</td>
              <td style={{ fontSize: 13 }}>{it.owner_name ?? "HR"}{it.owner_email && <div className="muted">{it.owner_email}</div>}</td>
              <td><details><summary className="btn small secondary" style={{ display: "inline-block" }}>Change</summary>
                <ActionForm action={saveItem} submitLabel="Save" className="formgrid" hidden={{ id: it.id }}><ItemFields it={it} /></ActionForm></details></td>
            </tr>))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Add an item</h2>
        <ActionForm action={saveItem} submitLabel="Add to the register" className="formgrid" resetOnSuccess><ItemFields /></ActionForm>
      </div>
    </AppShell>
  );
}
