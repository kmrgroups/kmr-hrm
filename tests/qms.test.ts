import { describe, it, expect } from "vitest";
import { coverage, competencyGaps, competencyCoverage, findNeeds, planFromNeeds, testOutcome, kpiAchievement, kpiScore, auditorStatus, addMonths, type Operation, type FindInput } from "@/lib/qms/rules";

const ON = "2026-10-01";
const ops: Operation[] = [
  { id: "op10", line: "Cell 1", code: "OP10", name: "Turning", critical: true, min_qualified: null },
  { id: "op40", line: "Cell 1", code: "OP40", name: "Final inspection", critical: true, min_qualified: 3 },
  { id: "op50", line: "Assembly", code: "OP50", name: "Packing", critical: false, min_qualified: null },
];

describe("skill matrix coverage", () => {
  it("counts qualified people (3–4, not past re-certification) and flags short, single-point and overdue", () => {
    const rows = [
      { employee_id: "a", operation_id: "op10", level: 4 }, { employee_id: "b", operation_id: "op10", level: 3, valid_until: "2026-09-01" },
      { employee_id: "c", operation_id: "op10", level: 2 },
      { employee_id: "a", operation_id: "op40", level: 3 }, { employee_id: "b", operation_id: "op40", level: 3 },
      { employee_id: "a", operation_id: "op50", level: 3 }, { employee_id: "b", operation_id: "op50", level: 4 },
    ];
    const [c10, c40, c50] = coverage(ops, rows, 2, ON);
    expect(c10).toMatchObject({ qualified: 1, trainers: 1, inTraining: 1, short: true, singlePoint: true, expired: 1 });
    expect(c10!.alert).toContain("re-certification");
    expect(c40).toMatchObject({ qualified: 2, min: 3, short: true });
    expect(c50).toMatchObject({ qualified: 2, short: false, singlePoint: false, alert: null });
  });
});

describe("competency gaps", () => {
  const people = [{ id: "p1", designation_id: "op" }, { id: "p2", designation_id: "op" }, { id: "p3", designation_id: null }];
  const req = [{ designation_id: "op", competency_id: "measure", required_level: 3 }, { designation_id: "op", competency_id: "safety", required_level: 3 }];
  const assessed = [{ employee_id: "p1", competency_id: "measure", level: 3 }, { employee_id: "p1", competency_id: "safety", level: 2 }, { employee_id: "p2", competency_id: "measure", level: 4 }];
  it("lists each level short of the role's need (not assessed counts as 0)", () => {
    expect(competencyGaps(people, req, assessed)).toEqual([
      { employee_id: "p1", competency_id: "safety", required: 3, actual: 2, gap: 1 },
      { employee_id: "p2", competency_id: "safety", required: 3, actual: 0, gap: 3 },
    ]);
    expect(competencyCoverage(people, req, assessed)).toBe(50);
  });
});

describe("training need identification", () => {
  const base: FindInput = {
    people: [
      { id: "old", designation_id: "op", date_of_joining: "2024-01-10", status: "active" },
      { id: "new", designation_id: "op", date_of_joining: "2026-09-20", status: "active" },
    ],
    requirements: [{ designation_id: "op", competency_id: "measure", required_level: 3 }],
    assessed: [{ employee_id: "old", competency_id: "measure", level: 2 }, { employee_id: "new", competency_id: "measure", level: 1 }],
    competencyNames: { measure: "Measuring instruments" },
    ops: [ops[0]!], skills: [{ employee_id: "x", operation_id: "op10", level: 3 }, { employee_id: "old", operation_id: "op10", level: 2 }], minQualified: 2,
    programs: [
      { id: "ind", title: "Induction", category: "induction", competency_id: null, operation_id: null },
      { id: "saf", title: "Safety induction", category: "safety", competency_id: null, operation_id: null },
      { id: "qp", title: "Quality policy awareness", category: "awareness", competency_id: null, operation_id: null },
      { id: "mi", title: "Measuring instruments", category: "technical", competency_id: "measure", operation_id: null },
    ],
    attended: [{ employee_id: "old", program_id: "qp", on: "2026-03-01" }, { employee_id: "new", program_id: "ind", on: "2026-09-20" }],
    open: [], newJoinerDays: 30,
  };
  it("finds gaps, short operations, joiners' training and awareness — and nothing twice", () => {
    const n = findNeeds(base, ON);
    const by = (e: string) => n.filter((x) => x.employee_id === e).map((x) => `${x.source}:${x.program_id ?? x.operation_id}:${x.priority}`).sort();
    expect(by("old")).toEqual(["competency_gap:mi:normal", "skill_gap:op10:high"]);     // awareness done in March: not due
    expect(by("new")).toEqual(["competency_gap:mi:high", "new_joiner:qp:high", "new_joiner:saf:high"]);   // induction already attended
    // already open → not again (a retraining need for the same programme counts too)
    const again = findNeeds({ ...base, open: n.map((x) => ({ ...x })).concat([]) }, ON);
    expect(again).toEqual([]);
  });
  it("asks for awareness again after 12 months, and re-certification before it lapses", () => {
    const n = findNeeds({ ...base, attended: [{ employee_id: "old", program_id: "qp", on: "2025-08-01" }],
      skills: [{ employee_id: "old", operation_id: "op10", level: 3, valid_until: "2026-10-20" }, { employee_id: "x", operation_id: "op10", level: 3 }] }, ON);
    expect(n.filter((x) => x.employee_id === "old").map((x) => x.source).sort()).toEqual(["awareness", "competency_gap", "recertification"]);
  });
});

describe("training plan from the needs", () => {
  it("one session per programme per month, joining a planned session with room", () => {
    const needs = [
      { id: "n1", employee_id: "a", program_id: "mi", priority: "high", target_month: null },
      { id: "n2", employee_id: "b", program_id: "mi", priority: "high", target_month: null },
      { id: "n3", employee_id: "c", program_id: "mi", priority: "normal", target_month: null },
      { id: "n4", employee_id: "d", program_id: "saf", priority: "normal", target_month: "2026-10" },
      { id: "n5", employee_id: "e", program_id: null, priority: "high", target_month: null },
    ];
    const steps = planFromNeeds(needs, [{ id: "s1", program_id: "mi", plan_month: "2026-11", status: "planned", size: 19 }], "2026-10", 20);
    expect(steps.map((s) => [s.session_id, s.program_id, s.plan_month, s.employee_ids.join("")])).toEqual([
      ["s1", "mi", "2026-11", "a"], [null, "mi", "2026-11", "b"], [null, "mi", "2026-12", "c"], [null, "saf", "2026-10", "d"],
    ]);
  });
  it("month arithmetic crosses the year", () => expect(addMonths("2026-11", 2)).toBe("2027-01"));
});

describe("tests and KPIs", () => {
  it("post-test against the pass mark, with the gain", () => {
    expect(testOutcome(40, 75, 70)).toMatchObject({ passed: true, gain: 35 });
    expect(testOutcome(40, 55, 70).passed).toBe(false);
    expect(testOutcome(null, null, 70).passed).toBe(false);
  });
  it("KPI achievement for higher-better, lower-better and zero targets", () => {
    expect(kpiAchievement(420, 399, "higher")).toBe(95);
    expect(kpiAchievement(1.0, 0.5, "lower")).toBe(110);
    expect(kpiAchievement(1.0, 2.0, "lower")).toBe(50);
    expect(kpiAchievement(0, 0, "lower")).toBe(100);
    expect(kpiAchievement(0, 1, "lower")).toBe(50);
    expect(kpiAchievement(100, 500, "higher")).toBe(120);
    expect(kpiScore([{ achievement: 100, weight: 2 }, { achievement: 70, weight: 1 }])).toBe(90);
    expect(kpiScore([])).toBeNull();
  });
});

describe("internal auditors", () => {
  it("lapsed, lapsing, too few audits, qualified", () => {
    expect(auditorStatus({ valid_until: "2026-09-01", audits_per_year: 2, active: true }, 3, ON).tone).toBe("danger");
    expect(auditorStatus({ valid_until: "2026-11-15", audits_per_year: 2, active: true }, 3, ON).tone).toBe("warn");
    expect(auditorStatus({ valid_until: "2027-11-15", audits_per_year: 2, active: true }, 1, ON).text).toContain("1 of 2");
    expect(auditorStatus({ valid_until: null, audits_per_year: 2, active: true }, 2, ON).tone).toBe("ok");
  });
});
