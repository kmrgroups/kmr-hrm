import { describe, it, expect } from "vitest";
import { ltifr, severityRate, daysSinceLti, pyramid, canClose, ppeFor, dueState, addMonthsIso } from "@/lib/safety/rules";

describe("safety figures", () => {
  it("LTIFR and severity rate per million man-hours", () => {
    expect(ltifr(2, 400000)).toBe(5);
    expect(severityRate(4, 400000)).toBe(10);
    expect(ltifr(1, 0)).toBeNull();
  });
  it("days since the last lost-time injury", () => {
    expect(daysSinceLti([{ kind: "first_aid", occurred_at: "2026-09-30T10:00:00Z" }, { kind: "lost_time", occurred_at: "2026-07-18T05:10:00Z" }, { kind: "lost_time", occurred_at: "2025-02-01T05:10:00Z" }], "2026-10-01")).toBe(75);
    expect(daysSinceLti([{ kind: "near_miss", occurred_at: "2026-09-30" }], "2026-10-01")).toBeNull();
  });
  it("the pyramid: reports per injury", () => {
    expect(pyramid([{ kind: "lost_time" }, { kind: "first_aid" }, { kind: "near_miss" }, { kind: "near_miss" }, { kind: "unsafe_act" }, { kind: "unsafe_condition" }, { kind: "fire" }]))
      .toEqual({ lti: 1, injury: 0, firstAid: 1, nearMiss: 2, unsafe: 2, ratio: 2 });
  });
  it("closing needs the cause and every action done", () => {
    expect(canClose({ kind: "injury", root_cause: "" }, [])).toMatch(/root cause/);
    expect(canClose({ kind: "injury", root_cause: "x" }, [{ status: "open" }])).toMatch(/every action/);
    expect(canClose({ kind: "injury", root_cause: "x" }, [])).toMatch(/at least one action/);
    expect(canClose({ kind: "near_miss", root_cause: "x" }, [])).toBeNull();
    expect(canClose({ kind: "lost_time", root_cause: "x" }, [{ status: "done" }])).toBeNull();
  });
});

describe("PPE and medical due dates", () => {
  const items = [{ id: "shoe", name: "Safety shoes", life_months: 12, departments: [], for_all: true, active: true }, { id: "gog", name: "Goggles", life_months: 6, departments: ["prod"], active: true },
    { id: "old", name: "Old", life_months: 6, departments: [], for_all: true, active: false }, { id: "none", name: "Not set", life_months: 6, departments: [], active: true }];
  it("only what his department needs; in date, due soon, overdue, never issued", () => {
    const r = ppeFor({ id: "e1", department_id: "prod" }, items, [
      { employee_id: "e1", item_id: "shoe", issued_on: "2025-09-01", next_due: "2026-09-01" },
      { employee_id: "e1", item_id: "shoe", issued_on: "2026-09-20", next_due: "2027-09-20" }], "2026-10-01");
    expect(r.map((x) => [x.item.id, x.state])).toEqual([["shoe", "ok"], ["gog", "never"]]);
    expect(ppeFor({ id: "e2", department_id: "stores" }, items, [{ employee_id: "e2", item_id: "shoe", issued_on: "2025-10-10", next_due: "2026-10-10" }], "2026-10-01")
      .map((x) => [x.item.id, x.state])).toEqual([["shoe", "due_soon"]]);
    expect(ppeFor({ id: "e3", department_id: null }, items, [{ employee_id: "e3", item_id: "shoe", issued_on: "2025-01-10", next_due: "2026-01-10" }], "2026-10-01")[0]!.state).toBe("overdue");
  });
  it("due states and month arithmetic", () => {
    expect(dueState("2026-09-30", "2026-10-01")).toBe("overdue");
    expect(dueState("2026-10-20", "2026-10-01")).toBe("due_soon");
    expect(dueState(null, "2026-10-01")).toBe("none");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-10-01", 12)).toBe("2027-10-01");
  });
});

import { daysSinceLti as _dsl } from "@/lib/safety/rules";
import { describe as _d, it as _it, expect as _ex } from "vitest";
_d("IST day boundaries (audit fix)", () => {
  _it("an injury at 01:00 IST counts on its India date, not the UTC date", () => {
    // 01:00 IST on 7 Oct is 19:30 UTC on 6 Oct
    _ex(_dsl([{ kind: "lost_time", occurred_at: "2026-10-06T19:30:00+00:00" }], "2026-10-08")).toBe(1);
  });
});
