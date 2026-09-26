import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime, Empty } from "@/components/ui";
import { EVENT_LABELS, type NotificationEvent } from "@/lib/notify/templates";

export const metadata = { title: "Messages sent" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ status?: string; channel?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { status = "", channel = "" } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id,event,channel,recipient,subject,status,error,created_at,related_id").order("created_at", { ascending: false }).limit(300);
  if (status) q = q.eq("status", status);
  if (channel) q = q.eq("channel", channel);
  const { data: rows } = await q;

  const tone = (s: string) => (s === "sent" || s === "delivered" || s === "read" ? "ok" : s === "failed" ? "danger" : s === "skipped" ? "warn" : "");
  return (
    <AppShell session={session} active="/app/notifications">
      <div className="pagehead"><div><h1>Messages sent</h1><p>Every email and WhatsApp message the system sent, with its delivery status.</p></div></div>
      <form className="toolbar" method="get">
        <select name="channel" defaultValue={channel}><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select>
        <select name="status" defaultValue={status}><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Not configured</option></select>
        <button className="btn secondary">Filter</button>
      </form>
      <div className="tablewrap">
        {rows?.length ? (
          <table>
            <thead><tr><th>When</th><th>Message</th><th>Channel</th><th>To</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(n.created_at)}</td>
                  <td>{EVENT_LABELS[n.event as NotificationEvent] ?? n.event}{n.related_id && <> · <a href={p(`/app/employees/${n.related_id}`)}>employee</a></>}</td>
                  <td>{n.channel === "whatsapp" ? "WhatsApp" : "Email"}</td>
                  <td className="mono">{n.recipient}</td>
                  <td><span className={`badge ${tone(n.status)}`}>{n.status === "skipped" ? "not sent" : n.status}</span>{n.error && <div><small>{n.error}</small></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No messages yet.</Empty>}
      </div>
    </AppShell>
  );
}
