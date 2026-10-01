// Offer CTC breakup — uses the payroll engine itself (lib/payroll/compute.ts), so the offer letter and the first
// payslip always agree. CTC = 12 × (monthly gross + employer PF/ESI and charges) + gratuity (4.81% of basic), when shown.
import { computeLine, splitGross, type Component, type PaySettings } from "@/lib/payroll/compute";

export interface Breakup {
  monthly_gross: number;
  earnings: { code: string; name: string; monthly: number; annual: number }[];
  employer: { code: string; name: string; monthly: number; annual: number }[];
  deductions: { code: string; name: string; monthly: number; annual: number }[];
  gratuity: { monthly: number; annual: number } | null;
  net_monthly: number;
  ctc_monthly: number;
  ctc_annual: number;
  pf_applicable: boolean;
}

export interface BreakupOptions { pfApplicable: boolean; includeGratuity: boolean; esiApplicable?: boolean | null }

const yr = (m: number) => Math.round(m * 12);

/** breakup for a monthly gross */
export function breakupForGross(gross: number, s: PaySettings, comps: Component[], o: BreakupOptions): Breakup {
  const g = Math.max(1, Math.round(gross));
  const parts = splitGross(g, comps);
  const line = computeLine({
    month: "2026-04", daysInMonth: 30, notEmployedDays: 0, lopDays: 0, otMinutes: 0,
    structure: { monthly_gross: g, components: parts, pf_applicable: o.pfApplicable, esi_applicable: o.esiApplicable ?? null, pt_applicable: true, vpf_percent: 0, monthly_tds: 0 },
    components: comps, loans: [], adjustments: [], tds: null,
  }, s);
  const basic = parts.filter((p) => comps.find((c) => c.code === p.code)?.is_wages).reduce((a, p) => a + p.amount, 0);
  const gratM = o.includeGratuity ? Math.round(basic * 0.0481) : 0;
  const employer = line.employer.filter((e) => e.amount > 0).map((e) => ({ code: e.code, name: e.name, monthly: e.amount, annual: yr(e.amount) }));
  const erTotal = employer.reduce((a, e) => a + e.monthly, 0);
  const ctcM = line.gross + erTotal + gratM;
  return {
    monthly_gross: line.gross,
    earnings: line.earnings.map((e) => ({ code: e.code, name: e.name, monthly: e.amount, annual: yr(e.amount) })),
    employer,
    deductions: line.deductions.map((d) => ({ code: d.code, name: d.name, monthly: d.amount, annual: yr(d.amount) })),
    gratuity: o.includeGratuity ? { monthly: gratM, annual: yr(gratM) } : null,
    net_monthly: line.net_pay,
    ctc_monthly: ctcM,
    ctc_annual: yr(ctcM),
    pf_applicable: o.pfApplicable,
  };
}

/** breakup for a yearly CTC: finds the monthly gross that gives this CTC (to the nearest ₹12 a year) */
export function breakupForCtc(annualCtc: number, s: PaySettings, comps: Component[], o: BreakupOptions): Breakup {
  let lo = 1, hi = Math.max(10, Math.ceil(annualCtc / 12) + 1);
  for (let i = 0; i < 60 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (breakupForGross(mid, s, comps, o).ctc_annual > annualCtc) hi = mid; else lo = mid;
  }
  return breakupForGross(lo, s, comps, o);
}
