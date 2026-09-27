import { describe, expect, it } from "vitest";
import { computeDays, type DayInput, type ShiftRule } from "@/lib/attendance/compute";
import { istInstant, istTime, addDays, monthBounds, weekday } from "@/lib/attendance/time";
import { parseCsv, parseAdmsAttlog, parseApiPayload, parseLocalDateTime, normalizeAttendanceId } from "@/lib/attendance/parse";

const G: ShiftRule = { id: "g", code: "G", start: 540, end: 1050, breakMinutes: 30, graceIn: 10, graceOut: 10, halfDay: 240, fullDay: 450 };
const A: ShiftRule = { id: "a", code: "A", start: 360, end: 870, breakMinutes: 30, graceIn: 10, graceOut: 10, halfDay: 240, fullDay: 450 };
const C: ShiftRule = { id: "c", code: "C", start: 1380, end: 360, breakMinutes: 30, graceIn: 10, graceOut: 10, halfDay: 210, fullDay: 390 };
const at = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return istInstant(date, h * 60 + m); };
const day = (date: string, extra: Partial<DayInput> = {}): DayInput => ({ date, shift: G, candidates: [G, A, C], weeklyOff: false, holiday: null, leave: null, ...extra });

describe("time helpers", () => {
  it("works in IST regardless of server zone", () => {
    expect(istTime(at("2026-09-21", "09:05"))).toBe("09:05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekday("2026-09-27")).toBe(0);
    expect(monthBounds("2028-02").days.length).toBe(29);
  });
});

describe("attendance engine", () => {
  it("full day with lateness inside grace", () => {
    const [r] = computeDays([day("2026-09-21")], [at("2026-09-21", "09:08"), at("2026-09-21", "17:35")]);
    expect(r.status).toBe("present");
    expect(r.worked_minutes).toBe(8 * 60 + 27 - 30);
    expect(r.late_minutes).toBe(0);
    expect(r.present_days).toBe(1);
  });

  it("late beyond grace, early exit, half day", () => {
    const [r] = computeDays([day("2026-09-21")], [at("2026-09-21", "09:40"), at("2026-09-21", "14:30")]);
    expect(r.late_minutes).toBe(40);
    expect(r.early_minutes).toBe(180);
    expect(r.status).toBe("half_day");
    expect([r.present_days, r.absent_days]).toEqual([0.5, 0.5]);
  });

  it("no punches is absent; one punch is a missed punch", () => {
    const [a] = computeDays([day("2026-09-21")], []);
    expect(a.status).toBe("absent");
    expect(a.absent_days).toBe(1);
    const [m] = computeDays([day("2026-09-21")], [at("2026-09-21", "09:00")]);
    expect(m.status).toBe("missed_punch");
  });

  it("ignores double taps", () => {
    const [r] = computeDays([day("2026-09-21")], [at("2026-09-21", "09:00"), at("2026-09-21", "09:01")]);
    expect(r.punch_count).toBe(1);
    expect(r.status).toBe("missed_punch");
  });

  it("night shift out-punch next morning belongs to the night it started", () => {
    const days = [day("2026-09-21", { shift: C }), day("2026-09-22", { shift: C })];
    const res = computeDays(days, [at("2026-09-21", "22:55"), at("2026-09-22", "06:05"), at("2026-09-22", "22:58"), at("2026-09-23", "06:02")]);
    expect(res[0].status).toBe("present");
    expect(res[0].worked_minutes).toBe(7 * 60 + 10 - 30);
    expect(res[1].status).toBe("present");
    expect(res[1].punch_count).toBe(2);
  });

  it("detects rotating shifts from the first punch when no shift is fixed", () => {
    const days = [day("2026-09-21", { shift: null }), day("2026-09-22", { shift: null })];
    const res = computeDays(days, [at("2026-09-21", "05:52"), at("2026-09-21", "14:35"), at("2026-09-22", "22:50"), at("2026-09-23", "06:10")]);
    expect(res[0].shift_id).toBe("a");
    expect(res[0].status).toBe("present");
    expect(res[1].shift_id).toBe("c");
    expect(res[1].status).toBe("present");
  });

  it("overtime counts only beyond the minimum", () => {
    const [r] = computeDays([day("2026-09-21")], [at("2026-09-21", "09:00"), at("2026-09-21", "19:30")]);
    expect(r.ot_minutes).toBe(120);
    const [s] = computeDays([day("2026-09-21")], [at("2026-09-21", "09:00"), at("2026-09-21", "17:50")]);
    expect(s.ot_minutes).toBe(0);
  });

  it("weekly off and holiday count nothing; work there is overtime", () => {
    const [w] = computeDays([day("2026-09-27", { weeklyOff: true })], [at("2026-09-27", "09:00"), at("2026-09-27", "13:00")]);
    expect(w.status).toBe("weekly_off");
    expect([w.present_days, w.absent_days, w.leave_days]).toEqual([0, 0, 0]);
    expect(w.ot_minutes).toBe(240);
    const [h] = computeDays([day("2026-10-02", { holiday: "Gandhi Jayanti" })], []);
    expect(h.status).toBe("holiday");
    expect(h.remarks).toBe("Gandhi Jayanti");
  });

  it("leave: paid, loss of pay, and half day with work", () => {
    const [l] = computeDays([day("2026-09-21", { leave: { code: "CL", fraction: 1, paid: true } })], []);
    expect([l.status, l.leave_days, l.absent_days]).toEqual(["leave", 1, 0]);
    const [lop] = computeDays([day("2026-09-21", { leave: { code: "LOP", fraction: 1, paid: false } })], []);
    expect([lop.leave_days, lop.absent_days]).toEqual([0, 1]);
    const [hl] = computeDays([day("2026-09-21", { leave: { code: "CL", fraction: 0.5, paid: true } })], [at("2026-09-21", "13:00"), at("2026-09-21", "17:35")]);
    expect([hl.status, hl.present_days, hl.leave_days, hl.absent_days]).toEqual(["half_leave", 0.5, 0.5, 0]);
    const [hlA] = computeDays([day("2026-09-21", { leave: { code: "CL", fraction: 0.5, paid: true } })], []);
    expect([hlA.present_days, hlA.leave_days, hlA.absent_days]).toEqual([0, 0.5, 0.5]);
  });

  it("every working day adds up to one", () => {
    for (const p of [[], [at("2026-09-21", "09:00")], [at("2026-09-21", "09:00"), at("2026-09-21", "13:30")], [at("2026-09-21", "09:00"), at("2026-09-21", "18:00")]]) {
      const [r] = computeDays([day("2026-09-21")], p);
      expect(r.present_days + r.leave_days + r.absent_days).toBe(1);
    }
  });
});

describe("punch parsers", () => {
  it("reads local date-time formats as IST", () => {
    expect(parseLocalDateTime("2026-09-21 09:05:00")).toBe("2026-09-21T03:35:00.000Z");
    expect(parseLocalDateTime("21/09/2026 9:05 PM")).toBe("2026-09-21T15:35:00.000Z");
    expect(parseLocalDateTime("21-09-2026 12:10 AM")).toBe("2026-09-20T18:40:00.000Z");
    expect(parseLocalDateTime("2026-09-21T09:05:00Z")).toBe("2026-09-21T09:05:00.000Z");
    expect(parseLocalDateTime("31/02/2026 09:00")).toBeNull();
    expect(parseLocalDateTime("garbage")).toBeNull();
  });

  it("normalises numeric device IDs", () => {
    expect(normalizeAttendanceId(" 00101 ")).toBe("101");
    expect(normalizeAttendanceId("0")).toBe("0");
    expect(normalizeAttendanceId("DEN-0007")).toBe("DEN-0007");
  });

  it("reads a CSV with a header and separate date/time columns", () => {
    const r = parseCsv("Emp Code,Name,Date,Time\n00101,Ravi,21-09-2026,09:02\n101,Ravi,21-09-2026,17:40\nbad,line\n");
    expect(r.rows).toEqual([
      { attendance_id: "101", punched_at: "2026-09-21T03:32:00.000Z" },
      { attendance_id: "101", punched_at: "2026-09-21T12:10:00.000Z" },
    ]);
    expect(r.errors.length).toBe(1);
  });

  it("reads a header-less tab file (ID, date-time)", () => {
    const r = parseCsv("101\t2026-09-21 09:02:11\n102\t2026-09-21 09:03:00\n");
    expect(r.rows.map((x) => x.attendance_id)).toEqual(["101", "102"]);
  });

  it("explains an unreadable header", () => {
    expect(parseCsv("Name,Remarks\nRavi,ok\n").errors[0]).toMatch(/Could not find the columns/);
  });

  it("reads ADMS ATTLOG pushes", () => {
    const r = parseAdmsAttlog("101\t2026-09-21 09:02:11\t0\t1\t0\t0\n102\t2026-09-21 17:30:00\t1\t1\n\n");
    expect(r).toEqual([
      { attendance_id: "101", punched_at: "2026-09-21T03:32:11.000Z", direction: "in" },
      { attendance_id: "102", punched_at: "2026-09-21T12:00:00.000Z", direction: "out" },
    ]);
  });

  it("validates the JSON API body", () => {
    expect(parseApiPayload({ punches: [{ user_id: 7, time: "2026-09-21 09:00" }, { time: "x" }] })).toMatchObject({ rows: [{ attendance_id: "7" }], errors: [expect.any(String)] });
    expect(parseApiPayload({}).errors.length).toBe(1);
  });
});
