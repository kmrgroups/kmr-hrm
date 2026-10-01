import { describe, it, expect } from "vitest";
import { byGroup, cleanQuestions, engagementIndex, enps, questionResults, suggestionStats, surveyOpen, SUG_NEXT, MIN_GROUP, type Question } from "@/lib/engage/rules";
import { SURVEY_TEMPLATES } from "@/lib/engage/templates";

const Q: Question[] = [
  { id: "q1", text: "Recommend?", type: "enps", required: true },
  { id: "q2", text: "Tools", type: "rating", required: true },
  { id: "q3", text: "Bus", type: "choice", options: ["Good", "Late"], required: true },
  { id: "q4", text: "Stay?", type: "yesno", required: true },
  { id: "q5", text: "Improve", type: "text", required: false },
];

describe("engagement arithmetic", () => {
  it("eNPS = % promoters − % detractors", () => {
    expect(enps([10, 9, 8, 7, 6, 0]).score).toBe(0);          // 2 promoters, 2 detractors of 6
    expect(enps([10, 10, 9, 9]).score).toBe(100);
    expect(enps([]).score).toBeNull();
  });

  it("question results: averages, favourable %, counts, comments", () => {
    const r = questionResults(Q, [
      { answers: { q1: 10, q2: 5, q3: "Good", q4: "yes", q5: "More fans" } },
      { answers: { q1: 3, q2: 4, q3: "Late", q4: "no", q5: "" } },
      { answers: { q1: 9, q2: 2, q3: "Late", q4: "yes" } },
      { answers: { q1: 8, q2: 3, q3: "Good", q4: "yes", q5: "Bus timing" } },
    ]);
    expect(r[0]!.enps!.score).toBe(25);                        // 2 promoters, 1 detractor of 4
    expect(r[1]!.average).toBe(3.5); expect(r[1]!.favourable).toBe(50);
    expect(r[2]!.counts).toEqual([{ label: "Good", n: 2 }, { label: "Late", n: 2 }]);
    expect(r[3]!.counts).toEqual([{ label: "Yes", n: 3 }, { label: "No", n: 1 }]);
    expect(r[4]!.comments).toEqual(["More fans", "Bus timing"]);
    expect(engagementIndex(r)).toBe(50);
  });

  it("groups under 5 answers are never shown on their own", () => {
    const rs = [...Array(6)].map((_, i) => ({ answers: { q2: 5 }, department_id: "A", i }))
      .concat([...Array(3)].map(() => ({ answers: { q2: 1 }, department_id: "B", i: 0 })))
      .concat([...Array(2)].map(() => ({ answers: { q2: 2 }, department_id: "C", i: 0 })));
    const g = byGroup(Q, rs, "department_id");
    expect(g.map((x) => x.group)).toEqual(["A", "__other"]);   // B (3) and C (2) only together, as "others" (5)
    expect(g[0]!.index).toBe(100); expect(g[1]!.n).toBe(5); expect(g[1]!.index).toBe(0);
    const tiny = byGroup(Q, rs.filter((x) => x.department_id !== "A").slice(0, 4), "department_id");
    expect(tiny).toEqual([]);                                    // 4 answers in all: nothing shown
    expect(MIN_GROUP).toBe(5);
  });

  it("question builder: types, choices, ids", () => {
    const q = cleanQuestions([{ text: " Food  quality ", type: "rating", options: "", required: true }, { text: "", type: "rating", options: "", required: true },
      { text: "Bus", type: "choice", options: "Good, Late, Good", required: true }, { text: "Comments", type: "text", options: "", required: false }]);
    expect(Array.isArray(q) && q.map((x) => [x.id, x.text, x.type, x.options ?? null, x.required])).toEqual([
      ["q1", "Food quality", "rating", null, true], ["q2", "Bus", "choice", ["Good", "Late"], true], ["q3", "Comments", "text", null, false]]);
    expect(cleanQuestions([{ text: "Bus", type: "choice", options: "Good", required: true }])).toMatch(/two choices/);
    expect(cleanQuestions([{ text: "x", type: "weird", options: "", required: true }])).toMatch(/answer type/);
    expect(cleanQuestions([])).toMatch(/at least one/);
  });

  it("a survey is open only while open and within its dates", () => {
    expect(surveyOpen({ status: "open", opens_on: "2026-10-01", closes_on: "2026-10-10" }, "2026-10-05")).toBe(true);
    expect(surveyOpen({ status: "open", opens_on: "2026-10-06", closes_on: null }, "2026-10-05")).toBe(false);
    expect(surveyOpen({ status: "open", opens_on: null, closes_on: "2026-10-04" }, "2026-10-05")).toBe(false);
    expect(surveyOpen({ status: "closed", opens_on: null, closes_on: null }, "2026-10-05")).toBe(false);
  });

  it("suggestion figures", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const s = suggestionStats([
      { status: "implemented", created_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-05T00:00:00Z", saving_per_year: 48000, category: "quality", employee_id: "a" },
      { status: "not_taken", created_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-15T00:00:00Z", saving_per_year: null, category: "other", employee_id: "a" },
      { status: "submitted", created_at: "2026-10-02T00:00:00Z", decided_at: null, saving_per_year: null, category: "cost", employee_id: "b" },
      { status: "under_review", created_at: "2026-10-18T00:00:00Z", decided_at: null, saving_per_year: null, category: "cost", employee_id: "c" },
    ], 20, now);
    expect(s).toMatchObject({ total: 4, people: 3, per100: 20, participation: 15, implemented: 1, implementedPct: 25, saving: 48000, waiting: 2, waitingOver7: 1, decidedIn7Pct: 50 });
  });

  it("a suggestion moves only forward (and implemented is final)", () => {
    expect(SUG_NEXT.submitted).toContain("accepted");
    expect(SUG_NEXT.accepted).toContain("implemented");
    expect(SUG_NEXT.submitted).not.toContain("implemented");
    expect(SUG_NEXT.implemented).toEqual([]);
  });

  it("the ready surveys are valid", () => {
    for (const t of SURVEY_TEMPLATES) {
      const again = cleanQuestions(t.questions.map((q) => ({ text: q.text, type: q.type, options: (q.options ?? []).join(","), required: !!q.required })));
      expect(Array.isArray(again)).toBe(true);
      expect(new Set(t.questions.map((q) => q.id)).size).toBe(t.questions.length);
    }
  });
});
