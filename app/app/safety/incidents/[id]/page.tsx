import { notFound } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday, addDays } from "@/lib/attendance/time";
import { aiConfigured } from "@/lib/ai/gateway";
import { p } from "@/lib/base-path";
import { KINDS, STATUS, POTENTIAL, INJURY_KINDS, canClose } from "@/lib/safety/rules";
import type { WhyDraft } from "@/lib/safety/ai";
import { people, personLabel } from "@/app/app/qms/data";
import { AiBadge } from "@/app/app/qms/ui";
import { SafetyTabs, dmy, dmyt, KIND_TONE } from "../../ui";
import { actionDone, addAction, aiWhyWhy, closeIncident, saveInvestigation } from "../../actions";

export const metadata = { title: "Incident" };
export const maxDuration = 60;

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: i } = await db.from("incidents").select("*, plant:plants(name), department:departments(name)").eq("id", id).maybeSingle();
  if (!i) notFound();
  const [{ data: acts }, ppl, { data: st }] = await Promise.all([
    db.from("incident_actions").select("*").eq("incident_id", id).order("created_at"), people(db), db.from("qms_settings").select("ai_enabled").maybeSingle(),
  ]);
  const today = istToday(), ai = aiConfigured() && st?.ai_enabled !== false;
  const injured = i.injured_employee_id ? ppl.find((e) => e.id === i.injured_employee_id) : null;
  const sugg = (i.ai_actions ?? []) as WhyDraft["actions"];
  const closeBlock = canClose(i, acts ?? []);
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v) ?? null;
  const injury = INJURY_KINDS.includes(i.kind);
  const why = [...(i.why_why ?? []), "", "", "", "", ""].slice(0, 5);

  return (
    <AppShell session={session} active="/app/safety">
      <div className="pagehead"><div><h1><span className="mono" style={{ fontSize: "0.8em" }}>{i.ref}</span> {KINDS[i.kind]}</h1>
        <p>{dmyt(i.occurred_at)} · {[one(i.plant as { name: string } | null)?.name, one(i.department as { name: string } | null)?.name, i.area].filter(Boolean).join(" · ")} · reported by {i.reported_by_name ?? "—"}{i.sample ? " · Sample" : ""}</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className={`badge ${i.status === "closed" ? "ok" : i.status === "reported" ? "danger" : "warn"}`} style={{ fontSize: 14 }}>{STATUS[i.status]}</span>
          {i.status === "closed" ? <ActionForm action={closeIncident} submitLabel="Reopen" variant="secondary" className="inline" hidden={{ id, reopen: "1" }} confirm="Reopen this incident?" />
            : <ActionForm action={closeIncident} submitLabel="Close" variant="accent" className="inline" hidden={{ id }} confirm={`Close ${i.ref} in your name?`} />}</div></div>
      <SafetyTabs active="inc" hr={hr} />
      {i.status !== "closed" && closeBlock && <div className="alert info" style={{ marginBottom: 12 }}>To close: {closeBlock}</div>}
      {i.status === "closed" && <div className="alert ok" style={{ marginBottom: 12 }}>Closed by {i.closed_by_name} on {dmy(i.closed_at)}.</div>}

      <div className="grid two">
        <div className="card">
          <h2>What happened</h2>
          <p style={{ whiteSpace: "pre-line" }}>{i.description}</p>
          {i.immediate_action && <p><b>Done at once:</b> {i.immediate_action}</p>}
          {(injured || i.injured_other) && <p><b>Hurt:</b> {injured ? personLabel(injured) : i.injured_other}{i.injury_nature ? ` — ${i.injury_nature}` : ""}{i.days_lost ? ` · ${i.days_lost} days lost` : ""}</p>}
          {i.potential && <p><b>Could have been:</b> {POTENTIAL[i.potential]}</p>}
          {i.photo_path && <p><a href={p(`/api/safety/file?incident=${id}`)} target="_blank" rel="noreferrer">📷 Photo</a></p>}
          {i.reportable && <p><span className="badge danger">Reportable</span> {i.authority_notified_on ? `notified ${dmy(i.authority_notified_on)}${i.authority_ref ? ` · ${i.authority_ref}` : ""}` : <b>authority not yet notified</b>}</p>}
        </div>
        <div className="card">
          <div className="spread"><h2 style={{ margin: 0 }}>Why it happened{i.ai_model && <AiBadge model={i.ai_model} draft={i.status !== "closed"} />}</h2>
            {ai && i.status !== "closed" && <ActionForm action={aiWhyWhy} submitLabel={i.why_why?.length ? "Ask the AI again" : "Draft the why-why (AI)"} pendingLabel="Thinking…" variant="secondary" className="inline" hidden={{ id }}
              confirm={i.why_why?.length ? "Replace the why-why and root cause with the AI's draft?" : undefined} />}</div>
          {i.ai_model && i.status !== "closed" && <p className="muted" style={{ fontSize: 13 }}>The free AI drafted this from the description. Check every “why” against what really happened on the floor, correct it and save.</p>}
          <ActionForm action={saveInvestigation} submitLabel="Save" className="formgrid" hidden={{ id }}>
            <label className="field">Kind<select name="kind" defaultValue={i.kind}>{Object.entries(KINDS).map(([x, l]) => <option key={x} value={x}>{l}</option>)}</select></label>
            <label className="field">Investigated by<input name="investigator_name" maxLength={120} defaultValue={i.investigator_name ?? session.user.full_name} /></label>
            {why.map((w, n) => <label key={n} className="field full">Why {n + 1}<input name={`why_${n}`} maxLength={300} defaultValue={w} /></label>)}
            <label className="field full">Root cause<textarea name="root_cause" rows={2} maxLength={2000} defaultValue={i.root_cause ?? ""} /></label>
            <label className="field full">Where exactly<input name="area" maxLength={160} defaultValue={i.area ?? ""} /></label>
            <label className="field full">What was done at once<textarea name="immediate_action" rows={2} maxLength={2000} defaultValue={i.immediate_action ?? ""} /></label>
            <label className="field">Person hurt<select name="injured_employee_id" defaultValue={i.injured_employee_id ?? ""}><option value="">—</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
            <label className="field">…or contract worker / visitor<input name="injured_other" maxLength={160} defaultValue={i.injured_other ?? ""} /></label>
            {(injury || i.injury_nature) && <label className="field">Injury<input name="injury_nature" maxLength={300} defaultValue={i.injury_nature ?? ""} /></label>}
            <label className="field">Days lost<input name="days_lost" inputMode="numeric" defaultValue={i.days_lost ?? 0} /></label>
            <label className="field">Could have been<select name="potential" defaultValue={i.potential ?? 3}>{POTENTIAL.slice(1).map((l, n) => <option key={l} value={n + 1}>{n + 1} — {l}</option>)}</select></label>
            <label className="field check"><input type="checkbox" name="reportable" defaultChecked={i.reportable} /> Reportable to the authority</label>
            <label className="field">Authority notified on<input type="date" name="authority_notified_on" defaultValue={i.authority_notified_on ?? ""} /></label>
            <label className="field">Notice / reference no.<input name="authority_ref" maxLength={120} defaultValue={i.authority_ref ?? ""} /></label>
          </ActionForm>
        </div>
      </div>

      <div className="card">
        <h2>Actions — so it does not happen again</h2>
        {!acts?.length ? <Empty>No action yet.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Action</th><th>Who</th><th>By</th><th>Status</th><th></th></tr></thead>
          <tbody>{acts.map((a) => { const late = a.status === "open" && a.due_on < today; const ow = a.owner_employee_id ? ppl.find((e) => e.id === a.owner_employee_id) : null; return (
            <tr key={a.id}><td>{a.action}<div className="muted" style={{ fontSize: 12 }}>{a.kind === "preventive" ? "Preventive" : "Corrective"}{a.done_note ? ` · ${a.done_note}` : ""}</div></td>
              <td>{ow?.name ?? a.owner_name ?? "—"}</td><td>{dmy(a.due_on)}</td>
              <td>{a.status === "done" ? <span className="badge ok">Done {dmy(a.done_on)}</span> : <span className={`badge ${late ? "danger" : "warn"}`}>{late ? "Overdue" : "Open"}</span>}</td>
              <td>{a.status === "open" ? <details><summary className="btn small secondary" style={{ display: "inline-block" }}>Done…</summary>
                <ActionForm action={actionDone} submitLabel="Mark done" className="stack" hidden={{ id: a.id }}><label className="field">Done on<input type="date" name="done_on" defaultValue={today} max={today} /></label>
                  <label className="field">What was done<input name="done_note" maxLength={1000} /></label></ActionForm></details>
                : i.status !== "closed" && <ActionForm action={actionDone} submitLabel="Reopen" variant="secondary" className="inline" hidden={{ id: a.id, reopen: "1" }} />}</td></tr>); })}</tbody>
        </table></div>}
        {i.status !== "closed" && <ActionForm action={addAction} submitLabel="Add" className="formgrid" hidden={{ incident_id: id }}>
          {sugg.length > 0 && <fieldset className="full" style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10 }}>
            <legend className="muted" style={{ fontSize: 13 }}>Suggested by the AI — tick the ones you agree with (they get the person and date below; due date from the suggestion)</legend>
            {sugg.map((a, n) => <label key={n} className="field check" style={{ margin: "2px 0" }}><input type="checkbox" name="ai_pick" value={n} /> {a.action} <span className="muted">({a.kind}, {a.days} days)</span></label>)}</fieldset>}
          <label className="field full">Action<input name="action" maxLength={1000} placeholder="e.g. Fix a fixed guard on the press die area" /></label>
          <label className="field">Kind<select name="kind" defaultValue="corrective"><option value="corrective">Corrective (this case)</option><option value="preventive">Preventive (everywhere)</option></select></label>
          <label className="field">By<input type="date" name="due_on" defaultValue={addDays(today, 14)} /></label>
          <label className="field">Who (employee — gets an e-mail)<select name="owner_employee_id" defaultValue=""><option value="">—</option>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
          <label className="field">…or position<input name="owner_name" maxLength={120} placeholder="e.g. Maintenance Head" /></label>
        </ActionForm>}
      </div>
    </AppShell>
  );
}
