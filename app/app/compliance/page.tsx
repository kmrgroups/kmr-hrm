import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { addDaysIso, daysBetween, onTimeRate, periodLabel, taskState, STATE_LABEL, STATE_TONE } from "@/lib/compliance/rules";
import { ensureTasks } from "@/lib/compliance/service";
import { people } from "@/app/app/qms/data";
import { CompTabs, dmy } from "./ui";

export const metadata = { title: "Policies & compliance" };

type TaskRow = { id: string; due_on: string; status: string; done_on: string | null; item: { title: string; frequency: string; kind: string; remind_days: number; code: string } };

export default async function ComplianceHome() {
  const session = await requireRole([...HR_ROLES, "payroll"]);
  const hr = hasRole(session.user, HR_ROLES);
  const today = istToday();
  await ensureTasks(session.tenant.id, today);
  const db = await createClient();
  const [tasks, { data: lic }, docs, ppl] = await Promise.all([
    fetchAll<TaskRow>((a, b) => db.from("compliance_tasks").select("id,due_on,status,done_on,item:compliance_items!inner(title,frequency,kind,remind_days,code)").gte("due_on", addDaysIso(today, -365)).lte("due_on", addDaysIso(today, 60)).order("due_on").range(a, b) as never),
    db.from("compliance_items").select("id,title,licence_no,valid_until").eq("kind", "licence").eq("active", true).order("valid_until", { nullsFirst: false }),
    hr ? db.from("documents").select("id,doc_no,title,kind,needs_ack,employee_access,audience,department_id,plant_id,document_versions(id,revision,status,review_due,document_acks(count))").eq("active", true).then((r) => r.data ?? []) : Promise.resolve([]),
    hr ? people(db) : Promise.resolve([]),
  ]);
  const st = tasks.map((t) => ({ ...t, state: taskState(t, today, t.item.remind_days) }));
  const overdue = st.filter((t) => t.state === "overdue"), soon = st.filter((t) => t.status === "open" && t.due_on >= today && t.due_on <= addDaysIso(today, 30));
  const rate = onTimeRate(tasks, today);
  const lic90 = (lic ?? []).filter((l) => l.valid_until && l.valid_until <= addDaysIso(today, 90));
  const noDate = (lic ?? []).filter((l) => !l.valid_until);
  // documents
  const cur = docs.map((d) => { const vs = (d.document_versions ?? []) as { id: string; revision: number; status: string; review_due: string | null; document_acks: { count: number }[] }[];
    return { ...d, cur: vs.find((v) => v.status === "approved"), draft: vs.find((v) => v.status === "draft") }; });
  const reviewLate = cur.filter((d) => d.cur?.review_due && d.cur.review_due < today), reviewSoon = cur.filter((d) => d.cur?.review_due && d.cur.review_due >= today && d.cur.review_due <= addDaysIso(today, 30));
  const drafts = cur.filter((d) => d.draft);
  const policies = cur.filter((d) => d.needs_ack && d.employee_access && d.cur);
  const audOf = (d: { audience: string; department_id: string | null; plant_id: string | null }) => ppl.filter((e) => d.audience === "all" || (d.audience === "department" ? e.department_id === d.department_id : e.plant_id === d.plant_id)).length;
  const ackRows = policies.map((d) => { const n = audOf(d), a = d.cur!.document_acks?.[0]?.count ?? 0; return { d, n, a, pct: n ? Math.round((a / n) * 100) : 100 }; });

  const Stat = ({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href: string; tone?: string }) => (
    <a className="card stat" href={p(href)} style={{ textDecoration: "none", color: "inherit", borderTop: tone ? `3px solid var(--${tone})` : undefined }}><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</a>);

  return (
    <AppShell session={session} active="/app/compliance">
      <div className="pagehead"><div><h1>Policies &amp; compliance</h1>
        <p>Statutory payments, returns and licences on time, with proof; policies and procedures under control (ISO 9001 7.5) and read by the people they are for.</p></div>
        {hr && <a className="btn secondary" href={p("/api/compliance/master-list")}>Master list of documents (PDF)</a>}</div>
      <CompTabs active="home" hr={hr} />

      <div className="grid four" style={{ marginBottom: 16 }}>
        <Stat label="Overdue" value={overdue.length} hint={overdue.length ? "statutory items past their due date" : "nothing overdue"} href="/app/compliance/register" tone={overdue.length ? "danger" : "ok"} />
        <Stat label="Due in the next 30 days" value={soon.length} hint={soon[0] ? `next: ${soon[0].item.title} on ${dmy(soon[0].due_on)}` : ""} href="/app/compliance/register" />
        <Stat label="On time (last 12 months)" value={rate != null ? `${rate}%` : "—"} hint="done on or before the due date" href="/app/compliance/register?s=done" tone={rate != null && rate < 95 ? "warn" : undefined} />
        <Stat label="Licences to renew (90 days)" value={lic90.length} hint={noDate.length ? `${noDate.length} licence${noDate.length === 1 ? "" : "s"} without a valid-until date` : "all licences dated"} href="/app/compliance/items" tone={lic90.length ? "warn" : undefined} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>To do</h2>
          {!overdue.length && !soon.length ? <Empty>Nothing due in the next 30 days.</Empty> : (
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{[...overdue, ...soon].slice(0, 15).map((t) => (
              <tr key={t.id}><td><b>{t.item.title}</b><div className="muted" style={{ fontSize: 12 }}>{periodLabel(t.item, t.due_on)}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{dmy(t.due_on)}<div className="muted" style={{ fontSize: 12 }}>{t.due_on < today ? `${daysBetween(t.due_on, today)} days late` : t.due_on === today ? "today" : `in ${daysBetween(today, t.due_on)} days`}</div></td>
                <td><span className={`badge ${STATE_TONE[t.state]}`}>{STATE_LABEL[t.state]}</span></td></tr>))}</tbody></table></div>)}
          <p style={{ marginBottom: 0 }}><a href={p("/app/compliance/register")}>Open the register ›</a></p>
        </div>
        <div className="card">
          <h2>Licences</h2>
          {!lic?.length ? <Empty>No licences in the list.</Empty> : (
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{lic.map((l) => { const left = l.valid_until ? daysBetween(today, l.valid_until) : null; return (
              <tr key={l.id}><td>{l.title}<div className="muted" style={{ fontSize: 12 }}>{l.licence_no ?? "no. not entered"}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{l.valid_until ? <>valid until {dmy(l.valid_until)}<div className={`badge ${left! < 0 ? "danger" : left! <= 90 ? "warn" : "ok"}`} style={{ fontSize: 11 }}>{left! < 0 ? "expired" : `${left} days left`}</div></> : <span className="muted">date not entered</span>}</td></tr>); })}</tbody></table></div>)}
        </div>
      </div>

      {hr && <div className="grid two">
        <div className="card">
          <h2>Documents</h2>
          <p style={{ marginTop: 0 }}>{cur.filter((d) => d.cur).length} documents in use · {drafts.length} draft revision{drafts.length === 1 ? "" : "s"} waiting for approval</p>
          {reviewLate.length + reviewSoon.length + drafts.length === 0 ? <Empty>All documents are approved and within their review dates.</Empty> :
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {reviewLate.map((d) => <li key={d.id}><span className="badge danger">Review overdue</span> <a href={p(`/app/compliance/documents/${d.id}`)}>{d.doc_no} {d.title}</a> — due {dmy(d.cur!.review_due)}</li>)}
              {reviewSoon.map((d) => <li key={d.id}><span className="badge warn">Review due</span> <a href={p(`/app/compliance/documents/${d.id}`)}>{d.doc_no} {d.title}</a> — {dmy(d.cur!.review_due)}</li>)}
              {drafts.map((d) => <li key={`${d.id}d`}><span className="badge">Draft rev {d.draft!.revision}</span> <a href={p(`/app/compliance/documents/${d.id}`)}>{d.doc_no} {d.title}</a> — to approve</li>)}
            </ul>}
        </div>
        <div className="card">
          <h2>Policies read and acknowledged</h2>
          {!ackRows.length ? <Empty>No policy asks people to acknowledge it yet.</Empty> :
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{ackRows.map(({ d, n, a, pct }) => (
              <tr key={d.id}><td><a href={p(`/app/compliance/documents/${d.id}`)}>{d.title}</a><div className="muted" style={{ fontSize: 12 }}>{d.doc_no} rev {d.cur!.revision}</div></td>
                <td className="num">{a} / {n}</td><td><span className={`badge ${pct >= 90 ? "ok" : pct >= 60 ? "warn" : "danger"}`}>{pct}%</span></td></tr>))}</tbody></table></div>}
        </div>
      </div>}
      <p className="muted" style={{ fontSize: 12 }}>The compliance list starts with common Karnataka items. Due dates differ by state and change from time to time — check them with your consultant and correct them under “What we must comply with”.</p>
    </AppShell>
  );
}
