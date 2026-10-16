import { p } from "@/lib/base-path";

/** The four steps of a payroll month, shown on every payroll screen so the next step is always obvious. */
export function PayrollSteps({ current, month }: { current: 1 | 2 | 3 | 4; month?: string }) {
  const q = month ? `?month=${month}` : "";
  const steps: [string, string, string | null][] = [
    ["Check attendance", "Biometric punches are read in", `/app/payroll${q}`],
    ["Review & add", "Bonus, deductions, tax, loss of pay", month ? `/app/payroll/${month}` : null],
    ["Finalise", "Payslips go live for employees", month ? `/app/payroll/${month}#finalise` : null],
    ["Pay & file", "Bank file, PF, ESI, payslip e-mail", month ? `/app/payroll/${month}#files` : null],
  ];
  return (
    <ol className="psteps" aria-label="Payroll steps">
      {steps.map(([t, d, href], i) => {
        const n = i + 1, cls = n < current ? "done" : n === current ? "cur" : "";
        const body = <><span className="n">{n < current ? "✓" : n}</span><span><b>{t}</b><small>{d}</small></span></>;
        return <li key={t} className={cls} aria-current={n === current ? "step" : undefined}>{href && n !== current ? <a href={p(href)}>{body}</a> : <span>{body}</span>}</li>;
      })}
    </ol>
  );
}
