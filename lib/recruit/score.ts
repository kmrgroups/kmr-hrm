// Match score 0–100 of a resume against what the role really needs — free, explainable, no AI service.
// The JD becomes a "role intent profile" (competencies with weights, operating context, outcomes, experience band,
// hard limits). The resume becomes an "evidence profile": the lines where the person shows each competency, preferring
// lines with results ("reduced rejection from 2.1% to 0.6%") over a bare skills list.
import { COMPETENCIES, CONTEXT_TERMS, familyByKey } from "./vocab";
import { hasTerm, norm, type ResumeProfile } from "./resume";

export interface RoleIntent {
  must_have: { name: string; weight: number }[];
  good_to_have: { name: string; weight: number }[];
  family?: string | null;
  context?: string | null;
  outcomes?: string[];
  exp_min?: number | null; exp_max?: number | null;
  ctc_max?: number | null;           // yearly
  notice_max_days?: number | null;
  location?: string | null;
}
export interface ScorePart { key: string; label: string; points: number; max: number; note: string }
export interface ScoreResult {
  score: number; breakdown: ScorePart[]; evidence: { competency: string; line: string }[]; flags: string[];
  recommendation: "suitable" | "hold" | "not_suitable"; must_coverage: number;
}

/** words of a competency: its listed terms, else the words of its own name */
export function termsOf(name: string): string[] {
  const known = COMPETENCIES[name];
  if (known) return known;
  return name.toLowerCase().split(/[\s/(),]+/).filter((w) => w.length > 2 && !["and", "the", "with", "for"].includes(w)).concat(name.toLowerCase());
}

const RESULT = /(\d+(\.\d+)?\s*%|\bppm\b|\d+\s*(lakh|lakhs|lacs|cr|crore|inr|rs)|reduc|improv|increas|achiev|sav(ed|ing)|cut |brought|eliminat|zero |from \d|to \d|award|won|led |implemented|introduced|developed|established)/i;

/** resume lines (sentences / bullets) — the evidence is quoted from these */
export function evidenceLines(text: string): string[] {
  return text.replace(/\r/g, "").split(/\n|(?<=[.;])\s+(?=[A-Z])|•|▪|●|◦|·/).map((l) => l.replace(/\s+/g, " ").trim().replace(/^[-–*>»✓✔•]+\s*/, "")).filter((l) => l.length >= 12 && l.length <= 320);
}

/** how well the resume shows one competency: 1 = in a line with results/action, 0.6 = mentioned, 0 = absent */
function evidenceFor(name: string, lines: { raw: string; n: string }[], whole: string): { level: number; line?: string } {
  const terms = termsOf(name);
  if (!terms.some((t) => hasTerm(whole, t))) return { level: 0 };
  const hits = lines.filter((l) => terms.some((t) => hasTerm(l.n, t)));
  const strong = hits.find((l) => RESULT.test(l.raw) && l.raw.length > 30);
  if (strong) return { level: 1, line: strong.raw };
  return { level: 0.6, line: hits.sort((a, b) => b.raw.length - a.raw.length)[0]?.raw };
}

export function scoreResume(text: string, p: ResumeProfile, role: RoleIntent, thresholds = { suitable: 70, hold: 50 }): ScoreResult {
  const whole = norm(text), lines = evidenceLines(text).map((raw) => ({ raw, n: norm(raw) }));
  const parts: ScorePart[] = [], evidence: { competency: string; line: string }[] = [], flags: string[] = [];
  const r1 = (n: number) => Math.round(n * 10) / 10;

  // 1. must-have competencies (40)
  const must = role.must_have.length ? role.must_have : [{ name: "Communication & documentation", weight: 1 }];
  let mw = 0, mg = 0; const missing: string[] = [];
  for (const c of must) {
    const e = evidenceFor(c.name, lines, whole); mw += c.weight; mg += c.weight * e.level;
    if (e.line) evidence.push({ competency: c.name, line: e.line }); if (!e.level) missing.push(c.name);
  }
  const mustCov = mw ? mg / mw : 0;
  parts.push({ key: "must", label: "Must-have competencies", points: r1(40 * mustCov), max: 40,
    note: missing.length ? `Not shown: ${missing.join(", ")}` : "All shown in the resume" });

  // 2. good-to-have (10)
  let gw = 0, gg = 0;
  for (const c of role.good_to_have) { const e = evidenceFor(c.name, lines, whole); gw += c.weight; gg += c.weight * e.level; if (e.line && e.level === 1) evidence.push({ competency: c.name, line: e.line }); }
  parts.push({ key: "good", label: "Good-to-have", points: r1(gw ? (10 * gg) / gw : 5), max: 10, note: gw ? `${Math.round((gg / gw) * 100)}% shown` : "None listed" });

  // 3. experience fit (15)
  const exp = p.total_exp, lo = role.exp_min ?? null, hi = role.exp_max ?? null;
  let ep = 7.5, enote = "Experience not stated";
  if (exp != null) {
    if ((lo == null || exp >= lo) && (hi == null || exp <= hi)) { ep = 15; enote = `${exp} years — within the band`; }
    else if (lo != null && exp < lo) { ep = Math.max(0, 15 * (1 - (lo - exp) / Math.max(2, lo))); enote = `${exp} years — ${r1(lo - exp)} below the minimum`; if (lo - exp >= 2) flags.push(`Experience ${exp} y is below the ${lo} y minimum`); }
    else { const over = exp - (hi ?? exp); ep = over > 5 ? 9 : 12; enote = `${exp} years — above the band${over > 5 ? " (may be over-qualified)" : ""}`; }
  }
  parts.push({ key: "exp", label: "Experience", points: r1(ep), max: 15, note: enote });

  // 4. operating context: industry, plant, standards (10)
  const ctxWords = [...new Set([...CONTEXT_TERMS, ...(role.context || "").toLowerCase().split(/[;,/]| \(|\)/).map((s) => s.trim()).filter((s) => s.length > 3 && s.length < 30)])];
  const ctxHits = ctxWords.filter((w) => hasTerm(whole, w));
  parts.push({ key: "context", label: "Industry & plant context", points: Math.min(10, ctxHits.length * 2.5), max: 10,
    note: ctxHits.length ? `Shows: ${ctxHits.slice(0, 5).join(", ")}` : "No matching industry context" });

  // 5. results delivered in the role's areas (10)
  const fam = familyByKey(role.family);
  const areaTerms = [...must, ...role.good_to_have].flatMap((c) => termsOf(c.name)).concat((role.outcomes || []).flatMap((o) => o.toLowerCase().split(/\s+/).filter((w) => w.length > 4)));
  const results = lines.filter((l) => RESULT.test(l.raw) && /\d/.test(l.raw) && areaTerms.some((t) => hasTerm(l.n, t)));
  parts.push({ key: "results", label: "Results in the role's areas", points: [0, 5, 8, 10][Math.min(3, results.length)], max: 10,
    note: results.length ? `${results.length} result${results.length > 1 ? "s" : ""} with numbers` : "No measurable results found" });
  for (const r of results.slice(0, 2)) if (!evidence.some((e) => e.line === r.raw)) evidence.push({ competency: "Result", line: r.raw });

  // 6. qualification (5)
  const eduOk = fam ? fam.education.test(text) : !!p.education;
  parts.push({ key: "edu", label: "Qualification", points: eduOk ? 5 : p.education ? 3 : 2, max: 5, note: p.education ? p.education : "Not found" });

  // 7. hard limits: notice period, salary, location (10)
  let lp = 0; const lnotes: string[] = [];
  if (role.notice_max_days == null || p.notice_days == null) { lp += p.notice_days == null && role.notice_max_days != null ? 2 : 4; lnotes.push(p.notice_days == null ? "notice not stated" : `notice ${p.notice_days} d`); }
  else if (p.notice_days <= role.notice_max_days) { lp += 4; lnotes.push(`notice ${p.notice_days} d ok`); }
  else { flags.push(`Notice ${p.notice_days} days is over the ${role.notice_max_days}-day limit`); lnotes.push(`notice ${p.notice_days} d too long`); }
  const want = p.expected_ctc ?? (p.current_ctc != null ? p.current_ctc * 1.2 : null);
  if (role.ctc_max == null || want == null) { lp += want == null && role.ctc_max != null ? 2 : 4; lnotes.push(want == null ? "salary not stated" : "salary ok"); }
  else if (want <= role.ctc_max * 1.1) { lp += 4; lnotes.push("salary within budget"); }
  else { flags.push(`Expected salary ₹${(want / 1e5).toFixed(1)} L is above the ₹${(role.ctc_max / 1e5).toFixed(1)} L budget`); lnotes.push("salary above budget"); }
  if (!role.location || !p.location) { lp += 1; } else if (role.location.toLowerCase().includes(p.location.toLowerCase()) || p.location.toLowerCase().includes(role.location.toLowerCase().split(/[ ,]/)[0])) { lp += 2; lnotes.push("same city"); } else { lp += 1; lnotes.push(`in ${p.location}`); }
  parts.push({ key: "limits", label: "Notice, salary, location", points: lp, max: 10, note: lnotes.join("; ") });

  let score = Math.round(parts.reduce((a, x) => a + x.points, 0));
  score = Math.max(0, Math.min(100, score));
  let recommendation: ScoreResult["recommendation"] = score >= thresholds.suitable ? "suitable" : score >= thresholds.hold ? "hold" : "not_suitable";
  // a resume that misses most must-haves, or breaks a hard limit, is never a straight "suitable"
  if (recommendation === "suitable" && (mustCov < 0.5 || flags.length)) recommendation = "hold";
  return { score, breakdown: parts, evidence: evidence.slice(0, 10), flags, recommendation, must_coverage: Math.round(mustCov * 100) / 100 };
}
