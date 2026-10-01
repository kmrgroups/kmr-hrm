import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fullName } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { addDaysIso } from "@/lib/qms/rules";
import { QmsTabs, Clause } from "../ui";
import { people, masters, personLabel } from "../data";
import { saveOjtProgress, saveOjtTemplate, startOjt } from "../actions";

export const metadata = { title: "On-the-job training" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
type Item = { text: string; kind: string };
const KIND: Record<string, [string, string]> = { csr: ["Customer requirement", "info"], nc: ["Consequence of nonconformity", "warn"], task: ["", ""] };

export default async function OjtPage() {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const today = istToday();
  const db = await createClient();
  const [ppl, m, { data: tpls }, { data: recs }, { data: ops }] = await Promise.all([
    people(db, { includeJoiners: true }), hr ? masters(db) : Promise.resolve({ designations: [], departments: [], plants: [] }),
    db.from("ojt_templates").select("id,title,designation_id,operation_id,items,days,active,sample").order("title"),
    db.from("ojt_records").select("id,status,started_on,completed_on,trainer,done,remarks,signed_off_name,template_id,employee:employees(first_name,last_name,employee_code)").order("status").order("started_on", { ascending: false }).limit(300),
    hr ? db.from("operations").select("id,line,code,name").eq("active", true).order("line").order("code") : Promise.resolve({ data: [] as { id: string; line: string; code: string; name: string }[] }),
  ]);
  const tpl = (id: string) => (tpls ?? []).find((t) => t.id === id);
  const running = (recs ?? []).filter((r) => r.status === "in_progress"), done = (recs ?? []).filter((r) => r.status === "completed");
  const itemsText = (items: Item[]) => items.map((i) => (i.kind === "task" ? i.text : `${i.kind.toUpperCase()}: ${i.text}`)).join("\n");

  return (
    <AppShell session={session} active="/app/qms">
      <div className="pagehead"><div><h1>On-the-job training <Clause>IATF 7.2.2</Clause></h1>
        <p>A checklist for every new or changed job — including the customer-specific requirements and the consequences of nonconformity — ticked off by the trainer and signed by the supervisor.</p></div></div>
      <QmsTabs active="ojt" hr={hr} />

      <div className="card">
        <h2>In progress ({running.length})</h2>
        {!running.length ? <Empty>Nobody is on on-the-job training now.</Empty> : (
          <div className="stack" style={{ gap: 10 }}>{running.map((r) => {
            const t = tpl(r.template_id), e = one(r.employee as unknown as { first_name: string; last_name: string | null; employee_code: string | null } | null);
            const items = (t?.items ?? []) as Item[], doneSet = new Set((r.done as number[]) ?? []);
            const late = addDaysIso(r.started_on, t?.days ?? 15) < today;
            return (
              <details key={r.id} className="ojt">
                <summary><b>{e ? fullName(e) : "—"}</b> <span className="muted">{e?.employee_code}</span> · {t?.title} · <span className={`badge ${late ? "warn" : "info"}`}>{doneSet.size} of {items.length}</span>
                  <span className="muted"> · from {fmtDate(r.started_on)}{r.trainer ? ` with ${r.trainer}` : ""}{late ? ` · past the ${t?.days} days planned` : ""}</span></summary>
                <ActionForm action={saveOjtProgress} submitLabel="Save" hidden={{ id: r.id }}>
                  <ul className="checklist">{items.map((it, i) => (
                    <li key={i}><label className="check"><input type="checkbox" name={`item_${i}`} defaultChecked={doneSet.has(i)} /> <span>{it.text}{KIND[it.kind]?.[0] && <span className={`badge ${KIND[it.kind]![1]}`} style={{ marginLeft: 6, fontSize: 11 }}>{KIND[it.kind]![0]}</span>}</span></label></li>))}</ul>
                  <label className="field">Remarks<input name="remarks" maxLength={500} defaultValue={r.remarks ?? ""} /></label>
                  <label className="check"><input type="checkbox" name="sign_off" /> Every point is done — I sign off this person as trained on the job</label>
                </ActionForm>
              </details>);
          })}</div>)}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Start on-the-job training</h2>
          {!(tpls ?? []).some((t) => t.active) ? <Empty>Add a checklist first{hr ? " (below)" : " (HR)"}.</Empty> : (
            <ActionForm action={startOjt} submitLabel="Start" className="formgrid" resetOnSuccess>
              <label className="field full">Person<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
              <label className="field full">Checklist<select name="template_id" required defaultValue=""><option value="" disabled>Choose…</option>{(tpls ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
              <label className="field">Trainer<input name="trainer" maxLength={120} placeholder="Senior operator / trainer" /></label>
              <label className="field">From<input type="date" name="started_on" defaultValue={today} /></label>
            </ActionForm>)}
        </div>
        <div className="card">
          <h2>Completed ({done.length})</h2>
          {!done.length ? <Empty>None yet.</Empty> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{done.slice(0, 40).map((r) => { const e = one(r.employee as unknown as { first_name: string; last_name: string | null } | null); return (
              <li key={r.id}><b>{e ? fullName(e) : "—"}</b> · {tpl(r.template_id)?.title} · signed off by {r.signed_off_name ?? "—"} on {fmtDate(r.completed_on)}</li>); })}</ul>)}
        </div>
      </div>

      {hr && (
        <div className="card">
          <h2>Checklists</h2>
          <div className="stack" style={{ gap: 6, marginBottom: 12 }}>{(tpls ?? []).map((t) => (
            <details key={t.id}><summary>{t.title} <span className="muted">· {(t.items as Item[]).length} points · {t.days} days</span>{t.sample && <span className="badge" style={{ marginLeft: 6 }}>Sample</span>}{!t.active && <span className="badge" style={{ marginLeft: 6 }}>not used</span>}</summary>
              <ActionForm action={saveOjtTemplate} submitLabel="Save" className="formgrid" hidden={{ id: t.id }}>
                <TemplateFields t={{ ...t, itemsText: itemsText(t.items as Item[]) }} designations={m.designations} ops={ops ?? []} />
                <label className="field full check"><input type="checkbox" name="inactive" defaultChecked={!t.active} /> Not used any more</label>
              </ActionForm></details>))}</div>
          <details><summary className="btn secondary small">Add a checklist</summary>
            <ActionForm action={saveOjtTemplate} submitLabel="Add" className="formgrid" resetOnSuccess><TemplateFields designations={m.designations} ops={ops ?? []} /></ActionForm></details>
        </div>
      )}
    </AppShell>
  );
}

function TemplateFields({ t, designations, ops }: { t?: { title: string; designation_id: string | null; operation_id: string | null; days: number; itemsText: string }; designations: { id: string; name: string }[]; ops: { id: string; line: string; code: string; name: string }[] }) {
  return (<>
    <label className="field full">Checklist<input name="title" required maxLength={160} defaultValue={t?.title ?? ""} placeholder="New operator — CNC turning cell" /></label>
    <label className="field">For designation<select name="designation_id" defaultValue={t?.designation_id ?? ""}><option value="">—</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="field">For operation<select name="operation_id" defaultValue={t?.operation_id ?? ""}><option value="">—</option>{ops.map((o) => <option key={o.id} value={o.id}>{o.line} · {o.code} {o.name}</option>)}</select></label>
    <label className="field">Days planned<input name="days" inputMode="numeric" defaultValue={t?.days ?? 15} /></label>
    <label className="field full">Points, one per line<textarea name="items" rows={8} required defaultValue={t?.itemsText ?? ""}
      placeholder={"Machine start-up and daily checklist\nFirst-off and in-process checks\nCSR: Customer A — retain first-off parts for one shift\nNC: An oversize bore at the customer stops his line"} />
      <span className="help">Start a line with “CSR:” for a customer-specific requirement, “NC:” for a consequence of nonconformity (IATF 7.2.2).</span></label>
  </>);
}
