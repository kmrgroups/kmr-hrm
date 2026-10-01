// The Roles, Responsibilities, Authority, Competency & KPI sheet of a position, written from its approved job
// description (ISO 9001 5.3, 7.2, 6.2 / 9.1.1; IATF 16949 5.3.1, 7.2.1). It describes the POSITION — Position title +
// Role + Department — never a person or a designation. HR edits and approves it; competency mapping, KPI sheets and
// training needs are built from it.
import { familyByKey } from "@/lib/recruit/vocab";
import { roleAreas } from "@/lib/recruit/roles";
import { kpiDefault } from "./kpi-catalog";

export interface SheetCompetency { name: string; level: number; category: string }
export interface SheetKpi { name: string; unit: string | null; target: number | null; direction: "higher" | "lower"; frequency: string; review_method: string; data_source: string | null }
export interface Sheet { purpose: string | null; roles: string[]; responsibilities: string[]; authorities: string[]; competencies: SheetCompetency[]; kpis: SheetKpi[] }

const FAMILY_AUTHORITY: Record<string, string[]> = {
  quality: ["Accept or reject product against the specification", "Hold dispatch of suspect product", "Raise a corrective action request on any department or supplier"],
  production: ["Stop the line on a quality, safety or delivery risk", "Segregate and rework as per the reaction plan"],
  maintenance: ["Take a machine out of production for safety or repair", "Apply lock-out tag-out"],
  engineering: ["Release process documents and engineering changes after approval"],
  ppc: ["Decide the daily production sequence to protect customer delivery"],
  purchase: ["Release purchase orders within the approved limit"],
  hr: ["Issue appointment and statutory documents as per policy"],
  accounts: ["Release payments within the approved limit"],
  sales: ["Accept customer orders within the agreed terms"],
  ehs: ["Stop any unsafe work", "Issue and close work permits"],
  it: ["Grant and remove system access as per the access policy"],
  operator: ["Stop the machine on a quality or safety doubt"],
};

export function competencyCategory(name: string): string {
  if (/safety|ehs|hse|fire|loto|lock-out/i.test(name)) return "safety";
  if (/leader|people|manage/i.test(name)) return "management";
  if (/iatf|iso 9001|core tools|problem|quality|audit|inspection|metrolog|statistic|six sigma|supplier quality|customer quality|apqp|fmea|spc|msa|8d/i.test(name)) return "quality";
  if (/communication|excel|reporting|documentation|discipline|5s/i.test(name)) return "behavioural";
  return "technical";
}

const isSenior = (title: string) => /head|manager|incharge|in-charge|lead|chief|senior|sr\b/i.test(title);

export function sheetFromJd(jd: { title: string; family: string | null; purpose: string | null; responsibilities: string[]; kpis: string[]; must_have: { name: string; weight: number }[] },
  position: { title: string; role: string | null }): Sheet {
  const areas = roleAreas(position.role);
  const fam = familyByKey(jd.family);
  const senior = isSenior(position.title);
  // no repeats, and no line that another line already says ("Apply lock-out tag-out" ⊂ "… and permit to work")
  const uniq = (a: string[]) => a.filter((x, i) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i
    && !a.some((y) => y !== x && y.toLowerCase().startsWith(x.toLowerCase())));
  const roles = uniq([...areas.map((a) => a.label), ...(position.role && !areas.length ? position.role.split(/[,&+/]| and /i).map((r) => r.trim()) : []), ...(fam && fam.key !== "general" ? [fam.label] : [])]);
  return {
    purpose: jd.purpose,
    roles,
    responsibilities: uniq(jd.responsibilities),
    authorities: uniq([...areas.flatMap((a) => a.authorities), ...(FAMILY_AUTHORITY[jd.family ?? ""] ?? []), "Stop work on a safety doubt"]).slice(0, 8),
    competencies: jd.must_have.map((c) => ({ name: c.name, level: Math.min(4, Math.max(1, Math.min(3, c.weight)) + (senior && c.weight >= 3 ? 1 : 0)), category: competencyCategory(c.name) })),
    kpis: uniq(jd.kpis).map((k) => ({ name: k, ...kpiDefault(k) })),
  };
}

export const SHEET_CLAUSES = "ISO 9001:2015 cl. 5.3, 6.2, 7.1.2, 7.2, 9.1.1  |  IATF 16949:2016 cl. 5.3.1, 5.3.2, 7.2.1, 7.2.2";
