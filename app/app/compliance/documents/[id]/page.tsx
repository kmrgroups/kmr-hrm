import { notFound } from "next/navigation";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { aiConfigured } from "@/lib/ai/gateway";
import { p } from "@/lib/base-path";
import { DOC_KINDS, reviewDue } from "@/lib/compliance/rules";
import { isSampleRecipient } from "@/lib/notify/render";
import { masters, people } from "@/app/app/qms/data";
import { AiBadge } from "@/app/app/qms/ui";
import { Bar } from "@/app/app/engage/ui";
import { CompTabs, dmy } from "../../ui";
import { DocFields } from "../fields";
import { aiRedraft, approveRevision, discardDraft, saveDocument, saveDraft, setDocumentActive } from "../../actions";

export const metadata = { title: "Document" };
export const maxDuration = 60;

interface V { id: string; revision: number; body: string | null; file_path: string | null; file_name: string | null; change_note: string | null; status: string; prepared_by_name: string | null;
  approved_by_name: string | null; approved_at: string | null; effective_from: string | null; review_due: string | null; ai_model: string | null; created_at: string }

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ who?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { id } = await params, { who = "pending" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: d } = await db.from("documents").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [{ data: vs }, m, { data: st }] = await Promise.all([
    db.from("document_versions").select("*").eq("document_id", id).order("revision", { ascending: false }),
    masters(db), db.from("qms_settings").select("ai_enabled").maybeSingle(),
  ]);
  const versions = (vs ?? []) as V[];
  const cur = versions.find((v) => v.status === "approved"), draft = versions.find((v) => v.status === "draft");
  const today = istToday(), ai = aiConfigured() && st?.ai_enabled !== false;
  // acknowledgements of the current revision
  let ackList: { id: string; name: string; code: string | null; department: string | null; at: string | null; sample: boolean }[] = [], ackN = 0;
  if (cur && d.needs_ack) {
    const [ppl, acks] = await Promise.all([people(db), fetchAll<{ employee_id: string; acknowledged_at: string }>((a, b) => db.from("document_acks").select("employee_id,acknowledged_at").eq("version_id", cur.id).range(a, b))]);
    const at = new Map(acks.map((x) => [x.employee_id, x.acknowledged_at]));
    ackList = ppl.filter((e) => d.audience === "all" || (d.audience === "department" ? e.department_id === d.department_id : e.plant_id === d.plant_id))
      .map((e) => ({ id: e.id, name: e.name, code: e.code, department: e.department, at: at.get(e.id) ?? null, sample: isSampleRecipient(e.email) }));
    ackN = ackList.filter((x) => x.at).length;
  }
  const shownAcks = ackList.filter((x) => who === "all" ? true : who === "done" ? x.at : !x.at);
  const View = ({ v }: { v: V }) => <>
    {v.body ? <div style={{ whiteSpace: "pre-line", border: "1px solid var(--border)", borderRadius: 8, padding: 14, maxHeight: 520, overflow: "auto" }}>{v.body}</div> : null}
    {v.file_path && <p><a href={p(`/api/compliance/file?version=${v.id}`)} target="_blank" rel="noreferrer">📄 {v.file_name ?? "Attached PDF"}</a></p>}
  </>;

  return (
    <AppShell session={session} active="/app/compliance">
      <div className="pagehead"><div><h1><span className="mono" style={{ fontSize: "0.8em" }}>{d.doc_no}</span> {d.title}{!d.active && <span className="badge" style={{ marginLeft: 8 }}>Withdrawn</span>}</h1>
        <p>{DOC_KINDS[d.kind]} · owner {d.owner_name ?? "—"} · review every {d.review_months} months{d.employee_access ? " · in the employee portal" : ""}{d.needs_ack ? " · each person acknowledges" : ""}{d.sample ? " · Sample" : ""}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {cur && <a className="btn secondary" href={p(`/app/compliance/documents/${id}/print`)} target="_blank" rel="noreferrer">Print</a>}
          {cur && !draft && <ActionForm action={saveDraft} submitLabel="Start a new revision" variant="secondary" className="inline" hidden={{ document_id: id, start: "1" }} />}
          <ActionForm action={setDocumentActive} submitLabel={d.active ? "Withdraw" : "Put back in use"} variant="secondary" className="inline" hidden={{ id, on: d.active ? "0" : "1" }} confirm={d.active ? "Withdraw this document? It stays with its history." : undefined} />
        </div></div>
      <CompTabs active="docs" />

      {draft && <div className="card" style={{ borderTop: "3px solid var(--warn)" }}>
        <div className="spread"><h2 style={{ margin: 0 }}>Draft — revision {draft.revision}{draft.ai_model && <AiBadge model={draft.ai_model} draft />}</h2>
          <span className="muted" style={{ fontSize: 13 }}>prepared by {draft.prepared_by_name ?? "—"}</span></div>
        {draft.ai_model && <div className="alert warn" style={{ margin: "10px 0" }}>The free AI wrote this text. Read every line, fill every [to be filled], and correct it — the company issues it, not the AI.</div>}
        <ActionForm action={saveDraft} submitLabel="Save the draft" className="formgrid" hidden={{ document_id: id }}>
          <label className="field full">Text<textarea name="body" rows={16} maxLength={60000} defaultValue={draft.body ?? ""} /></label>
          <label className="field full">What changed in this revision<input name="change_note" maxLength={1000} defaultValue={draft.change_note ?? (draft.revision === 0 ? "First issue" : "")} /></label>
          <label className="field">PDF <span className="help">optional — instead of or with the text, up to 5 MB</span><input type="file" name="file" accept="application/pdf" /></label>
          {draft.file_path ? <label className="field check"><input type="checkbox" name="remove_file" /> Remove the attached {draft.file_name ?? "PDF"}</label> : <div />}
        </ActionForm>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <b>Approve and issue</b>
            <p className="muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>Approving makes revision {draft.revision} current{cur ? ` and revision ${cur.revision} obsolete` : ""}. Review due {d.review_months} months after the effective date.{d.needs_ack && d.employee_access ? " People it is for are asked to read and acknowledge it." : ""}</p>
            <ActionForm action={approveRevision} submitLabel={`Approve revision ${draft.revision}`} variant="accent" className="formgrid" hidden={{ version_id: draft.id }} confirm={`Approve ${d.doc_no} revision ${draft.revision} in your name (${session.user.full_name})?`}>
              <label className="field">Effective from<input type="date" name="effective_from" defaultValue={today} /></label>
              <div className="muted" style={{ fontSize: 12, alignSelf: "end" }}>review due {dmy(reviewDue(today, d.review_months))}</div>
            </ActionForm>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            {ai ? <><b>Write the draft with AI</b>
              <ActionForm action={aiRedraft} submitLabel="Write it (replaces the draft text)" pendingLabel="Writing…" variant="secondary" className="stack" hidden={{ document_id: id }} confirm="Replace the draft text with the AI's?">
                <label className="field">Your points<textarea name="points" rows={4} /></label></ActionForm></> : <p className="muted" style={{ margin: 0 }}>The free AI (QMS › AI & review) can write a first draft from your points.</p>}
            <div style={{ marginTop: 10 }}><ActionForm action={discardDraft} submitLabel={versions.length === 1 ? "Delete this document" : "Discard this draft"} variant="danger" className="inline" hidden={{ version_id: draft.id }} confirm="Discard the draft?" /></div>
          </div>
        </div>
      </div>}

      <div className="grid two">
        <div className="card">
          <h2>Current — {cur ? `revision ${cur.revision}` : "not issued yet"}</h2>
          {!cur ? <Empty>No approved revision yet.</Empty> : <>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Effective {dmy(cur.effective_from)} · approved by <b>{cur.approved_by_name}</b> on {dmy(cur.approved_at)} · prepared by {cur.prepared_by_name ?? "—"} · review due <span className={cur.review_due && cur.review_due < today ? "badge danger" : ""}>{dmy(cur.review_due)}</span>{cur.ai_model ? " · first drafted by AI" : ""}</p>
            <View v={cur} /></>}
        </div>
        <div className="card">
          <h2>Details</h2>
          <ActionForm action={saveDocument} submitLabel="Save" className="formgrid" hidden={{ id }}><DocFields m={m} d={d} edit /></ActionForm>
        </div>
      </div>

      {cur && d.needs_ack && <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>Read and acknowledged — revision {cur.revision}</h2>
          <div><Bar pct={ackList.length ? (ackN / ackList.length) * 100 : 0} tone={ackN / Math.max(1, ackList.length) >= 0.9 ? "ok" : "warn"} /> {ackN} of {ackList.length}</div></div>
        <div className="tabs" style={{ border: 0, margin: "8px 0" }}>{[["pending", "Not yet"], ["done", "Acknowledged"], ["all", "Everybody"]].map(([k, l]) => <a key={k} className={who === k ? "active" : ""} href={`?who=${k}`}>{l}</a>)}</div>
        {!shownAcks.length ? <Empty>Nobody.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table><tbody>{shownAcks.slice(0, 500).map((x) => (
          <tr key={x.id}><td>{x.name} <span className="muted">{x.code}</span>{x.sample && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}</td><td>{x.department ?? "—"}</td><td>{x.at ? dmy(x.at) : <span className="badge warn">Pending</span>}</td></tr>))}</tbody></table></div>}
      </div>}

      <div className="card">
        <h2>Revision history</h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Rev.</th><th>What changed</th><th>Prepared by</th><th>Approved by</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}><td>{v.revision}</td><td>{v.change_note ?? "—"}{v.ai_model ? <span className="muted"> (AI-drafted)</span> : null}{v.status === "obsolete" && <details><summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>see this revision</summary><View v={v} /></details>}</td>
              <td>{v.prepared_by_name ?? "—"}</td><td>{v.approved_by_name ? `${v.approved_by_name}, ${dmy(v.approved_at)}` : "—"}</td><td>{dmy(v.effective_from)}</td>
              <td><span className={`badge ${v.status === "approved" ? "ok" : v.status === "draft" ? "warn" : ""}`}>{v.status === "approved" ? "Current" : v.status === "draft" ? "Draft" : "Obsolete"}</span></td></tr>))}</tbody>
        </table></div>
      </div>
    </AppShell>
  );
}
