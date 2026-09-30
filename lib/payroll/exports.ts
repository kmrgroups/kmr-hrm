import type { Line } from "./service";

// Files for the bank, EPFO, ESIC and the accounts team. CSV opens directly in Excel.
const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
const amt = (l: Line, list: "earnings" | "deductions" | "employer", code: string) => (l[list] as { code: string; amount: number }[]).filter((x) => x.code === code).reduce((s, x) => s + x.amount, 0);

/** Salary register: one row per employee with every earning and deduction as its own column. */
export function registerCsv(lines: Line[]) {
  const eCols = [...new Map(lines.flatMap((l) => l.earnings.map((e) => [e.code === "ADJ" ? `ADJ:${e.name}` : e.code, e.code === "ADJ" ? e.name : e.name.replace(/ \(.*\)$/, "")] as const))).entries()];
  const dCols = [...new Map(lines.flatMap((l) => l.deductions.map((d) => [d.code === "ADJ" ? `ADJ:${d.name}` : d.code, d.code === "ADJ" ? d.name : d.name.replace(/ \(.*\)$/, "")] as const))).entries()];
  const val = (list: { code: string; name: string; amount: number }[], key: string) => list.filter((x) => (x.code === "ADJ" ? `ADJ:${x.name}` : x.code) === key).reduce((s, x) => s + x.amount, 0);
  const rows: unknown[][] = [["Code", "Name", "Department", "Designation", "Days", "Paid days", "LOP", "OT hours", ...eCols.map(([, n]) => n), "Gross", ...dCols.map(([, n]) => n), "Total deductions", "Net pay",
    "Employer PF", "Employer ESI", "PF wage", "ESI wage", "Bank", "Account", "IFSC"]];
  for (const l of lines) rows.push([l.info.code, l.info.name, l.info.department, l.info.designation, l.days_in_month, l.paid_days, l.lop_days, l.ot_hours,
    ...eCols.map(([k]) => val(l.earnings, k)), l.gross, ...dCols.map(([k]) => val(l.deductions, k)), l.total_deductions, l.net_pay,
    amt(l, "employer", "EPS") + amt(l, "employer", "EPF_ER"), amt(l, "employer", "ESI_ER"), l.pf_wage, l.esi_wage, l.info.bank, l.info.account, l.info.ifsc]);
  rows.push(["", "TOTAL", "", "", "", "", "", "", ...eCols.map(([k]) => lines.reduce((s, l) => s + val(l.earnings, k), 0)), lines.reduce((s, l) => s + Number(l.gross), 0),
    ...dCols.map(([k]) => lines.reduce((s, l) => s + val(l.deductions, k), 0)), lines.reduce((s, l) => s + Number(l.total_deductions), 0), lines.reduce((s, l) => s + Number(l.net_pay), 0)]);
  return csv(rows);
}

/** Bank transfer list: name, account, IFSC, amount — the columns every bank's bulk-payment upload asks for. */
export function bankCsv(lines: Line[], month: string) {
  const rows: unknown[][] = [["Beneficiary name", "Account number", "IFSC", "Amount", "Narration", "Employee code", "Email"]];
  for (const l of lines.filter((l) => Number(l.net_pay) > 0)) rows.push([l.info.holder || l.info.name, l.info.account ? `'${l.info.account}` : "MISSING", l.info.ifsc ?? "MISSING", Number(l.net_pay).toFixed(2), `Salary ${month}`, l.info.code, l.info.email]);
  return csv(rows);
}

/** EPFO ECR 2.0 text file (upload in the employer portal): one line per member, fields joined by #~#. */
export function ecrText(lines: Line[]) {
  return lines.filter((l) => Number(l.pf_wage) > 0).map((l) => {
    const epf = amt(l, "deductions", "PF"), eps = amt(l, "employer", "EPS");
    const epsWage = Math.round(Number(l.info.eps_wage ?? 0));
    // UAN, name, gross wages, EPF wages, EPS wages, EDLI wages, EPF (employee), EPS (employer), EPF-EPS difference (employer), NCP days, refund of advances
    return [l.info.uan ?? "", (l.info.name ?? "").toUpperCase(), Math.round(Number(l.gross)), Math.round(Number(l.pf_wage)), epsWage, epsWage,
      epf, eps, Math.max(0, epf - eps), Math.round(Number(l.lop_days)), 0].join("#~#");
  }).join("\n") + "\n";
}

/** ESIC monthly contribution sheet (the columns of the ESIC portal's Excel upload). */
export function esiCsv(lines: Line[]) {
  const rows: unknown[][] = [["IP Number", "IP Name", "No of Days for which wages paid/payable during the month", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"]];
  for (const l of lines.filter((l) => Number(l.esi_wage) > 0)) rows.push([l.info.esi_no ?? "", l.info.name, Math.round(Number(l.paid_days)), Math.round(Number(l.esi_wage)), "", ""]);
  return csv(rows);
}

/** Professional tax register. */
export function ptCsv(lines: Line[]) {
  const rows: unknown[][] = [["Employee code", "Name", "Gross", "Professional tax"]];
  for (const l of lines) { const pt = amt(l, "deductions", "PT"); if (pt) rows.push([l.info.code, l.info.name, l.gross, pt]); }
  rows.push(["", "TOTAL", lines.reduce((s, l) => s + Number(l.gross), 0), lines.reduce((s, l) => s + amt(l, "deductions", "PT"), 0)]);
  return csv(rows);
}
