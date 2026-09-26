import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime, Empty } from "@/components/ui";

export const metadata = { title: "Audit trail" };

function diff(oldD: Record<string, unknown> | null, newD: Record<string, unknown> | null): string {
  if (!oldD || !newD) return "";
  const skip = new Set(["updated_at", "profile"]);
  return Object.keys(newD)
    .filter((k) => !skip.has(k) && JSON.stringify(oldD[k]) !== JSON.stringify(newD[k]))
    .map((k) => `${k}: ${String(oldD[k] ?? "—").slice(0, 30)} → ${String(newD[k] ?? "—").slice(0, 30)}`)
    .join("; ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const session = await requireRole(["hr_manager"]);
  const { entity = "" } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("id,action,entity,entity_id,actor_id,old_data,new_data,created_at").order("created_at", { ascending: false }).limit(300);
  if (entity) q = q.eq("entity", entity);
  const [{ data: rows }, { data: users }] = await Promise.all([q, supabase.from("app_users").select("id,full_name")]);
  const who = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  return (
    <AppShell session={session} active="/app/audit">
      <div className="pagehead"><div><h1>Audit trail</h1><p>Who changed what and when — kept for IATF 16949 / ISO 9001 evidence. Records cannot be edited.</p></div></div>
      <form className="toolbar" method="get">
        <select name="entity" defaultValue={entity}>
          <option value="">All records</option>
          {["employees", "employee_private", "employee_documents", "onboarding_invites", "id_cards", "app_users", "tenants", "notification_templates"].map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
        </select>
        <button className="btn secondary">Filter</button>
      </form>
      <div className="tablewrap">
        {rows?.length ? (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Change</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                  <td>{r.actor_id ? who.get(r.actor_id) ?? "User" : "System / employee link"}</td>
                  <td>{r.action}</td>
                  <td>{r.entity.replace(/_/g, " ")}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 420 }}>{diff(r.old_data, r.new_data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No records.</Empty>}
      </div>
    </AppShell>
  );
}
