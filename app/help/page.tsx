import { requireSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty, fmtDate, fmtDateTime } from "@/components/ui";
import { raiseTicket, replyToTicket } from "./actions";

export const metadata = { title: "Help & support" };
const LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", waiting_on_customer: "Waiting for you", resolved: "Resolved", closed: "Closed" };
const TONE: Record<string, string> = { open: "warn", in_progress: "info", waiting_on_customer: "warn", resolved: "ok", closed: "" };

export default async function Help() {
  const session = await requireSession();
  const { user, tenant } = session;
  const hr = hasRole(user, HR_ROLES);
  const db = createAdminClient().schema("console");
  // HR sees all of the company's tickets; everyone else sees their own
  let q = db.from("tickets").select("id,number,subject,status,priority,raised_by_name,created_at,updated_at,ticket_messages(author_kind,author_name,body,created_at)")
    .eq("product_code", "hrm").eq("product_ref", tenant.id).order("updated_at", { ascending: false }).limit(50);
  if (!hr) q = q.eq("raised_by_email", user.email);
  const [{ data: tickets }, { data: releases }] = await Promise.all([
    q, db.from("releases").select("version,released_on,notes").eq("product_code", "hrm").order("released_on", { ascending: false }).limit(8),
  ]);

  return (
    <AppShell session={session} active="/help">
      <div className="pagehead"><div><h1>Help &amp; support</h1><p>Ask KMR for help, report a problem, or suggest an improvement. Replies appear here.</p></div></div>
      <div className="grid two" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        <div className="stack">
          <div className="card">
            <h2>Raise a ticket</h2>
            <ActionForm action={raiseTicket} submitLabel="Send to KMR support" pendingLabel="Sending…" resetOnSuccess>
              <label className="field">Title<input name="subject" maxLength={150} placeholder="e.g. Punches from gate 2 are not showing" required /></label>
              <label className="field">What happened?<textarea name="body" rows={5} placeholder="What you did, what you expected, what you saw. Employee codes or dates help." required /></label>
              <label className="field">How urgent?<select name="priority" defaultValue="normal"><option value="low">Low — a question or idea</option><option value="normal">Normal</option><option value="high">High — blocking some work</option><option value="urgent">Urgent — nobody can work</option></select></label>
            </ActionForm>
          </div>
          <div className="card">
            <h2>{hr ? "Your company's tickets" : "Your tickets"}</h2>
            {tickets?.length ? (
              <div className="stack">
                {tickets.map((t) => {
                  const msgs = [...((t.ticket_messages as { author_kind: string; author_name: string; body: string; created_at: string }[]) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
                  return (
                    <details key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                      <summary style={{ cursor: "pointer" }}><b>{t.subject}</b> <span className={`badge ${TONE[t.status]}`}>{LABEL[t.status]}</span><br /><small className="muted"><span className="mono">{t.number}</span> · {t.raised_by_name} · {fmtDateTime(t.created_at)}</small></summary>
                      <div className="stack" style={{ marginTop: 10 }}>
                        {msgs.map((m, i) => (
                          <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: m.author_kind === "kmr" ? "rgba(11,42,111,.06)" : "var(--surface-2)" }}>
                            <small><b>{m.author_kind === "kmr" ? `${m.author_name} · KMR support` : m.author_name}</b> · {fmtDateTime(m.created_at)}</small>
                            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.body}</div>
                          </div>
                        ))}
                        {t.status !== "closed" && <ActionForm action={replyToTicket} submitLabel="Reply" variant="secondary" hidden={{ id: t.id }} resetOnSuccess><textarea name="body" rows={2} placeholder="Add a reply…" /></ActionForm>}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : <Empty>No tickets yet.</Empty>}
          </div>
        </div>
        <div className="card">
          <h2>What&apos;s new</h2>
          {releases?.length ? (
            <ul className="timeline">{releases.map((r) => <li key={r.version}><span><b className="mono">v{r.version}</b> — {r.notes}</span><small>{fmtDate(r.released_on)}</small></li>)}</ul>
          ) : <p className="muted">Release notes will appear here.</p>}
        </div>
      </div>
    </AppShell>
  );
}
