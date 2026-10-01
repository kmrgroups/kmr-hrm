import { notFound } from "next/navigation";
import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { istToday } from "@/lib/attendance/time";
import { SUG_CATEGORIES, SUG_NEXT, SUG_STATUS } from "@/lib/engage/rules";
import { namesOf } from "@/lib/engage/data";
import { EngageTabs, inr, when, dayLabel } from "../../ui";
import { reviewSuggestion } from "../../actions";

export const metadata = { title: "Suggestion" };

export default async function SuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: s } = await db.from("suggestions").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: canEdit } = await db.from("employees").select("id").eq("id", s.employee_id).maybeSingle();   // HR, or the person's manager
  const names = await namesOf(session.tenant.id, [s.employee_id]);
  const who = names.get(s.employee_id);
  const next = SUG_NEXT[s.status] ?? [];
  const age = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 864e5);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>{s.title}</h1>
        <p>{s.ref} · {SUG_CATEGORIES[s.category]} · from <b>{who?.name ?? "—"}</b>{who?.department ? ` (${who.department})` : ""} · {when(s.created_at)}{s.sample ? " · Sample" : ""}</p></div>
        <span className={`badge ${s.status === "implemented" ? "ok" : s.status === "not_taken" ? "" : "warn"}`} style={{ fontSize: 14 }}>{SUG_STATUS[s.status]}</span></div>
      <EngageTabs active="sug" hr={hr} />
      {["submitted", "under_review"].includes(s.status) && age > 7 && <div className="alert warn" style={{ marginBottom: 16 }}>Waiting {age} days. Please give an answer — even “not now, and why” keeps people suggesting.</div>}

      <div className="grid two">
        <div className="card">
          <h2>The idea</h2>
          <p><b>Problem today</b><br />{s.problem}</p>
          <p><b>What to change</b><br />{s.idea}</p>
          {s.area && <p><b>Where</b><br />{s.area}</p>}
          {s.team && <p><b>Worked on it with</b><br />{s.team}</p>}
          {s.review_note && <p><b>Reviewer&apos;s note</b><br />{s.review_note}</p>}
          {s.status === "implemented" && <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <p><b>What it gave</b><br />{s.benefit}</p>
            {(s.before_text || s.after_text) && <div className="grid two"><p><b>Before</b><br />{s.before_text ?? "—"}</p><p><b>After</b><br />{s.after_text ?? "—"}</p></div>}
            <p className="muted">Implemented {dayLabel(s.implemented_on)}{s.saving_per_year ? ` · saves ${inr(Number(s.saving_per_year))} a year` : ""}{s.reviewed_by_name ? ` · ${s.reviewed_by_name}` : ""}</p></div>}
        </div>
        <div className="card">
          <h2>Review</h2>
          {!canEdit ? <p className="muted">Only HR or {who?.name ?? "the person"}&apos;s manager reviews this idea.</p> : (
            <ActionForm action={reviewSuggestion} submitLabel="Save the decision" className="formgrid" hidden={{ id }}>
              <label className="field full">Move it to<select name="status" defaultValue="">
                <option value="">Keep as “{SUG_STATUS[s.status]}”</option>{next.map((k) => <option key={k} value={k}>{SUG_STATUS[k]}</option>)}</select></label>
              <label className="field full">Note to {who?.name?.split(" ")[0] ?? "the person"} <span className="help">needed when not taken up; they read it</span><textarea name="review_note" rows={3} defaultValue={s.review_note ?? ""} maxLength={1000} /></label>
              {(s.status === "accepted" || s.status === "implemented" || next.includes("implemented")) && <>
                <div className="full muted" style={{ fontSize: 13 }}>When it is implemented:</div>
                <label className="field full">What it gave <span className="help">quality, safety, time, cost …</span><textarea name="benefit" rows={2} defaultValue={s.benefit ?? ""} maxLength={1000} /></label>
                <label className="field">Saving (₹ a year) <span className="help">if it saves money</span><input name="saving_per_year" inputMode="numeric" defaultValue={s.saving_per_year ?? ""} /></label>
                <label className="field">Implemented on<input type="date" name="implemented_on" defaultValue={s.implemented_on ?? istToday()} /></label>
                <label className="field">Before<textarea name="before_text" rows={2} defaultValue={s.before_text ?? ""} maxLength={1000} /></label>
                <label className="field">After<textarea name="after_text" rows={2} defaultValue={s.after_text ?? ""} maxLength={1000} /></label>
              </>}
            </ActionForm>)}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>The person gets an e-mail when it is accepted, implemented, put on hold or not taken up. Implemented ideas go on the Kaizen board and the author is recognised on the wall.</p>
        </div>
      </div>
    </AppShell>
  );
}
