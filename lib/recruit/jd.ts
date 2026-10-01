// Job description draft from a requisition — written from the role family's knowledge (lib/recruit/vocab.ts).
// Free and instant; HR edits and approves the draft, and the approved JD is reused for the next opening.
import { detectFamily, familyByKey, QMS_CONTEXT, type Family } from "./vocab";

export interface JdInput {
  title: string;
  designation?: string | null;
  department?: string | null;
  plant?: string | null;
  company?: string | null;
  family?: string | null;           // HR may pick the family; otherwise detected from the words above
  expMin?: number | null;
  expMax?: number | null;
  reportingTo?: string | null;
  location?: string | null;
}

export interface JdDraft {
  title: string; family: string; purpose: string; responsibilities: string[]; kpis: string[];
  must_have: { name: string; weight: number }[]; good_to_have: { name: string; weight: number }[];
  qualifications: string; experience: string; reporting_to: string; context: string; outcomes: string[];
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

/** "3–6 years" / "at least 5 years" / "freshers welcome" */
export function experienceText(min?: number | null, max?: number | null): string {
  const a = min ?? null, b = max ?? null;
  if (a == null && b == null) return "As per the role";
  if ((a ?? 0) === 0 && (b == null || b === 0)) return "Freshers welcome";
  if (a != null && b != null && b > a) return `${trim(a)}–${trim(b)} years`;
  if (a != null) return `At least ${trim(a)} year${a === 1 ? "" : "s"}`;
  return `Up to ${trim(b!)} years`;
}
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function draftJd(inp: JdInput): JdDraft {
  const fam: Family = familyByKey(inp.family) ?? detectFamily(inp.designation, inp.title, inp.department);
  const senior = (inp.expMin ?? 0) >= 5 || /manager|head|lead|senior|sr\.?|incharge|in-charge|chief/i.test(`${inp.title} ${inp.designation ?? ""}`);
  const vars = { title: inp.title, department: inp.department || fam.label, company: inp.company || "the company" };
  const resp = [...fam.responsibilities];
  if (senior) resp.push("Lead and develop the team; set targets, review performance and build backups for key skills");
  return {
    title: inp.title,
    family: fam.key,
    purpose: fill(fam.purpose, vars),
    responsibilities: resp,
    kpis: [...fam.kpis],
    must_have: fam.must.map(([name, weight]) => ({ name, weight })).concat(senior && !fam.must.some(([n]) => n === "People leadership") ? [{ name: "People leadership", weight: 2 }] : []),
    good_to_have: fam.good.map((name) => ({ name, weight: 1 })),
    qualifications: senior ? fam.qualification.senior : fam.qualification.junior,
    experience: experienceText(inp.expMin, inp.expMax),
    reporting_to: inp.reportingTo || (senior ? "Plant Head" : `${fam.label} Manager`),
    context: [QMS_CONTEXT, inp.plant ? `plant: ${inp.plant}` : "", inp.location ? `location: ${inp.location}` : ""].filter(Boolean).join("; "),
    outcomes: [...fam.outcomes],
  };
}

/** Plain-text JD for the careers page and to paste on Naukri / LinkedIn / Indeed. */
type JdLike = { title: string; purpose: string | null; responsibilities: string[]; kpis: string[]; must_have: { name: string }[]; good_to_have: { name: string }[];
  qualifications: string | null; experience: string | null; reporting_to: string | null };
export function jdText(jd: JdLike, extra?: { company?: string; location?: string; ctc?: string }): string {
  const lines = [
    jd.title + (extra?.company ? ` — ${extra.company}` : ""),
    extra?.location ? `Location: ${extra.location}` : "",
    jd.experience ? `Experience: ${jd.experience}` : "", extra?.ctc ? `Salary: ${extra.ctc}` : "", "",
    "About the role", jd.purpose ?? "", "",
    "What you will do", ...jd.responsibilities.map((r) => `• ${r}`), "",
    "What you need", ...jd.must_have.map((m) => `• ${m.name}`), "",
    jd.good_to_have.length ? "Good to have" : "", ...jd.good_to_have.map((m) => `• ${m.name}`), jd.good_to_have.length ? "" : "",
    jd.qualifications ? `Qualification: ${jd.qualifications}` : "", jd.reporting_to ? `Reports to: ${jd.reporting_to}` : "", "",
    "How we will measure success", ...jd.kpis.map((k) => `• ${k}`),
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}
