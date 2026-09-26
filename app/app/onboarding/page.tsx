import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { fullName, fmtDateTime, Empty, one } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Onboarding" };

const COLUMNS = [
  { status: ["invited"], title: "Link sent", hint: "Not opened yet" },
  { status: ["onboarding"], title: "Filling the form", hint: "In progress" },
  { status: ["sent_back"], title: "Sent back", hint: "Correcting details" },
  { status: ["submitted"], title: "Awaiting review", hint: "Ready for HR" },
];

export default async function OnboardingPage() {
  const session = await requireRole(HR_ROLES);
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("employees")
    .select("id,first_name,last_name,status,updated_at,created_at,designation:designations(name),onboarding_invites(status,expires_at,created_at)")
    .in("status", ["invited", "onboarding", "sent_back", "submitted"])
    .order("updated_at", { ascending: false })
    .limit(300);

  const days = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);

  return (
    <AppShell session={session} active="/app/onboarding">
      <div className="pagehead">
        <div><h1>Onboarding</h1><p>Every new joiner from link sent to HR approval.</p></div>
        <a className="btn" href={p("/app/employees/new")}><Icon name="plus" /> Add new joiner</a>
      </div>
      <div className="grid four">
        {COLUMNS.map((col) => {
          const items = (rows ?? []).filter((r) => col.status.includes(r.status));
          return (
            <div key={col.title} className="card" style={{ padding: 14 }}>
              <div className="spread"><h3 style={{ margin: 0 }}>{col.title}</h3><span className="badge">{items.length}</span></div>
              <small>{col.hint}</small>
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                {items.length ? items.map((e) => {
                  const invites = (e.onboarding_invites as { status: string; expires_at: string; created_at: string }[]) ?? [];
                  const live = invites.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                  const expired = live && new Date(live.expires_at) < new Date() && e.status !== "submitted";
                  return (
                    <a key={e.id} href={p(`/app/employees/${e.id}`)} className="docrow" style={{ color: "inherit" }}>
                      <span>
                        <b>{fullName(e)}</b>
                        <div className="sub" style={{ fontSize: 12.5, color: "var(--muted)" }}>{one(e.designation)?.name ?? ""}</div>
                        <small>{e.status === "submitted" ? `Submitted ${fmtDateTime(e.updated_at)}` : `${days(e.created_at)} day(s) since added`}</small>
                      </span>
                      {expired && <span className="badge danger">Link expired</span>}
                    </a>
                  );
                }) : <Empty>None</Empty>}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
