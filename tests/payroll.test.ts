import { computeLine, splitGross, rupeesInWords, type Component, type PaySettings } from "../lib/payroll/compute";
let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " — expected " + JSON.stringify(want)}`); };
const S: PaySettings = { pay_basis: "calendar", lop_source: "attendance", labour_code_wages: true, pf_enabled: true, pf_ceiling: 15000, pf_restrict: true, eps_ceiling: 15000, pf_admin_rate: 0.5, edli_rate: 0.5,
  esi_enabled: true, esi_threshold: 21000, esi_ee_rate: 0.75, esi_er_rate: 3.25, pt_enabled: true, pt_state: "Karnataka", pt_slabs: [{ from: 0, amount: 0, feb: 0 }, { from: 25000, amount: 200, feb: 300 }],
  ot_enabled: true, ot_multiplier: 2, hours_per_day: 8 };
const C: Component[] = [
  { code: "BASIC", name: "Basic salary", calc: "percent_gross", value: 50, is_wages: true, in_ot_base: true, prorate: true, sort_order: 1, active: true },
  { code: "DA", name: "Dearness allowance", calc: "fixed", value: 0, is_wages: true, in_ot_base: true, prorate: true, sort_order: 2, active: true },
  { code: "HRA", name: "House rent allowance", calc: "percent_basic", value: 40, is_wages: false, in_ot_base: false, prorate: true, sort_order: 3, active: true },
  { code: "CONV", name: "Conveyance allowance", calc: "fixed", value: 1600, is_wages: false, in_ot_base: false, prorate: true, sort_order: 4, active: true },
  { code: "SPL", name: "Special allowance", calc: "balance", value: 0, is_wages: false, in_ot_base: true, prorate: true, sort_order: 5, active: true },
];
const st = (gross: number, extra = {}) => ({ monthly_gross: gross, components: splitGross(gross, C), pf_applicable: true, esi_applicable: null, pt_applicable: true, vpf_percent: 0, monthly_tds: 0, ...extra });
const base = { daysInMonth: 30, notEmployedDays: 0, lopDays: 0, otMinutes: 0, components: C, loans: [], adjustments: [], tds: null };

eq("A split 17,500", splitGross(17500, C).map((c) => c.amount), [8750, 3500, 1600, 3650]);
let r = computeLine({ ...base, month: "2026-09", structure: st(17500) }, S);
eq("A gross", r.gross, 17500);
eq("A deductions PF, ESI", r.deductions.map((d) => [d.code, d.amount]), [["PF", 1050], ["ESI", 132]]);
eq("A net", r.net_pay, 16318);
eq("A employer EPS, EPF, ESI", r.employer.filter((e) => ["EPS", "EPF_ER", "ESI_ER"].includes(e.code)).map((e) => e.amount), [729, 321, 569]);

r = computeLine({ ...base, month: "2026-09", lopDays: 2, structure: st(42000) }, S);
eq("B earned (2 LOP of 30)", r.earnings.map((e) => e.amount), [19600, 7840, 1493, 10267]);
eq("B gross", r.gross, 39200);
eq("B PF on ceiling 15,000", r.deductions.find((d) => d.code === "PF")?.amount, 1800);
eq("B no ESI above 21,000", r.deductions.some((d) => d.code === "ESI"), false);
eq("B PT Karnataka", r.deductions.find((d) => d.code === "PT")?.amount, 200);
eq("B net", r.net_pay, 37200);
eq("B paid days", r.paid_days, 28);

r = computeLine({ ...base, month: "2027-02", daysInMonth: 28, structure: st(42000) }, S);
eq("C PT in February", r.deductions.find((d) => d.code === "PT")?.amount, 300);

r = computeLine({ ...base, month: "2026-09", structure: st(30000), loans: [{ id: "L1", kind: "loan", emi: 3000, balance: 2000, start_month: "2026-08" }, { id: "L2", kind: "advance", emi: 5000, balance: 5000, start_month: "2026-10" }] }, S);
eq("D loan: last instalment = balance; advance not started", r.deductions.filter((d) => d.loan_id).map((d) => [d.loan_id, d.amount]), [["L1", 2000]]);

const C30 = C.map((c) => (c.code === "BASIC" ? { ...c, value: 30 } : c));
r = computeLine({ ...base, month: "2026-09", components: C30, structure: { ...st(40000), components: splitGross(40000, C30) } }, { ...S, pf_restrict: false });
eq("E Labour Code: PF wage raised to 50% of pay", r.pf_wage, 20000);
eq("E warning shown", r.warnings.length > 0, true);

r = computeLine({ ...base, month: "2026-09", otMinutes: 600, structure: st(26000) }, S);
eq("F overtime 10 h at 2x on (Basic+Special)/240 h", r.earnings.find((e) => e.code === "OT")?.amount, 1600);

r = computeLine({ ...base, month: "2026-09", notEmployedDays: 10, structure: st(30000) }, S);
eq("G joined on the 11th: 20 of 30 days", [r.paid_days, r.gross], [20, 20000]);

r = computeLine({ ...base, month: "2026-09", structure: st(30000), adjustments: [{ label: "Diwali bonus", kind: "earning", amount: 5000 }, { label: "Canteen", kind: "deduction", amount: 450 }], tds: 1200 }, S);
eq("H bonus, canteen, TDS", [r.gross, r.deductions.find((d) => d.code === "TDS")?.amount, r.deductions.find((d) => d.name === "Canteen")?.amount], [35000, 1200, 450]);

eq("I words", rupeesInWords(125430), "One Lakh Twenty Five Thousand Four Hundred Thirty Rupees Only");
eq("J small salary split never exceeds gross", splitGross(3000, C).reduce((a, c) => a + c.amount, 0), 3000);
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
