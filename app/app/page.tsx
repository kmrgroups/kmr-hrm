import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { fullName, fmtDateTime, Empty, one } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const session = await requireRole([...HR_ROLES, "manager", "payroll"]);
  const supabase = await createClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const base = () => supabase.from("employees").select("id", { count: "exact", head: true });
  const [active, inProgress, review, joined, sent, failed] = await Promise.all([
    count(base().eq("status", "active")),
    count(base().in("status", ["invited", "onboarding", "sent_back"])),
    count(base().eq("status", "submitted")),
    count(base().eq("status", "active").gte("date_of_joining", monthStart)),
    count(supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", weekAgo)),
    count(supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", weekAgo)),
  ]);

  const [{ data: toReview }, { data: byDept }, { data: activity }] = await Promise.all([
    supabase.from("employees").select("id,first_name,last_name,updated_at,designation:designations(name)").eq("status", "submitted").order("updated_at").limit(8),
    supabase.from("employees").select("department:departments(name)").eq("status", "active").limit(5000),
    supabase.from("audit_log").select("id,action,entity,entity_id,created_at").like("action", "%.%").order("created_at", { ascending: false }).limit(10),
  ]);

  const deptCounts = new Map<string, number>();
  for (const r of byDept ?? []) {
    const n = one(r.department)?.name ?? "Unassigned";
    deptCounts.set(n, (deptCounts.get(n) ?? 0) + 1);
  }
  const depts = [...deptCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxDept = Math.max(1, ...depts.map((d) => d[1]));
  const hr = hasRole(session.user, HR_ROLES);

  return (
    <AppShell session={session} active="/app">
      <div className="pagehead">
        <div>
          <h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {session.user.full_name.split(" ")[0]}</h1>
          <p>{session.tenant.legal_name || session.tenant.name}</p>
        </div>
        {hr && <a className="btn" href={p("/app/employees/new")}><Icon name="plus" /> Add new joiner</a>}
      </div>

      <div className="grid four">
        <a className="card stat accent" href={p("/app/employees?status=active")}><div className="label">Active employees</div><div className="value">{active}</div><div className="hint">{joined} joined this month</div></a>
        <a className="card stat" href={p("/app/onboarding")}><div className="label">Onboarding in progress</div><div className="value">{inProgress}</div><div className="hint">Filling the form</div></a>
        <a className="card stat" href={p("/app/employees?status=submitted")}><div className="label">Awaiting HR review</div><div className="value" style={{ color: review ? "var(--warn)" : undefined }}>{review}</div><div className="hint">Submitted by new joiners</div></a>
        <a className="card stat" href={p("/app/notifications")}><div className="label">Messages sent (7 days)</div><div className="value">{sent}</div><div className="hint">{failed ? `${failed} failed` : "Email + WhatsApp"}</div></a>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Awaiting your review</h2>
          {toReview?.length ? (
            <ul className="timeline">
              {toReview.map((e) => (
                <li key={e.id}>
                  <span><a href={p(`/app/employees/${e.id}`)}><b>{fullName(e)}</b></a><br /><small>{one(e.designation)?.name ?? ""}</small></span>
                  <small>{fmtDateTime(e.updated_at)}</small>
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing to review.</Empty>}
        </div>
        <div className="card">
          <h2>Headcount by department</h2>
          {depts.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {depts.map(([name, n]) => (
                <div key={name}>
                  <div className="spread" style={{ fontSize: 13.5 }}><span>{name}</span><b style={{ fontVariantNumeric: "tabular-nums" }}>{n}</b></div>
                  <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4 }}>
                    <div style={{ width: `${(n / maxDept) * 100}%`, height: 8, background: "var(--brand)", borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty>No active employees yet.</Empty>}
        </div>
      </div>

      {hr && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Recent activity</h2>
          {activity?.length ? (
            <ul className="timeline">
              {activity.map((a) => (
                <li key={a.id}>
                  <span>{a.action.replace(/[._]/g, " ")}{a.entity === "employees" && a.entity_id ? <> · <a href={p(`/app/employees/${a.entity_id}`)}>open</a></> : null}</span>
                  <small>{fmtDateTime(a.created_at)}</small>
                </li>
              ))}
            </ul>
          ) : <Empty>No activity yet.</Empty>}
        </div>
      )}
    </AppShell>
  );
}
