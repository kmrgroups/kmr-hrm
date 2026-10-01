import { describe, it, expect } from "vitest";
import { draftJd } from "@/lib/recruit/jd";
import { roleAreas } from "@/lib/recruit/roles";
import { sheetFromJd, competencyCategory } from "@/lib/qms/sheet";
import { kpiDefault } from "@/lib/qms/kpi-catalog";

describe("position = Position + Role + Department", () => {
  it("finds every area a Role names", () => {
    expect(roleAreas("Shopfloor & manpower handling").map((a) => a.key)).toEqual(["shopfloor", "manpower"]);
    expect(roleAreas("Calibration & gauge control").map((a) => a.key)).toEqual(["calibration"]);
    expect(roleAreas("")).toEqual([]);
  });

  it("the job description is written for the role, with HR's competencies first", () => {
    const jd = draftJd({ title: "Calibration Incharge", department: "Quality", role: "Calibration & gauge control", competencies: ["Gauge R&R studies"] });
    expect(jd.family).toBe("quality");
    expect(jd.responsibilities[0]).toMatch(/calibration plan/i);
    expect(jd.must_have[0]).toEqual({ name: "Gauge R&R studies", weight: 3 });
    expect(jd.must_have.find((m) => m.name === "Inspection & metrology")?.weight).toBe(3);
    // the department's general template only adds the background when the role names its areas
    expect(jd.kpis.slice(0, 2)).toEqual(["Calibration plan adherence %", "Gauges overdue for calibration"]);
    expect(jd.kpis.length).toBeLessThanOrEqual(4);
  });

  it("a position without a role still gets the department's full template", () => {
    const jd = draftJd({ title: "Quality Engineer", department: "Quality" });
    expect(jd.kpis).toContain("Customer PPM");
    expect(jd.responsibilities.length).toBeGreaterThanOrEqual(8);
  });
});

describe("R&R sheet from the job description", () => {
  const jd = draftJd({ title: "Production Head", department: "Production", role: "Shopfloor & manpower handling", expMin: 10 });
  const sh = sheetFromJd(jd, { title: "Production Head", role: "Shopfloor & manpower handling" });
  it("has roles, responsibilities, authority, competency and KPIs — and no person", () => {
    expect(sh.roles).toEqual(["Shopfloor handling", "Manpower handling", "Production"]);
    expect(sh.responsibilities.length).toBeGreaterThan(5);
    expect(sh.authorities).toContain("Stop the line on a quality, safety or delivery risk");
    expect(sh.competencies.length).toBeGreaterThan(2);
    expect(sh.kpis.find((k) => k.name === "OEE")).toMatchObject({ target: 75, direction: "higher", frequency: "monthly" });
    expect(JSON.stringify(sh)).not.toMatch(/designation/i);
  });
  it("a senior position needs a higher level of its key competencies", () => {
    const top = sh.competencies.find((c) => c.name === "People leadership")!;
    expect(top.level).toBe(4);
    const op = sheetFromJd(draftJd({ title: "CNC Operator", department: "Production", role: "Machine operation" }), { title: "CNC Operator", role: "Machine operation" });
    expect(Math.max(...op.competencies.map((c) => c.level))).toBe(3);
  });
  it("no line repeats another (“Apply lock-out tag-out” is inside “… and permit to work”)", () => {
    const m = sheetFromJd(draftJd({ title: "Maintenance Technician", department: "Maintenance", role: "Maintenance" }), { title: "Maintenance Technician", role: "Maintenance" });
    expect(m.authorities.filter((a) => /lock-out/i.test(a))).toEqual(["Apply lock-out tag-out and permit to work"]);
  });
  it("competency categories", () => {
    expect(competencyCategory("Health, safety & environment")).toBe("safety");
    expect(competencyCategory("Core tools (APQP, PPAP, FMEA, SPC, MSA)")).toBe("quality");
    expect(competencyCategory("People leadership")).toBe("management");
    expect(competencyCategory("CNC machining")).toBe("technical");
  });
});

describe("KPI defaults", () => {
  it("target, direction, review frequency and method", () => {
    expect(kpiDefault("Customer PPM")).toMatchObject({ unit: "PPM", target: 50, direction: "lower", frequency: "monthly" });
    expect(kpiDefault("Supplier PPM").target).toBe(500);
    expect(kpiDefault("MTTR")).toMatchObject({ direction: "lower", target: 2 });
    expect(kpiDefault("Plan vs actual output").frequency).toBe("daily");
    expect(kpiDefault("Something new")).toMatchObject({ target: null, review_method: "Monthly review by the reporting head" });
  });
});
