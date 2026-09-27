// Leave rules that do not need the database.

import { addDays, dateRange, weekday } from "@/lib/attendance/time";

export interface LeaveTypeRule {
  id: string;
  code: string;
  name: string;
  annual_quota: number;
  accrual: "yearly" | "monthly" | "none";
  carry_forward_max: number;
  requires_balance: boolean;
  paid: boolean;
  allow_half_day: boolean;
  count_non_working: boolean;
  min_notice_days: number;
  max_days_per_request: number | null;
  color: string;
  active: boolean;
}

export type HalfDay = "none" | "first_half" | "second_half";

/** Leave year containing a date. startMonth 1 = Jan–Dec, 4 = Apr–Mar. Named by the year it starts in. */
export function leaveYearOf(date: string, startMonth = 1): number {
  const [y, m] = date.split("-").map(Number);
  return m >= startMonth ? y : y - 1;
}

export function leaveYearBounds(year: number, startMonth = 1): { from: string; to: string } {
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const next = startMonth === 1 ? `${year + 1}-01-01` : `${year + 1}-${String(startMonth).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

export function leaveYearLabel(year: number, startMonth = 1): string {
  return startMonth === 1 ? String(year) : `${year}–${String((year + 1) % 100).padStart(2, "0")}`;
}

/**
 * Days a request takes from the balance. Weekly offs and holidays inside the range are skipped
 * unless the leave type counts them (sandwich rule).
 */
export function countLeaveDays(
  from: string, to: string, half: HalfDay,
  isNonWorking: (date: string) => boolean, countNonWorking: boolean,
): number {
  if (half !== "none") return from === to && (countNonWorking || !isNonWorking(from)) ? 0.5 : 0;
  return dateRange(from, to).filter((d) => countNonWorking || !isNonWorking(d)).length;
}

export function nonWorkingChecker(weeklyOffs: number[], holidays: Set<string>) {
  return (d: string) => weeklyOffs.includes(weekday(d)) || holidays.has(d);
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Months (1-based index within the leave year) whose credit an employee earns, given the joining date */
function joinedBy(monthStart: string, doj: string | null): boolean {
  if (!doj) return true;
  // Joining on or before the 15th earns that month
  const mid = monthStart.slice(0, 8) + "15";
  return doj <= mid;
}

export interface Credit { period: string; days: number; note: string }

/**
 * Credits due for a leave type in a leave year, up to (and including) the month of `asOf`.
 * yearly  → one credit at the start of the year, pro-rated for people who join during the year
 * monthly → quota / 12 for each month worked
 */
export function creditsDue(t: Pick<LeaveTypeRule, "annual_quota" | "accrual">, year: number, startMonth: number, asOf: string, doj: string | null, exitDate?: string | null): Credit[] {
  if (t.accrual === "none" || t.annual_quota <= 0) return [];
  const { from, to } = leaveYearBounds(year, startMonth);
  if (asOf < from) return [];
  if (doj && doj > to) return [];
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((startMonth - 1 + i) % 12) + 1;
    const y = year + Math.floor((startMonth - 1 + i) / 12);
    months.push(`${y}-${String(m).padStart(2, "0")}-01`);
  }
  if (t.accrual === "yearly") {
    const earned = months.filter((m) => joinedBy(m, doj)).length;
    const days = roundHalf((t.annual_quota * earned) / 12);
    if (!days) return [];
    return [{ period: String(year), days, note: earned === 12 ? "Yearly credit" : `Yearly credit, pro-rated for ${earned} months` }];
  }
  const per = round2(t.annual_quota / 12);
  return months
    .filter((m) => m <= asOf && joinedBy(m, doj) && (!exitDate || m <= exitDate))
    .map((m) => ({ period: m.slice(0, 7), days: per, note: `Monthly credit ${m.slice(0, 7)}` }));
}

/** Year-end: how much of a positive balance moves to the next year and how much lapses */
export function yearEndSplit(balance: number, carryForwardMax: number): { carry: number; lapse: number } {
  if (balance <= 0) return { carry: 0, lapse: 0 };
  const carry = Math.min(balance, carryForwardMax);
  return { carry: round2(carry), lapse: round2(balance - carry) };
}

export function fmtDays(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
