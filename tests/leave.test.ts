import { describe, expect, it } from "vitest";
import { countLeaveDays, creditsDue, leaveYearBounds, leaveYearOf, leaveYearLabel, nonWorkingChecker, yearEndSplit } from "@/lib/leave/rules";

describe("leave year", () => {
  it("calendar and April–March years", () => {
    expect(leaveYearOf("2026-03-31", 1)).toBe(2026);
    expect(leaveYearOf("2026-03-31", 4)).toBe(2025);
    expect(leaveYearOf("2026-04-01", 4)).toBe(2026);
    expect(leaveYearBounds(2026, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(leaveYearBounds(2026, 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(leaveYearLabel(2026, 4)).toBe("2026–27");
  });
});

describe("counting leave days", () => {
  const nw = nonWorkingChecker([0], new Set(["2026-10-02"]));
  it("skips Sundays and holidays by default", () => {
    // Thu 1 Oct → Mon 5 Oct: 1, (2 holiday), 3, (4 Sunday), 5
    expect(countLeaveDays("2026-10-01", "2026-10-05", "none", nw, false)).toBe(3);
    expect(countLeaveDays("2026-10-01", "2026-10-05", "none", nw, true)).toBe(5);
  });
  it("half day, and half day on a holiday is nothing", () => {
    expect(countLeaveDays("2026-10-01", "2026-10-01", "first_half", nw, false)).toBe(0.5);
    expect(countLeaveDays("2026-10-02", "2026-10-02", "first_half", nw, false)).toBe(0);
  });
});

describe("credits", () => {
  it("yearly credit, pro-rated for joiners (joining after the 15th skips that month)", () => {
    expect(creditsDue({ annual_quota: 12, accrual: "yearly" }, 2026, 1, "2026-01-01", "2020-05-01")).toEqual([{ period: "2026", days: 12, note: "Yearly credit" }]);
    expect(creditsDue({ annual_quota: 12, accrual: "yearly" }, 2026, 1, "2026-07-01", "2026-07-20")[0].days).toBe(5);
    expect(creditsDue({ annual_quota: 12, accrual: "yearly" }, 2026, 1, "2026-07-01", "2027-01-05")).toEqual([]);
  });
  it("monthly credit up to the current month", () => {
    const c = creditsDue({ annual_quota: 15, accrual: "monthly" }, 2026, 4, "2026-06-10", "2026-04-10");
    expect(c.map((x) => x.period)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(c[0].days).toBe(1.25);
    expect(creditsDue({ annual_quota: 15, accrual: "monthly" }, 2026, 4, "2026-06-10", "2026-04-20").map((x) => x.period)).toEqual(["2026-05", "2026-06"]);
  });
  it("no automatic credit for comp-off / LOP", () => {
    expect(creditsDue({ annual_quota: 0, accrual: "none" }, 2026, 1, "2026-06-01", null)).toEqual([]);
  });
  it("year-end carry forward is capped; the rest lapses", () => {
    expect(yearEndSplit(52.5, 45)).toEqual({ carry: 45, lapse: 7.5 });
    expect(yearEndSplit(5, 0)).toEqual({ carry: 0, lapse: 5 });
    expect(yearEndSplit(-1, 45)).toEqual({ carry: 0, lapse: 0 });
  });
});
