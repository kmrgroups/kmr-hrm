// Turns raw punches into one attendance row per employee per day.
// Pure functions only (no database), so the rules are easy to test and explain.
//
// Rules
//  • Each day is matched to a shift: the employee's fixed shift, or — if none is set — the shift whose
//    start is closest to the first punch of the day (handles rotating A/B/C shifts without a roster).
//  • Punches count for a day from 4 hours before the shift starts until 6 hours after it ends,
//    so night-shift out-punches on the next morning belong to the night they started.
//  • Worked time = last punch − first punch, less the shift's break when the span is 5 hours or more.
//  • Full day ≥ shift's full-day minutes; half day ≥ half-day minutes; otherwise absent.
//  • A single punch is a "missed punch" (counted absent until corrected by regularisation).
//  • Late / early are reported only beyond the shift's grace minutes.
//  • Overtime = worked time beyond the shift's length, counted when it reaches the minimum (default 30 min).
//  • Weekly off / holiday: no present or absent days; any work done is recorded as overtime.
//  • Approved leave fills the day (or half day); loss-of-pay leave is counted as absent for payroll.

import { addDays, istInstant, toMinutes } from "./time";

export interface ShiftRule {
  id: string;
  code: string;
  start: number;            // minutes of the day
  end: number;              // minutes of the day; <= start means next day
  breakMinutes: number;
  graceIn: number;
  graceOut: number;
  halfDay: number;
  fullDay: number;
}

export type DayStatus =
  | "present" | "half_day" | "absent" | "missed_punch" | "weekly_off" | "holiday" | "leave" | "half_leave";

export interface LeaveOnDay { code: string; fraction: 1 | 0.5; paid: boolean }

export interface DayInput {
  date: string;
  shift: ShiftRule | null;          // fixed shift, or null for auto-detection
  candidates: ShiftRule[];          // active shifts used for auto-detection
  weeklyOff: boolean;
  holiday: string | null;           // holiday name
  leave: LeaveOnDay | null;
  isToday?: boolean;
}

export interface DayResult {
  work_date: string;
  shift_id: string | null;
  first_in: string | null;
  last_out: string | null;
  punch_count: number;
  worked_minutes: number;
  late_minutes: number;
  early_minutes: number;
  ot_minutes: number;
  status: DayStatus;
  present_days: number;
  leave_days: number;
  absent_days: number;
  leave_type_code: string | null;
  remarks: string | null;
}

const PRE_WINDOW = 4 * 60;
const POST_WINDOW = 6 * 60;
const DOUBLE_TAP_MS = 2 * 6e4;
const BREAK_AFTER_SPAN = 5 * 60;

export function shiftFromRow(r: {
  id: string; code: string; start_time: string; end_time: string; break_minutes: number;
  grace_in_minutes: number; grace_out_minutes: number; half_day_minutes: number; full_day_minutes: number;
}): ShiftRule {
  return {
    id: r.id, code: r.code, start: toMinutes(r.start_time), end: toMinutes(r.end_time),
    breakMinutes: r.break_minutes, graceIn: r.grace_in_minutes, graceOut: r.grace_out_minutes,
    halfDay: r.half_day_minutes, fullDay: r.full_day_minutes,
  };
}

/** Absolute start / end of a shift on a date (end moves to the next day for night shifts) */
export function shiftSpan(date: string, s: ShiftRule): { start: number; end: number } {
  const start = istInstant(date, s.start);
  const end = istInstant(date, s.end <= s.start ? s.end + 1440 : s.end);
  return { start, end };
}

/** Shift whose start time is nearest to the first punch */
export function detectShift(date: string, firstPunch: number, candidates: ShiftRule[]): ShiftRule | null {
  let best: ShiftRule | null = null;
  let bestGap = Infinity;
  for (const s of candidates) {
    const gap = Math.abs(firstPunch - istInstant(date, s.start));
    if (gap < bestGap) { best = s; bestGap = gap; }
  }
  return best;
}

/** Drops repeated taps within two minutes of the previous kept punch */
export function dedupe(sorted: number[]): number[] {
  const out: number[] = [];
  for (const t of sorted) if (!out.length || t - out[out.length - 1] >= DOUBLE_TAP_MS) out.push(t);
  return out;
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

/**
 * Computes a sequence of consecutive days for one employee. Punches used by one day are not reused by
 * the next, so pass the day before the first day you need (and drop its result) when recomputing.
 */
export function computeDays(days: DayInput[], punches: number[], opts: { otMinMinutes?: number } = {}): DayResult[] {
  const otMin = opts.otMinMinutes ?? 30;
  const all = [...punches].sort((a, b) => a - b);
  const used = new Set<number>();
  const results: DayResult[] = [];

  for (const day of days) {
    const free = all.filter((t) => !used.has(t));
    let shift = day.shift;
    if (!shift && day.candidates.length) {
      const dayStart = istInstant(day.date, 0);
      const dayEnd = istInstant(addDays(day.date, 1), 0);
      const first = free.find((t) => t >= dayStart && t < dayEnd);
      if (first !== undefined) shift = detectShift(day.date, first, day.candidates);
    }

    let mine: number[] = [];
    let span: { start: number; end: number } | null = null;
    if (shift) {
      span = shiftSpan(day.date, shift);
      const from = span.start - PRE_WINDOW * 6e4;
      const to = span.end + POST_WINDOW * 6e4;
      mine = free.filter((t) => t >= from && t <= to);
      mine.forEach((t) => used.add(t));
    }
    results.push(evaluate(day, shift, span, dedupe(mine), otMin));
  }
  return results;
}

function evaluate(day: DayInput, shift: ShiftRule | null, span: { start: number; end: number } | null, p: number[], otMin: number): DayResult {
  const r: DayResult = {
    work_date: day.date, shift_id: shift?.id ?? null, first_in: null, last_out: null, punch_count: p.length,
    worked_minutes: 0, late_minutes: 0, early_minutes: 0, ot_minutes: 0, status: "absent",
    present_days: 0, leave_days: 0, absent_days: 0, leave_type_code: day.leave?.code ?? null, remarks: null,
  };

  const firstIn = p.length ? p[0] : null;
  const lastOut = p.length > 1 ? p[p.length - 1] : null;
  r.first_in = iso(firstIn);
  r.last_out = iso(lastOut);

  if (firstIn !== null && lastOut !== null) {
    const spanMin = Math.round((lastOut - firstIn) / 6e4);
    const brk = shift && spanMin >= BREAK_AFTER_SPAN ? shift.breakMinutes : 0;
    r.worked_minutes = Math.max(0, spanMin - brk);
  }
  if (shift && span && firstIn !== null) {
    const late = Math.round((firstIn - span.start) / 6e4);
    r.late_minutes = late > shift.graceIn ? late : 0;
  }
  if (shift && span && lastOut !== null) {
    const early = Math.round((span.end - lastOut) / 6e4);
    r.early_minutes = early > shift.graceOut ? early : 0;
    const shiftNet = Math.round((span.end - span.start) / 6e4) - shift.breakMinutes;
    const ot = r.worked_minutes - shiftNet;
    r.ot_minutes = ot >= otMin ? ot : 0;
  }

  const single = p.length === 1;

  // Full-day leave overrides everything
  if (day.leave && day.leave.fraction === 1) {
    r.status = "leave";
    if (day.leave.paid) r.leave_days = 1; else r.absent_days = 1;
    if (p.length) r.remarks = "Punched on a leave day";
    r.late_minutes = 0; r.early_minutes = 0; r.ot_minutes = 0;
    return r;
  }

  // Weekly off / holiday: nothing counted; work is overtime
  if (day.holiday || day.weeklyOff) {
    r.status = day.holiday ? "holiday" : "weekly_off";
    r.late_minutes = 0; r.early_minutes = 0;
    r.ot_minutes = r.worked_minutes >= otMin ? r.worked_minutes : 0;
    const label = day.holiday ?? "Weekly off";
    r.remarks = r.worked_minutes ? `${label} — worked` : day.holiday ? day.holiday : null;
    return r;
  }

  let present = 0;
  if (shift && r.worked_minutes >= shift.fullDay) present = 1;
  else if (shift && r.worked_minutes >= shift.halfDay) present = 0.5;
  else if (!shift && r.worked_minutes >= 240) present = r.worked_minutes >= 450 ? 1 : 0.5;

  if (day.leave && day.leave.fraction === 0.5) {
    r.status = "half_leave";
    r.present_days = Math.min(present, 0.5);
    if (day.leave.paid) r.leave_days = 0.5;
    r.absent_days = 1 - r.present_days - r.leave_days;
    if (single) r.remarks = day.isToday ? "Checked in — no out punch yet" : "Missed punch";
    return r;
  }

  if (single) {
    r.status = "missed_punch";
    r.absent_days = 1;
    r.remarks = day.isToday ? "Checked in — no out punch yet" : "Only one punch — needs regularisation";
    return r;
  }

  r.present_days = present;
  r.absent_days = 1 - present;
  r.status = present === 1 ? "present" : present === 0.5 ? "half_day" : "absent";
  if (r.status === "absent" && p.length) r.remarks = "Worked less than half a day";
  return r;
}

export const STATUS_META: Record<DayStatus, { label: string; short: string; tone: string }> = {
  present: { label: "Present", short: "P", tone: "ok" },
  half_day: { label: "Half day", short: "½", tone: "warn" },
  absent: { label: "Absent", short: "A", tone: "danger" },
  missed_punch: { label: "Missed punch", short: "MP", tone: "warn" },
  weekly_off: { label: "Weekly off", short: "WO", tone: "" },
  holiday: { label: "Holiday", short: "H", tone: "info" },
  leave: { label: "Leave", short: "L", tone: "info" },
  half_leave: { label: "Half-day leave", short: "½L", tone: "info" },
};
