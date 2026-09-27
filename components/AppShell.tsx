import type { Session } from "@/lib/auth";
import { hasRole } from "@/lib/auth";
import { logoUrl } from "@/lib/tenant";
import { ROLE_LABELS } from "@/lib/types";
import { signOut } from "@/app/login/actions";
import { Icon, type IconName } from "./Icon";
import { Flash } from "./Flash";
import { readFlash } from "@/lib/flash";
import { p } from "@/lib/base-path";

interface NavItem { href: string; label: string; icon: IconName; show: boolean }

export async function AppShell({ session, active, children }: { session: Session; active: string; children: React.ReactNode }) {
  const { user, tenant } = session;
  const hr = hasRole(user, ["hr_manager", "hr_executive"]);
  const admin = hasRole(user, []); // company_admin / platform_admin
  const staff = hr || hasRole(user, ["payroll", "manager"]);

  const main: NavItem[] = [
    { href: "/app", label: "Dashboard", icon: "home", show: staff },
    { href: "/app/employees", label: "Employees", icon: "users", show: staff },
    { href: "/app/attendance", label: "Attendance", icon: "clock", show: staff },
    { href: "/app/leave", label: "Leave", icon: "calendar", show: hr || hasRole(user, ["payroll"]) },
    { href: "/app/approvals", label: "Approvals", icon: "checklist", show: hr || hasRole(user, ["manager"]) },
    { href: "/app/onboarding", label: "Onboarding", icon: "inbox", show: hr },
    { href: "/app/id-cards", label: "ID cards", icon: "card", show: hr },
    { href: "/app/notifications", label: "Messages sent", icon: "bell", show: hr },
  ];
  const settings: NavItem[] = [
    { href: "/app/settings", label: "Company & branding", icon: "building", show: admin },
    { href: "/app/settings/masters", label: "Plants & departments", icon: "layers", show: hr },
    { href: "/app/settings/attendance", label: "Attendance setup", icon: "clock", show: hr },
    { href: "/app/settings/leave", label: "Leave policy", icon: "calendar", show: hr },
    { href: "/app/settings/users", label: "Users & roles", icon: "shield", show: admin },
    { href: "/app/settings/templates", label: "Message templates", icon: "mail", show: hasRole(user, ["hr_manager"]) },
    { href: "/app/audit", label: "Audit trail", icon: "list", show: hasRole(user, ["hr_manager"]) },
  ];
  const personal: NavItem[] = [
    { href: "/me", label: "My portal", icon: "user", show: !!user.employee_id },
    { href: "/me/attendance", label: "My attendance", icon: "clock", show: !!user.employee_id },
    { href: "/me/leave", label: "My leave", icon: "calendar", show: !!user.employee_id },
    { href: "/account", label: "My account", icon: "key", show: true },
  ];

  const isActive = (href: string) => active === href;
  const logo = logoUrl(tenant);
  const render = (items: NavItem[]) =>
    items.filter((i) => i.show).map((i) => (
      <a key={i.href} href={p(i.href)} className={`nav${isActive(i.href) ? " active" : ""}`}>
        <Icon name={i.icon} /> {i.label}
      </a>
    ));

  return (
    <div className="shell">
      <input type="checkbox" id="navtoggle" aria-hidden="true" />
      <div className="topbar">
        <span className="t">{tenant.name}</span>
        <label htmlFor="navtoggle" aria-label="Menu">☰</label>
      </div>
      <aside className="sidebar">
        <div className="brand">
          {logo ? <img src={logo} alt="" /> : null}
          <span>{logo ? "" : tenant.name}</span>
        </div>
        <nav>
          {render(main)}
          {settings.some((s) => s.show) && <div className="navlabel">Settings</div>}
          {render(settings)}
          <div className="navlabel">Me</div>
          {render(personal)}
        </nav>
        <div className="who">
          <div style={{ fontWeight: 600 }}>{user.full_name}</div>
          <div style={{ opacity: 0.75, marginBottom: 6 }}>{ROLE_LABELS[user.role]}</div>
          <form action={signOut}><button>Sign out</button></form>
        </div>
      </aside>
      <main className="main"><Flash msg={await readFlash()} />{children}</main>
    </div>
  );
}
