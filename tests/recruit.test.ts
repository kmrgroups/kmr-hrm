import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { detectFamily } from "../lib/recruit/vocab";
import { draftJd, experienceText, jdText } from "../lib/recruit/jd";
import { parseResume, yearsFromRanges, rupeesPerYear } from "../lib/recruit/resume";
import { scoreResume } from "../lib/recruit/score";
import { breakupForCtc, breakupForGross } from "../lib/recruit/offer";
import { buildIcs } from "../lib/recruit/ics";
import { docxText } from "../lib/recruit/resume-text";
import type { Component, PaySettings } from "../lib/payroll/compute";

const NOW = new Date("2026-10-01T00:00:00Z");

const QUALITY_RESUME = `ARUN KUMAR S
Quality Engineer | arun.kumar88@gmail.com | +91 98450 12345 | Hosur, Tamil Nadu

PROFILE
Quality engineer with 5 years of experience in automotive Tier-1 machining plants (IATF 16949).

EXPERIENCE
Precision Auto Components Pvt Ltd, Hosur — Quality Engineer          Jun 2021 – Present
• Reduced line rejection from 2.1% to 0.6% through poka-yoke and process audits on CNC turning cells
• Handled Hyundai and TVS customer complaints with 8D; customer PPM brought down from 180 to 45
• Prepared PPAP, PFMEA and control plans for 14 new parts; Cpk studies on critical characteristics
Sri Ganesh Engineering, Chennai — Inspector                             Jul 2019 – May 2021
• Incoming and final inspection with CMM, height gauge and micrometers; calibration records

EDUCATION
B.E. Mechanical Engineering, Anna University                           2015 – 2019

Current CTC: 4.8 LPA    Expected CTC: 6 LPA    Notice period: 30 days`;

const SALES_RESUME = `Priya Sharma
priya.s@outlook.com  9876501234  Pune
Sales executive with 3 years in FMCG distribution. Achieved 120% of target in 2024.
Key account handling, order booking, retailer visits.
Education: B.Com, Pune University 2017-2020
Expected salary 9 LPA. Notice period 3 months.`;

const QE_ROLE = () => {
  const jd = draftJd({ title: "Quality Engineer", designation: "Quality Engineer", department: "Quality", expMin: 3, expMax: 6 });
  return { ...jd, exp_min: 3, exp_max: 6, ctc_max: 700000, notice_max_days: 60, location: "Hosur" };
};

describe("role family", () => {
  it("is found from the designation, and 'engineer' alone does not win", () => {
    expect(detectFamily("Quality Engineer", "Production").key).toBe("quality");
    expect(detectFamily("Sales Engineer").key).toBe("sales");
    expect(detectFamily("Maintenance Engineer").key).toBe("maintenance");
    expect(detectFamily("Design Engineer").key).toBe("engineering");
    expect(detectFamily("CNC Operator").key).toBe("operator");
    expect(detectFamily("Store Keeper").key).toBe("ppc");
    expect(detectFamily("HR Executive").key).toBe("hr");
    expect(detectFamily("Office Assistant").key).toBe("general");
  });
});

describe("JD draft", () => {
  it("writes a full JD for the role, with weighted competencies", () => {
    const jd = draftJd({ title: "Quality Engineer", department: "Quality", expMin: 3, expMax: 6, company: "Test Forge" });
    expect(jd.family).toBe("quality");
    expect(jd.responsibilities.length).toBeGreaterThan(5);
    expect(jd.must_have.map((m) => m.name)).toContain("Problem solving (8D, RCA, CAPA)");
    expect(jd.experience).toBe("3–6 years");
    expect(jdText(jd)).toContain("What you will do");
  });
  it("adds team leadership for senior roles", () => {
    const jd = draftJd({ title: "Quality Manager", expMin: 10 });
    expect(jd.must_have.some((m) => m.name === "People leadership")).toBe(true);
    expect(jd.qualifications).toMatch(/B\.E/);
  });
  it("words the experience band", () => {
    expect(experienceText(0, 0)).toBe("Freshers welcome");
    expect(experienceText(5, null)).toBe("At least 5 years");
    expect(experienceText(2.5, 4)).toBe("2.5–4 years");
  });
});

describe("resume reading", () => {
  it("reads the facts of a resume", () => {
    const p = parseResume(QUALITY_RESUME, NOW);
    expect(p.full_name).toBe("Arun Kumar S");
    expect(p.email).toBe("arun.kumar88@gmail.com");
    expect(p.phone).toBe("9845012345");
    expect(p.total_exp).toBe(5);
    expect(p.current_ctc).toBe(480000);
    expect(p.expected_ctc).toBe(600000);
    expect(p.notice_days).toBe(30);
    expect(p.location).toBe("Hosur");
    expect(p.education).toContain("B.E / B.Tech");
    expect(p.skills).toEqual(expect.arrayContaining(["Problem solving (8D, RCA, CAPA)", "Core tools (APQP, PPAP, FMEA, SPC, MSA)", "Quality improvement"]));
  });
  it("works out experience from job dates, overlaps once, ignoring study years", () => {
    expect(yearsFromRanges("Jan 2018 - Dec 2019\nJan 2019 - Dec 2020\nB.E 2010 - 2014", NOW)).toBe(3);
    expect(yearsFromRanges("ABC Ltd 06/2020 to Present", NOW)).toBe(6.3);
  });
  it("reads salary in lakhs, per month or in rupees", () => {
    expect(rupeesPerYear("6.5", "LPA")).toBe(650000);
    expect(rupeesPerYear("45,000", "per month")).toBe(540000);
    expect(rupeesPerYear("7")).toBe(700000);
    expect(rupeesPerYear("6,50,000")).toBe(650000);
  });
  it("notice in months; months-only experience is not mistaken", () => {
    const p = parseResume(SALES_RESUME, NOW);
    expect(p.notice_days).toBe(90);
    expect(p.expected_ctc).toBe(900000);
    expect(p.location).toBe("Pune");
  });
  it("reads a Word .docx", () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t>Ravi &amp; Sons</w:t></w:r></w:p><w:p><w:r><w:t>8D and PPAP</w:t></w:r></w:p></w:body></w:document>`;
    const bytes = zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<Types/>") });
    expect(docxText(bytes)).toContain("Ravi & Sons\n8D and PPAP");
  });
});

describe("match score", () => {
  it("rates a strong quality resume as suitable, with evidence lines", () => {
    const r = scoreResume(QUALITY_RESUME, parseResume(QUALITY_RESUME, NOW), QE_ROLE());
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.recommendation).toBe("suitable");
    expect(r.flags).toEqual([]);
    expect(r.evidence.some((e) => /2\.1% to 0\.6%/.test(e.line))).toBe(true);
    expect(r.breakdown.reduce((a, p) => a + p.max, 0)).toBe(100);
  });
  it("understands results without the competency's own words", () => {
    // no "quality", no "8D" — but a measured reduction of rejections is quality-improvement capability
    const text = "Machinist, 4 years. Reduced line rejection from 3% to 1% on the turning cell by changing the clamping.";
    const r = scoreResume(text, parseResume(text, NOW), QE_ROLE());
    expect(r.evidence.find((e) => e.competency === "Quality improvement")?.line).toMatch(/Reduced line rejection/);
  });
  it("rates an unrelated resume as not suitable and flags broken limits", () => {
    const r = scoreResume(SALES_RESUME, parseResume(SALES_RESUME, NOW), QE_ROLE());
    expect(r.score).toBeLessThan(50);
    expect(r.recommendation).toBe("not_suitable");
    expect(r.flags.join(" ")).toMatch(/Notice 90 days/);
    expect(r.flags.join(" ")).toMatch(/above the/);
  });
  it("never calls a resume suitable when a hard limit is broken", () => {
    const long = QUALITY_RESUME.replace("Notice period: 30 days", "Notice period: 90 days");
    const r = scoreResume(long, parseResume(long, NOW), QE_ROLE());
    expect(r.recommendation).toBe("hold");
  });
});

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

describe("offer CTC", () => {
  it("a monthly gross gives the same deductions as payroll, plus employer cost and gratuity", () => {
    const b = breakupForGross(17500, S, C, { pfApplicable: true, includeGratuity: true });
    expect(b.monthly_gross).toBe(17500);
    expect(b.deductions.map((d) => [d.code, d.monthly])).toEqual([["PF", 1050], ["ESI", 132]]);   // same as the payroll test
    expect(b.net_monthly).toBe(16318);
    expect(b.gratuity?.monthly).toBe(Math.round(8750 * 0.0481));
    expect(b.ctc_monthly).toBe(17500 + b.employer.reduce((a, e) => a + e.monthly, 0) + b.gratuity!.monthly);
  });
  it("a yearly CTC finds the monthly gross that gives it", () => {
    const b = breakupForCtc(600000, S, C, { pfApplicable: true, includeGratuity: true });
    expect(b.ctc_annual).toBeLessThanOrEqual(600000);
    expect(600000 - b.ctc_annual).toBeLessThan(40);
    expect(b.monthly_gross).toBeGreaterThan(44000);
    const noPf = breakupForCtc(600000, S, C, { pfApplicable: false, includeGratuity: false });
    expect(noPf.monthly_gross).toBe(50000);
  });
});

describe("calendar invite", () => {
  it("has the event, the attendees and a reminder", () => {
    const ics = buildIcs({ uid: "iv-1@hrm", start: new Date("2026-10-05T04:30:00Z"), durationMin: 45, title: "Interview: Arun, Quality Engineer",
      description: "Round 1, technical", location: "Plant 1, Hosur", organizer: { name: "HR", email: "hr@testforge.in" }, attendees: [{ name: "Ravi", email: "ravi@testforge.in" }] });
    expect(ics).toContain("DTSTART:20261005T043000Z");
    expect(ics).toContain("DTEND:20261005T051500Z");
    expect(ics).toContain("ATTENDEE;CN=Ravi");
    expect(ics).toContain("LOCATION:Plant 1\\, Hosur");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});

describe("resume reading — more layouts", () => {
  it("finds a plain 'N years' near the top, but not ages or warranty", () => {
    expect(parseResume("Karthik R\nProduction supervisor, 4 years, auto components (forging)\nDiploma 2016", NOW).total_exp).toBe(4);
    expect(parseResume("Ravi\nAge 28 years\nB.E 2019", NOW).total_exp).toBe(null);
  });
});
