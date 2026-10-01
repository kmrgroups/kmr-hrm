import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { istToday } from "@/lib/attendance/time";
import { KINDS, STATUS, EMPLOYEE_KINDS, ppeFor, dueState, type PpeItem, type PpeIssue } from "@/lib/safety/rules";
import { myActionDone, reportSafety } from "./actions";

export const metadata = { title: "Safety" };
const dmy = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

export default async function MySafety() {
  const session = await requireSession();
  if (!session.user.employee_id) redirect("/account");
  const me = session.user.employee_id;
  const db = await createClient();
  const today = istToday();
  const [{ data: emp }, { data: mine }, { data: acts }, { data: items }, { data: issues }, { data: med }] = await Promise.all([
    db.from("employees").select("id,department_id").eq("id", me).single(),
    db.from("incidents").select("id,ref,kind,status,area,occurred_at").eq("reported_by_employee_id", me).order("occurred_at", { ascending: false }).limit(30),
    db.from("incident_actions").select("id,action,due_on,status,done_on").eq("owner_employee_id", me).order("due_on"),
    db.from("ppe_items").select("id,name,life_months,departments,for_all,active"),
    db.from("ppe_issues").select("employee_id,item_id,issued_on,next_due").eq("employee_id", me),
    db.from("medical_checks").select("kind,done_on,next_due").eq("employee_id", me).order("next_due", { ascending: false }).limit(5),
  ]);
  const ppe = emp ? ppeFor(emp, (items ?? []) as PpeItem[], (issues ?? []) as PpeIssue[], today) : [];
  const open = (acts ?? []).filter((a) => a.status === "open");

  return (
    <AppShell session={session} active="/me/safety">
      <div className="pagehead"><div><h1>Safety</h1><p>Saw something unsafe? Report it — before somebody gets hurt. It goes straight to the safety officer.</p></div></div>

      {open.length > 0 && <div className="card" style={{ borderTop: "3px solid var(--warn)" }}>
        <h2>Actions given to you</h2>
        {open.map((a) => <div key={a.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
          <b>{a.action}</b> <span className={`badge ${a.due_on < today ? "danger" : "warn"}`}>by {dmy(a.due_on)}</span>
          <ActionForm action={myActionDone} submitLabel="Mark done" className="inline" hidden={{ id: a.id }}><input name="done_note" maxLength={1000} required placeholder="What did you do?" style={{ minWidth: 260 }} /></ActionForm>
        </div>)}
      </div>}

      <div className="grid two">
        <div className="card">
          <h2>Report</h2>
          <ActionForm action={reportSafety} submitLabel="Send the report" pendingLabel="Sending…" className="stack" resetOnSuccess>
            <label className="field">What did you see<select name="kind" required defaultValue="near_miss">{EMPLOYEE_KINDS.map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}</select></label>
            <div className="muted" style={{ fontSize: 12 }}>Near miss: something nearly hurt someone. Unsafe act: someone working unsafely. Unsafe condition: something unsafe in the place (a leak, a missing guard, a blocked exit).</div>
            <label className="field">Where (line, machine, place)<input name="area" required maxLength={160} /></label>
            <label className="field">What did you see<textarea name="description" rows={3} required maxLength={3000} /></label>
            <label className="field">Photo <span className="help">optional</span><input type="file" name="photo" accept="image/*" capture="environment" /></label>
          </ActionForm>
        </div>
        <div className="card">
          <h2>My PPE</h2>
          {!ppe.length ? <Empty>No PPE listed for your department.</Empty> : <ul style={{ margin: 0, paddingLeft: 18 }}>{ppe.map((x) => <li key={x.item.id} style={{ marginBottom: 4 }}>
            <b>{x.item.name}</b> — {x.last ? `issued ${dmy(x.last.issued_on)}, replace by ${dmy(x.last.next_due)}` : "not issued yet"}{" "}
            {x.state !== "ok" && <span className={`badge ${x.state === "due_soon" ? "warn" : "danger"}`}>{x.state === "never" ? "ask stores" : x.state === "overdue" ? "due for replacement" : "due soon"}</span>}</li>)}</ul>}
          {(med?.length ?? 0) > 0 && <><h3 style={{ marginTop: 16 }}>Medical examination</h3>
            <p style={{ margin: 0 }}>Last {dmy(med![0]!.done_on)} · next due {dmy(med![0]!.next_due)} {dueState(med![0]!.next_due, today) === "overdue" && <span className="badge warn">HR will arrange it</span>}</p></>}
        </div>
      </div>

      <div className="card">
        <h2>My reports</h2>
        {!mine?.length ? <Empty>You have not reported anything yet.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table><tbody>{mine.map((i) => (
          <tr key={i.id}><td className="mono">{i.ref}</td><td>{KINDS[i.kind]}</td><td>{i.area ?? "—"}</td><td>{dmy(i.occurred_at)}</td><td><span className={`badge ${i.status === "closed" ? "ok" : "warn"}`}>{STATUS[i.status]}</span></td></tr>))}</tbody></table></div>}
      </div>
    </AppShell>
  );
}
