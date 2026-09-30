import { p } from "@/lib/base-path";

/** Tabs across the payroll screens */
export function PayrollTabs({ active }: { active: "runs" | "salaries" | "loans" | "settings" }) {
  const t: [string, string, string][] = [["runs", "Monthly payroll", "/app/payroll"], ["salaries", "Salaries", "/app/payroll/salaries"], ["loans", "Loans & advances", "/app/payroll/loans"], ["settings", "Payroll settings", "/app/settings/payroll"]];
  return <div className="tabs" style={{ marginBottom: 16 }}>{t.map(([k, label, href]) => <a key={k} href={p(href)} className={k === active ? "active" : ""}>{label}</a>)}</div>;
}
