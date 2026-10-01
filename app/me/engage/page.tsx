import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { ANN_CATEGORIES, REC_CATEGORIES, SUG_CATEGORIES, SUG_STATUS, surveyOpen } from "@/lib/engage/rules";
import { colleagues } from "@/lib/engage/data";
import { inr, when, monthName } from "@/app/app/engage/ui";
import { acknowledge, sendSuggestion, thankColleague } from "./actions";

export const metadata = { title: "Notices & ideas" };

export default async function MyEngage() {
  const session = await requireSession();
  if (!session.user.employee_id) redirect("/account");
  const me = session.user.employee_id;
  const db = await createClient();
  const today = istToday();
  // row-level security: only the notices and surveys meant for this person; his own suggestions + the Kaizen board
  const [{ data: anns }, { data: reads }, { data: surveys }, { data: answered }, { data: mine }, { data: board }, { data: wall }, all] = await Promise.all([
    db.from("announcements").select("id,title,body,category,pinned,needs_ack,published_at,publish_on,expires_on").eq("status", "published")
      .order("pinned", { ascending: false }).order("published_at", { ascending: false, nullsFirst: false }).limit(60),
    db.from("announcement_reads").select("announcement_id,read_at,acknowledged_at").eq("employee_id", me),
    db.from("surveys").select("id,title,intro,status,opens_on,closes_on,anonymous,questions").eq("status", "open"),
    db.from("survey_participants").select("survey_id").eq("employee_id", me),
    db.from("suggestions").select("id,ref,title,status,review_note,saving_per_year,created_at").eq("employee_id", me).order("created_at", { ascending: false }),
    db.from("suggestions").select("id,title,benefit,saving_per_year,implemented_on,employee_id").eq("status", "implemented").order("implemented_on", { ascending: false }).limit(8),
    db.from("recognitions").select("id,employee_id,category,message,month,given_by_name,kind,created_at").order("created_at", { ascending: false }).limit(30),
    colleagues(session.tenant.id),
  ]);
  const names = new Map(all.map((x) => [x.id, x]));
  const rd = new Map((reads ?? []).map((r) => [r.announcement_id, r]));
  const board1 = (anns ?? []).filter((a) => !(a.expires_on && a.expires_on < today));
  const todo = board1.filter((a) => a.needs_ack ? !rd.get(a.id)?.acknowledged_at : !rd.has(a.id));
  const done = new Set((answered ?? []).map((x) => x.survey_id));
  const open = (surveys ?? []).filter((s) => surveyOpen(s, today));
  const myRecs = (wall ?? []).filter((r) => r.employee_id === me);

  return (
    <AppShell session={session} active="/me/engage">
      <div className="pagehead"><div><h1>Notices &amp; ideas</h1><p>Company news, surveys, your suggestions and thanks from colleagues.</p></div></div>

      {open.filter((s) => !done.has(s.id)).map((s) => (
        <div key={s.id} className="alert info" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span><b>Your opinion please:</b> {s.title} — {(s.questions as unknown[]).length} questions{s.closes_on ? `, open until ${when(s.closes_on + "T00:00:00+05:30")}` : ""}. {s.anonymous ? "Anonymous." : ""}</span>
          <a className="btn small" href={p(`/me/engage/survey/${s.id}`)}>Answer</a></div>))}

      <div className="card">
        <h2>Notice board {todo.length > 0 && <span className="badge warn">{todo.length} new</span>}</h2>
        {!board1.length ? <Empty>No notices.</Empty> : board1.map((a) => { const r = rd.get(a.id); const pending = a.needs_ack ? !r?.acknowledged_at : !r; return (
          <div key={a.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0", background: pending ? "var(--info-bg)" : undefined, marginInline: -4, paddingInline: 4 }}>
            <div className="spread"><b>{a.pinned ? "📌 " : ""}{a.title}</b><span className="muted" style={{ fontSize: 12 }}><span className="badge">{ANN_CATEGORIES[a.category]}</span> {when(a.published_at)}</span></div>
            <div style={{ whiteSpace: "pre-line", marginTop: 4 }}>{a.body}</div>
            <div style={{ marginTop: 6 }}>{pending ? <ActionForm action={acknowledge} submitLabel={a.needs_ack ? "I have read and understood this" : "Mark as read"} variant={a.needs_ack ? "accent" : "secondary"} className="inline" hidden={{ id: a.id }} />
              : <span className="muted" style={{ fontSize: 13 }}>{r?.acknowledged_at ? `Acknowledged ${when(r.acknowledged_at)}` : "Read"}</span>}</div>
          </div>); })}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Send an idea</h2>
          <p className="muted" style={{ marginTop: 0 }}>Seen something that could be safer, better, faster or cheaper? Every idea gets an answer.</p>
          <ActionForm action={sendSuggestion} submitLabel="Send my idea" className="formgrid" resetOnSuccess>
            <label className="field full">Short title<input name="title" required maxLength={160} placeholder="e.g. Drip tray under the hydraulic pack" /></label>
            <label className="field full">The problem today<textarea name="problem" rows={2} required maxLength={2000} /></label>
            <label className="field full">What should we change?<textarea name="idea" rows={3} required maxLength={2000} /></label>
            <label className="field">Type<select name="category" defaultValue="productivity">{Object.entries(SUG_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">Where (line, machine, area)<input name="area" maxLength={120} /></label>
            <label className="field full">Colleagues who worked on it with you <span className="help">optional</span><input name="team" maxLength={300} /></label>
          </ActionForm>
          {(mine?.length ?? 0) > 0 && <><h3>My ideas</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{mine!.map((s) => <li key={s.id} style={{ marginBottom: 6 }}><b>{s.title}</b> <span className="muted">{s.ref}</span>{" "}
              <span className={`badge ${s.status === "implemented" ? "ok" : s.status === "not_taken" ? "" : "warn"}`}>{SUG_STATUS[s.status]}</span>
              {s.saving_per_year ? <span className="muted"> · saves {inr(Number(s.saving_per_year))} a year</span> : null}
              {s.review_note && <div className="muted" style={{ fontSize: 13 }}>{s.review_note}</div>}</li>)}</ul></>}
        </div>
        <div className="card">
          <h2>Thank a colleague</h2>
          <ActionForm action={thankColleague} submitLabel="Put it on the wall" className="formgrid" resetOnSuccess>
            <label className="field full">Who<select name="employee_id" required defaultValue=""><option value="" disabled>Choose…</option>
              {all.filter((x) => x.id !== me).map((x) => <option key={x.id} value={x.id}>{x.name}{x.department ? ` — ${x.department}` : ""}</option>)}</select></label>
            <label className="field full">For<select name="category" required defaultValue="helping">{Object.entries(REC_CATEGORIES).filter(([k]) => k !== "employee_of_month").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field full">Your thanks<textarea name="message" rows={2} required maxLength={1000} placeholder="e.g. Thank you for covering my machine when I was called to the office." /></label>
          </ActionForm>
          {myRecs.length > 0 && <><h3>Thanks you received</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{myRecs.map((r) => <li key={r.id}><span className="badge ok">{REC_CATEGORIES[r.category]}{r.month ? ` · ${monthName(r.month)}` : ""}</span> {r.message} <span className="muted">— {r.given_by_name ?? "—"}</span></li>)}</ul></>}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Recognition wall</h2>
          {!(wall?.length) ? <Empty>Nothing yet.</Empty> : <ul style={{ margin: 0, paddingLeft: 18 }}>{wall!.slice(0, 15).map((r) => <li key={r.id} style={{ marginBottom: 6 }}>
            <b>{names.get(r.employee_id)?.name ?? "—"}</b> <span className={`badge${r.category === "employee_of_month" ? " ok" : ""}`}>{REC_CATEGORIES[r.category]}{r.month ? ` · ${monthName(r.month)}` : ""}</span> {r.message}
            <span className="muted" style={{ fontSize: 12 }}> — {r.kind === "auto" ? "Kaizen" : r.given_by_name}</span></li>)}</ul>}
        </div>
        <div className="card">
          <h2>Kaizen board</h2>
          {!(board?.length) ? <Empty>No idea implemented yet — yours could be the first.</Empty> : <ul style={{ margin: 0, paddingLeft: 18 }}>{board!.map((k) => <li key={k.id} style={{ marginBottom: 6 }}>
            <b>{k.title}</b> — {names.get(k.employee_id)?.name ?? ""}<div className="muted" style={{ fontSize: 13 }}>{k.benefit}{k.saving_per_year ? ` · saves ${inr(Number(k.saving_per_year))} a year` : ""}</div></li>)}</ul>}
        </div>
      </div>
    </AppShell>
  );
}
