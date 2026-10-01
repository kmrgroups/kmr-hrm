// Reads the facts out of a resume's text — name, e-mail, mobile, experience, CTC, notice period, location, education
// and the competencies it shows. Pure functions (no database), so every rule can be tested.
import { COMPETENCIES, CITIES } from "./vocab";
import { normalizeIndianMobile } from "@/lib/validators";

export interface ResumeProfile {
  full_name: string | null; email: string | null; phone: string | null; location: string | null;
  total_exp: number | null; current_ctc: number | null; expected_ctc: number | null; notice_days: number | null;
  education: string | null; current_company: string | null; current_designation: string | null; skills: string[];
}

/** lower case, punctuation as spaces — so "8D," "(SPC)" and "PPAP/APQP" all match on word boundaries */
export const norm = (s: string) => ` ${s.toLowerCase().replace(/&/g, " & ").replace(/[^a-z0-9&+#.%\- ]+/g, " ").replace(/\s+/g, " ")} `;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** does the (normalised) text contain the term as whole words? */
export function hasTerm(normText: string, term: string): boolean {
  const t = norm(term).trim();
  return new RegExp(`(^|[^a-z0-9])${esc(t)}(?=[^a-z0-9]|$)`).test(normText);
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const EDU_LINE = /\b(b\.?\s?e|b\.?\s?tech|m\.?\s?tech|diploma|iti|school|college|university|sslc|hsc|10th|12th|class|bachelor|master|degree|mba|b\.?\s?com|b\.?\s?sc|polytechnic|cgpa|percentage)\b/i;

/** months since year 0 for a "Mon YYYY", "MM/YYYY" or "YYYY" token; null when not a date */
function monthIndex(tok: string, now: Date, end: boolean): number | null {
  const t = tok.trim().toLowerCase();
  // "present": worked up to now, but the current month is not over yet
  if (/present|till\s*date|to\s*date|current|now|ongoing|today/.test(t)) return now.getFullYear() * 12 + now.getMonth() - 1;
  let m = t.match(/^([a-z]{3,9})[\s.,'’-]*(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)];
    if (mon != null) { let y = +m[2]; if (y < 100) y += y > 50 ? 1900 : 2000; return y * 12 + mon; }
    return null;
  }
  m = t.match(/^(\d{1,2})[/.-](\d{4})$/); if (m && +m[1] >= 1 && +m[1] <= 12) return +m[2] * 12 + (+m[1] - 1);
  m = t.match(/^(\d{4})$/); if (m && +m[1] > 1960 && +m[1] <= now.getFullYear() + 1) return +m[1] * 12 + (end ? 11 : 0);
  return null;
}

/** total years from the job date ranges ("Jan 2018 – Present", "06/2015 to 03/2019", "2012 - 2016"), overlaps counted once */
export function yearsFromRanges(text: string, now = new Date()): number | null {
  const DATE = String.raw`(?:[A-Za-z]{3,9}[\s.,'’-]*\d{2,4}|\d{1,2}[/.-]\d{4}|\d{4})`;
  const rx = new RegExp(`(${DATE})\\s*(?:-|–|—|to|till|until)\\s*(${DATE}|present|till\\s*date|to\\s*date|current|now|ongoing|today)`, "gi");
  const spans: [number, number][] = [];
  for (const line of text.split(/\n/)) {
    if (EDU_LINE.test(line)) continue;
    for (const m of line.matchAll(rx)) {
      const a = monthIndex(m[1], now, false), b = monthIndex(m[2], now, true);
      if (a == null || b == null || b < a || b - a > 12 * 45) continue;
      spans.push([a, b + 1]);
    }
  }
  if (!spans.length) return null;
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0, [s, e] = spans[0];
  for (const [a, b] of spans.slice(1)) { if (a <= e) e = Math.max(e, b); else { total += e - s; [s, e] = [a, b]; } }
  total += e - s;
  return Math.round((total / 12) * 10) / 10;
}

/** "6.5 LPA" / "6,50,000" / "65000 per month" → rupees per year */
export function rupeesPerYear(num: string, unit = ""): number | null {
  const v = parseFloat(num.replace(/,/g, ""));
  if (!isFinite(v) || v <= 0) return null;
  const u = unit.toLowerCase();
  if (/lpa|lakh|lac|\bl\b|^l$/.test(u)) return Math.round(v * 1e5);
  if (/month|pm|p\.m|per\s*month/.test(u)) return Math.round(v * 12);
  if (/cr/.test(u)) return Math.round(v * 1e7);
  if (v < 200) return Math.round(v * 1e5);          // "CTC: 6.5" — written in lakhs
  if (v < 300000) return Math.round(v * 12);        // a monthly figure
  return Math.round(v);
}

const ctcAfter = (text: string, label: RegExp) => {
  const m = text.match(new RegExp(`(?:${label.source})` + String.raw`[^0-9\n]{0,25}([\d,]+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|per\s*month|pm\b|p\.m\.?|per\s*annum|pa\b|cr\w*)?`, "i"));
  return m ? rupeesPerYear(m[1], m[2] || "") : null;
};

export function parseResume(text: string, now = new Date()): ResumeProfile {
  const t = text.replace(/\r/g, "");
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0]?.toLowerCase() ?? null;
  let phone: string | null = null;
  for (const m of t.matchAll(/(?:\+?91[\s-]*)?(?:0)?[6-9](?:[\s-]?\d){9}/g)) { const p = normalizeIndianMobile(m[0]); if (p) { phone = p; break; } }

  // name: the first short line of words near the top that is not a heading or contact line
  let full_name: string | null = null;
  for (const l of lines.slice(0, 8)) {
    const s = l.replace(/^(name\s*[:\-]\s*)/i, "").replace(/[|•·].*$/, "").trim();
    if (/resume|curriculum|vitae|\bcv\b|profile|objective|summary|@|\d{4,}|address|mobile|phone|email/i.test(s)) continue;
    if (/^[A-Za-z][A-Za-z.'\s]{2,40}$/.test(s) && s.split(/\s+/).length <= 5) { const n = s.replace(/\s+/g, " "); full_name = (n === n.toUpperCase() ? n.toLowerCase() : n).replace(/\b([a-z])/g, (c) => c.toUpperCase()); break; }
  }

  // experience: a stated total wins; else the job date ranges
  let total_exp: number | null = null;
  const st = t.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and|&)?\s*(\d{1,2})\s*months?)?[^.\n]{0,40}experience|experience[^.\n]{0,30}?(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i);
  if (st) { const y = parseFloat(st[1] ?? st[3]); const mo = st[2] ? +st[2] / 12 : 0; if (y <= 45) total_exp = Math.round((y + mo) * 10) / 10; }
  if (total_exp == null) total_exp = yearsFromRanges(t, now);
  // "Production supervisor, 4 years, auto components": a plain "N years" near the top, outside the education lines
  if (total_exp == null) for (const l of lines.slice(0, 15)) {
    if (EDU_LINE.test(l) || /\bage\b|old\b|notice|warranty|guarantee/i.test(l)) continue;
    const y = l.match(/(?:^|[\s,(])(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b/i);
    if (y && +y[1] <= 45) { total_exp = +y[1]; break; }
  }

  const current_ctc = ctcAfter(t, /(?:current|present|existing)\s*(?:ctc|salary|package)|\bctc\b(?!\s*expected)/);
  const expected_ctc = ctcAfter(t, /expected\s*(?:ctc|salary|package)/);

  let notice_days: number | null = null;
  const nm = t.match(/notice\s*(?:period)?[^0-9\n]{0,15}(\d{1,3})\s*(days?|months?|weeks?)/i);
  if (nm) notice_days = /month/i.test(nm[2]) ? +nm[1] * 30 : /week/i.test(nm[2]) ? +nm[1] * 7 : +nm[1];
  else if (/notice[^\n]{0,25}(immediate|serving|0\s*days)|immediate\s*joiner|can\s*join\s*immediately/i.test(t)) notice_days = 0;

  let location: string | null = null;
  const lm = t.match(/(?:current\s*location|location|city|address)\s*[:\-]\s*([^\n]{2,60})/i);
  const low = norm(lm ? lm[1] : t.slice(0, 1500));
  const city = CITIES.find((c) => hasTerm(low, c)) ?? CITIES.find((c) => hasTerm(norm(t), c));
  if (city) location = city.replace(/\b([a-z])/g, (c) => c.toUpperCase());

  const EDU: [RegExp, string][] = [[/\bph\.?\s?d\b/i, "PhD"], [/\bm\.?\s?tech\b|\bm\.?\s?e\b(?=[\s.(,]|$)/i, "M.Tech / M.E"], [/\bmba\b|\bpgdm\b/i, "MBA"],
    [/\bb\.?\s?tech\b|\bb\.?\s?e\b(?=[\s.(,]|$)|bachelor of engineering/i, "B.E / B.Tech"], [/\bmca\b/i, "MCA"], [/\bm\.?\s?com\b/i, "M.Com"], [/\bb\.?\s?com\b/i, "B.Com"],
    [/\bb\.?\s?sc\b/i, "B.Sc"], [/\bdiploma\b|\bdme\b|\bdee\b|polytechnic/i, "Diploma"], [/\biti\b|\bncvt\b/i, "ITI"], [/\bca\b(?=[\s,.]|$)|chartered accountant/i, "CA"]];
  const education = EDU.filter(([rx]) => rx.test(t)).map(([, n]) => n).slice(0, 3).join(", ") || null;

  // current role: "currently working as X at Y" or the first "X at Y" / "Company – Designation" line in the experience part
  let current_company: string | null = null, current_designation: string | null = null;
  const cw = t.match(/currently\s+(?:working|employed)\s+(?:as\s+(?:an?\s+)?([A-Za-z .&/-]{3,50}?))?\s*(?:at|with|in)\s+([A-Z][A-Za-z0-9 .&,()-]{2,60})/i);
  if (cw) { current_designation = cw[1]?.trim() || null; current_company = cw[2].replace(/[.,]$/, "").trim(); }

  const nt = norm(t);
  const skills = Object.entries(COMPETENCIES).filter(([, terms]) => terms.some((x) => hasTerm(nt, x))).map(([n]) => n);
  return { full_name, email, phone, location, total_exp, current_ctc, expected_ctc, notice_days, education, current_company, current_designation, skills };
}
