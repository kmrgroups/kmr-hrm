import { describe, it, expect } from "vitest";
import { dueDates, periodLabel, taskState, onTimeRate, nextDocNo, reviewDue, daysBetween, type Item } from "@/lib/compliance/rules";

const base: Item = { id: "x", code: "PF", kind: "payment", frequency: "monthly", due_months: [], due_day: 15, valid_until: null, renew_days: 60, remind_days: 7, start_on: "2026-01-01", active: true };

describe("compliance due dates", () => {
  it("monthly: the due day of every month, never before the start date", () => {
    expect(dueDates(base, "2026-09-01", "2026-11-30")).toEqual(["2026-09-15", "2026-10-15", "2026-11-15"]);
    expect(dueDates({ ...base, start_on: "2026-10-16" }, "2026-09-01", "2026-11-30")).toEqual(["2026-11-15"]);
    expect(dueDates({ ...base, active: false }, "2026-09-01", "2026-11-30")).toEqual([]);
  });
  it("day 31 means the month's last day", () => {
    expect(dueDates({ ...base, due_day: 31 }, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(dueDates({ ...base, due_day: 31 }, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });
  it("quarterly / yearly use their months, across the year end", () => {
    const q = { ...base, code: "24Q", frequency: "quarterly", due_months: [5, 7, 10, 1], due_day: 31 };
    expect(dueDates(q, "2026-06-01", "2027-06-30")).toEqual(["2026-07-31", "2026-10-31", "2027-01-31", "2027-05-31"]);
    expect(dueDates({ ...base, frequency: "yearly", due_months: [6] }, "2026-01-01", "2027-12-31")).toEqual(["2026-06-15", "2027-06-15"]);
  });
  it("a licence: renewal falls due renew_days before it expires, and stays due", () => {
    const l = { ...base, kind: "licence", frequency: "once", valid_until: "2026-12-31", renew_days: 60 };
    expect(dueDates(l, "2026-09-01", "2026-11-30")).toEqual(["2026-11-01"]);
    expect(dueDates(l, "2026-12-01", "2027-01-31")).toEqual(["2026-11-01"]);      // overdue renewal is still listed
    expect(dueDates(l, "2026-09-01", "2026-10-01")).toEqual([]);                   // not yet in the window
    expect(dueDates({ ...l, valid_until: null }, "2026-01-01", "2027-01-01")).toEqual([]);
  });
  it("labels: a monthly payment is for the month before", () => {
    expect(periodLabel(base, "2026-01-15")).toBe("Dec 2025");
    expect(periodLabel(base, "2026-10-15")).toBe("Sep 2026");
    expect(periodLabel({ frequency: "quarterly", kind: "return" }, "2026-07-31")).toBe("due Jul 2026");
    expect(periodLabel({ frequency: "once", kind: "licence" }, "2026-11-01")).toBe("Renewal");
  });
});

describe("states and rates", () => {
  const today = "2026-10-10";
  it("task state", () => {
    expect(taskState({ due_on: "2026-10-07", status: "open", done_on: null }, today)).toBe("overdue");
    expect(taskState({ due_on: "2026-10-15", status: "open", done_on: null }, today)).toBe("due_soon");
    expect(taskState({ due_on: "2026-10-30", status: "open", done_on: null }, today)).toBe("upcoming");
    expect(taskState({ due_on: "2026-10-07", status: "done", done_on: "2026-10-08" }, today)).toBe("done_late");
    expect(taskState({ due_on: "2026-10-07", status: "done", done_on: "2026-10-07" }, today)).toBe("done");
    expect(taskState({ due_on: "2026-10-07", status: "not_applicable", done_on: null }, today)).toBe("not_applicable");
  });
  it("on-time rate counts what fell due; not-applicable ones are left out", () => {
    expect(onTimeRate([
      { due_on: "2026-09-15", status: "done", done_on: "2026-09-14" }, { due_on: "2026-09-20", status: "done", done_on: "2026-09-23" },
      { due_on: "2026-10-07", status: "open", done_on: null }, { due_on: "2026-08-15", status: "not_applicable", done_on: null },
      { due_on: "2026-10-15", status: "open", done_on: null }], today)).toBe(33);
    expect(onTimeRate([], today)).toBeNull();
  });
});

describe("document control", () => {
  it("next document number per type", () => {
    expect(nextDocNo(["HR-POL-01", "HR-POL-03", "HR-P-01"], "policy")).toBe("HR-POL-04");
    expect(nextDocNo(["HR-POL-01"], "procedure")).toBe("HR-P-01");
    expect(nextDocNo([], "format")).toBe("HR-F-01");
  });
  it("review due = effective + months, end-of-month safe", () => {
    expect(reviewDue("2026-10-01", 12)).toBe("2027-10-01");
    expect(reviewDue("2026-01-31", 1)).toBe("2026-02-28");
    expect(reviewDue("2026-11-15", 24)).toBe("2028-11-15");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });
});
