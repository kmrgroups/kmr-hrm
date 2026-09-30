// Payroll calculation for one employee and one month. Pure functions — no database — so every rule can be tested.
// Amounts are rounded to whole rupees, as on Indian payslips.

export interface PaySettings {
  pay_basis: "calendar" | "fixed_26" | "fixed_30";
  lop_source: "attendance" | "manual";
  labour_code_wages: boolean;
  pf_enabled: boolean; pf_ceiling: number; pf_restrict: boolean; eps_ceiling: number; pf_admin_rate: number; edli_rate: number;
  esi_enabled: boolean; esi_threshold: number; esi_ee_rate: number; esi_er_rate: number;
  pt_enabled: boolean; pt_state: string; pt_slabs: { from: number; amount: number; feb?: number }[];
  ot_enabled: boolean; ot_multiplier: number; hours_per_day: number;
  payslip_note?: string | null;
}

export interface Component {
  code: string; name: string; calc: "percent_gross" | "percent_basic" | "fixed" | "balance"; value: number;
  is_wages: boolean; in_ot_base: boolean; prorate: boolean; sort_order: number; active: boolean;
}

export interface Structure {
  monthly_gross: number;
  components: { code: string; name: string; amount: number }[];
  pf_applicable: boolean; esi_applicable: boolean | null; pt_applicable: boolean; vpf_percent: number; monthly_tds: number;
}

export interface Loan { id: string; kind: "loan" | "advance"; emi: number; balance: number; start_month: string }
export interface Adjustment { label: string; kind: "earning" | "deduction"; amount: number }
export interface Amount { code: string; name: string; amount: number; full?: number; loan_id?: string }

export interface LineInput {
  month: string;                  // YYYY-MM
  daysInMonth: number;
  notEmployedDays: number;        // before joining in this month
  lopDays: number;                // unpaid days (absent, unpaid leave, missing past days) — or HR's figure
  otMinutes: number;
  structure: Structure;
  components: Component[];        // company template (for flags)
  loans: Loan[];
  adjustments: Adjustment[];
  tds: number | null;             // HR's figure for this month, else structure.monthly_tds
}

export interface LineResult {
  paid_days: number; lop_days: number; ot_hours: number;
  earnings: Amount[]; deductions: Amount[]; employer: Amount[];
  gross: number; total_deductions: number; net_pay: number; pf_wage: number; eps_wage: number; esi_wage: number;
  warnings: string[];
}

const r0 = (n: number) => Math.round(n + Number.EPSILON);
const pct = (base: number, rate: number) => r0((base * rate) / 100);

/** Splits a monthly gross into the company's components (Basic, HRA, … and the balance as Special allowance). */
export function splitGross(gross: number, comps: Component[]): { code: string; name: string; amount: number }[] {
  const active = comps.filter((c) => c.active).sort((a, b) => a.sort_order - b.sort_order);
  const out = new Map<string, number>();
  const basic = active.find((c) => c.code === "BASIC");
  const basicAmt = basic ? (basic.calc === "percent_gross" ? pct(gross, basic.value) : basic.calc === "fixed" ? basic.value : 0) : 0;
  for (const c of active) {
    if (c.calc === "balance") continue;
    const amt = c.code === "BASIC" ? basicAmt
      : c.calc === "percent_gross" ? pct(gross, c.value)
      : c.calc === "percent_basic" ? pct(basicAmt, c.value)
      : c.value;
    out.set(c.code, Math.max(0, amt));
  }
  // never exceed the gross: trim from the last fixed / percentage items first (small salaries)
  let used = [...out.values()].reduce((a, b) => a + b, 0);
  for (const c of [...active].reverse()) {
    if (used <= gross) break;
    if (c.calc === "balance" || c.code === "BASIC" || !out.has(c.code)) continue;
    const cut = Math.min(out.get(c.code)!, used - gross);
    out.set(c.code, out.get(c.code)! - cut); used -= cut;
  }
  const bal = active.find((c) => c.calc === "balance");
  if (bal) out.set(bal.code, Math.max(0, r0(gross - used)));
  return active.filter((c) => out.has(c.code) && out.get(c.code)! > 0).map((c) => ({ code: c.code, name: c.name, amount: out.get(c.code)! }));
}

export function ptFor(gross: number, s: PaySettings, month: string): number {
  if (!s.pt_enabled || !s.pt_slabs?.length) return 0;
  const slab = [...s.pt_slabs].sort((a, b) => b.from - a.from).find((x) => gross >= x.from);
  if (!slab) return 0;
  return month.endsWith("-02") && slab.feb != null ? Number(slab.feb) : Number(slab.amount);
}

export function basisDays(s: PaySettings, daysInMonth: number) {
  return s.pay_basis === "fixed_26" ? 26 : s.pay_basis === "fixed_30" ? 30 : daysInMonth;
}

export function computeLine(inp: LineInput, s: PaySettings): LineResult {
  const warnings: string[] = [];
  const flags = new Map(inp.components.map((c) => [c.code, c]));
  const denom = basisDays(s, inp.daysInMonth);
  const unpaid = Math.min(denom, Math.max(0, inp.lopDays) + Math.max(0, inp.notEmployedDays) * (denom / inp.daysInMonth));
  const factor = Math.max(0, 1 - unpaid / denom);
  const paid = Math.max(0, inp.daysInMonth - inp.notEmployedDays - Math.max(0, inp.lopDays));

  // earnings
  const earnings: Amount[] = inp.structure.components.map((c) => {
    const f = flags.get(c.code);
    const amount = f && !f.prorate ? c.amount : r0(c.amount * factor);
    return { code: c.code, name: c.name, full: c.amount, amount };
  });
  const earnedFixed = earnings.reduce((a, e) => a + e.amount, 0);
  let otHours = 0;
  if (s.ot_enabled && inp.otMinutes > 0) {
    otHours = Math.round((inp.otMinutes / 60) * 100) / 100;
    const base = inp.structure.components.filter((c) => flags.get(c.code)?.in_ot_base).reduce((a, c) => a + c.amount, 0);
    const hourly = base / (denom * (s.hours_per_day || 8));
    const ot = r0(otHours * hourly * (s.ot_multiplier || 2));
    if (ot > 0) earnings.push({ code: "OT", name: `Overtime (${otHours} h)`, amount: ot });
  }
  for (const a of inp.adjustments.filter((a) => a.kind === "earning" && a.amount > 0)) earnings.push({ code: "ADJ", name: a.label, amount: r0(a.amount) });
  const gross = earnings.reduce((a, e) => a + e.amount, 0);

  // wages for PF (Code on Wages: Basic + DA (+ retaining allowance), at least 50% of pay)
  let wages = earnings.filter((e) => flags.get(e.code)?.is_wages).reduce((a, e) => a + e.amount, 0);
  if (s.labour_code_wages && earnedFixed > 0 && wages < earnedFixed / 2) wages = r0(earnedFixed / 2);

  const deductions: Amount[] = [], employer: Amount[] = [];
  let pfWage = 0, epsWageOut = 0;
  if (s.pf_enabled && inp.structure.pf_applicable && wages > 0) {
    pfWage = s.pf_restrict ? Math.min(wages, s.pf_ceiling) : wages;
    const epsWage = Math.min(wages, s.eps_ceiling); epsWageOut = epsWage;
    const ee = pct(pfWage, 12);
    deductions.push({ code: "PF", name: "Provident fund (12%)", amount: ee });
    if (inp.structure.vpf_percent > 0) deductions.push({ code: "VPF", name: `Voluntary PF (${inp.structure.vpf_percent}%)`, amount: pct(pfWage, inp.structure.vpf_percent) });
    const eps = pct(epsWage, 8.33);
    employer.push({ code: "EPS", name: "Pension (EPS 8.33%)", amount: eps });
    employer.push({ code: "EPF_ER", name: "Employer PF (3.67%)", amount: Math.max(0, pct(pfWage, 12) - eps) });
    employer.push({ code: "PF_ADMIN", name: `PF admin charges (${s.pf_admin_rate}%)`, amount: pct(pfWage, s.pf_admin_rate) });
    employer.push({ code: "EDLI", name: `EDLI (${s.edli_rate}%)`, amount: pct(Math.min(wages, s.eps_ceiling), s.edli_rate) });
  }

  // ESI: on the full monthly pay; applies when the fixed gross is within the threshold (or HR says so)
  let esiWage = 0;
  const esiOn = s.esi_enabled && (inp.structure.esi_applicable ?? inp.structure.monthly_gross <= s.esi_threshold);
  if (esiOn && gross > 0) {
    esiWage = gross;
    deductions.push({ code: "ESI", name: `ESI (${s.esi_ee_rate}%)`, amount: Math.ceil((gross * s.esi_ee_rate) / 100) });
    employer.push({ code: "ESI_ER", name: `Employer ESI (${s.esi_er_rate}%)`, amount: Math.ceil((gross * s.esi_er_rate) / 100) });
  }

  if (inp.structure.pt_applicable) {
    const pt = ptFor(gross, s, inp.month);
    if (pt > 0) deductions.push({ code: "PT", name: `Professional tax (${s.pt_state})`, amount: pt });
  }
  const tds = r0(inp.tds ?? inp.structure.monthly_tds ?? 0);
  if (tds > 0) deductions.push({ code: "TDS", name: "Income tax (TDS)", amount: tds });

  for (const l of inp.loans) {
    if (l.start_month > inp.month || l.balance <= 0) continue;
    const amt = r0(Math.min(l.emi, l.balance));
    if (amt > 0) deductions.push({ code: l.kind === "advance" ? "ADV" : "LOAN", name: l.kind === "advance" ? "Salary advance recovery" : "Loan instalment", amount: amt, loan_id: l.id });
  }
  for (const a of inp.adjustments.filter((a) => a.kind === "deduction" && a.amount > 0)) deductions.push({ code: "ADJ", name: a.label, amount: r0(a.amount) });

  const total = deductions.reduce((a, d) => a + d.amount, 0);
  const net = gross - total;
  if (net < 0) warnings.push("Deductions are more than the pay this month — reduce the loan instalment or other deductions.");
  if (s.labour_code_wages && earnedFixed > 0) {
    const basicDa = earnings.filter((e) => flags.get(e.code)?.is_wages).reduce((a, e) => a + e.amount, 0);
    if (basicDa < earnedFixed / 2) warnings.push("Basic + DA is below 50% of pay; PF is worked out on 50% as the Labour Codes require.");
  }
  return {
    paid_days: Math.round(paid * 100) / 100, lop_days: Math.max(0, inp.lopDays), ot_hours: otHours,
    earnings, deductions, employer, gross, total_deductions: total, net_pay: net, pf_wage: pfWage, eps_wage: epsWageOut, esi_wage: esiWage, warnings,
  };
}

// ------------------------------------------------------------------ helpers for payslips
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function three(n: number) { const h = Math.floor(n / 100), r = n % 100; return [h ? `${ONES[h]} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" "); }
/** 125000 → "One Lakh Twenty Five Thousand Rupees Only" (Indian numbering) */
export function rupeesInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${crore > 99 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(" ")} Rupees Only`;
}
export const inr = (n: number) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
