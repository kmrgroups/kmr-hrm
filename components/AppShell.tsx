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
  const platform = (process.env.KMR_LICENCE_CHECK || "on").toLowerCase() !== "off";   // on the KMR platform: company, users and passwords live in KMR Apps

  const main: NavItem[] = [
    { href: "/app", label: "Dashboard", icon: "home", show: staff },
    { href: "/app/employees", label: "Employees", icon: "users", show: staff },
    { href: "/app/attendance", label: "Attendance", icon: "clock", show: staff },
    { href: "/app/leave", label: "Leave", icon: "calendar", show: hr || hasRole(user, ["payroll"]) },
    { href: "/app/payroll", label: "Payroll", icon: "card", show: hasRole(user, ["hr_manager", "payroll"]) },
    { href: "/app/approvals", label: "Approvals", icon: "checklist", show: hr || hasRole(user, ["manager"]) },
    { href: "/app/onboarding", label: "Onboarding", icon: "inbox", show: hr },
    { href: "/app/id-cards", label: "ID cards", icon: "card", show: hr },
    { href: "/app/notifications", label: "Messages sent", icon: "bell", show: hr },
  ];
  const settings: NavItem[] = [
    { href: "/app/settings", label: platform ? "HR settings" : "Company & branding", icon: "building", show: admin },
    { href: "/app/settings/masters", label: "Plants & departments", icon: "layers", show: hr },
    { href: "/app/settings/attendance", label: "Attendance setup", icon: "clock", show: hr },
    { href: "/app/settings/leave", label: "Leave policy", icon: "calendar", show: hr },
    { href: "/app/settings/data", label: "Data & backups", icon: "download", show: hasRole(user, ["hr_manager"]) },
    { href: "/app/settings/users", label: "Users & roles", icon: "shield", show: !platform && admin },
    { href: "/app/settings/email", label: "Company email", icon: "send", show: hasRole(user, ["hr_manager"]) },
    { href: "/app/settings/templates", label: "Message templates", icon: "mail", show: hasRole(user, ["hr_manager"]) },
    { href: "/app/audit", label: "Audit trail", icon: "list", show: hasRole(user, ["hr_manager"]) },
  ];
  const personal: NavItem[] = [
    { href: "/me", label: "My portal", icon: "user", show: !!user.employee_id },
    { href: "/me/attendance", label: "My attendance", icon: "clock", show: !!user.employee_id },
    { href: "/me/leave", label: "My leave", icon: "calendar", show: !!user.employee_id },
    { href: "/me/payslips", label: "My payslips", icon: "download", show: !!user.employee_id },
    { href: "/account", label: "My account", icon: "key", show: !platform },
    { href: "/help", label: "Help & support", icon: "inbox", show: true },
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
        {/* standard KMR tool header: logo · tool name · company name (same as every KMR tool) */}
        <div className="brand kmr-tool-head">
          {logo ? <img src={logo} alt="" /> : <span className="kmr-tool-initials">{tenant.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")}</span>}
          <div className="kmr-tool-text"><b>HRM Suite</b><small>{tenant.name}</small></div>
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
      <main className="main">
        {process.env.HRM_DEMO_EMAIL && user.email === process.env.HRM_DEMO_EMAIL.toLowerCase() && (
          <div className="alert info" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span><b>Sample data only.</b> You are exploring the HRM with a demo company — nothing here is saved for your company.</span>
            <a className="btn small" href="/it/?buy=hrm#pilot">Use my company&apos;s data — buy subscription</a>
          </div>
        )}<Flash msg={await readFlash()} />{children}</main>
    </div>
  );
}
