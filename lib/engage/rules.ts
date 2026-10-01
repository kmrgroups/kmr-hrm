// Engagement arithmetic — survey results, eNPS, suggestion and recognition figures. Pure functions (tested).

export type QType = "rating" | "enps" | "yesno" | "choice" | "text";
export interface Question { id: string; text: string; type: QType; options?: string[]; required?: boolean }
export interface Response { answers: Record<string, unknown>; department_id?: string | null; plant_id?: string | null }

/** results are shown for a group only when at least this many people answered (so nobody can be picked out) */
export const MIN_GROUP = 5;

export const Q_TYPES: Record<QType, string> = {
  rating: "Rating 1–5 (strongly disagree … strongly agree)", enps: "0–10: would you recommend us as a place to work",
  yesno: "Yes / No", choice: "One of a list", text: "Written answer",
};
export const RATING_LABELS = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

export const ANN_CATEGORIES: Record<string, string> = { general: "General", safety: "Safety", quality: "Quality", production: "Production", hr: "HR", event: "Event", policy: "Policy" };
export const REC_CATEGORIES: Record<string, string> = {
  safety: "Safety", quality: "Quality", kaizen: "Kaizen", teamwork: "Teamwork", customer: "Customer", delivery: "On-time delivery",
  attendance: "Attendance", helping: "Helping a colleague", long_service: "Long service", employee_of_month: "Employee of the month",
};
export const SUG_CATEGORIES: Record<string, string> = {
  safety: "Safety", quality: "Quality", productivity: "Productivity", cost: "Cost saving", "5s": "5S", environment: "Environment", ergonomics: "Ergonomics", other: "Other",
};
export const SUG_STATUS: Record<string, string> = {
  submitted: "New", under_review: "Under review", accepted: "Accepted — to be done", implemented: "Implemented", not_taken: "Not taken up", on_hold: "On hold",
};
/** what a reviewer may move a suggestion to from each state */
export const SUG_NEXT: Record<string, string[]> = {
  submitted: ["under_review", "accepted", "not_taken", "on_hold"],
  under_review: ["accepted", "not_taken", "on_hold"],
  accepted: ["implemented", "on_hold", "not_taken"],
  on_hold: ["under_review", "accepted", "not_taken"],
  implemented: [], not_taken: ["under_review"],
};

/** cleans and checks a question list from the builder; returns an error message or the list */
export function cleanQuestions(rows: { text: string; type: string; options: string; required: boolean }[]): Question[] | string {
  const out: Question[] = [];
  for (const r of rows) {
    const text = r.text.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text) continue;
    if (!(r.type in Q_TYPES)) return `Choose the answer type for “${text}”.`;
    const q: Question = { id: `q${out.length + 1}`, text, type: r.type as QType, required: r.type === "text" ? r.required : r.required !== false };
    if (r.type === "choice") {
      const opts = r.options.split(/[,\n;]/).map((o) => o.trim().slice(0, 80)).filter(Boolean).filter((o, i, a) => a.indexOf(o) === i);
      if (opts.length < 2) return `Give at least two choices for “${text}” (separate them with commas).`;
      q.options = opts.slice(0, 10);
    }
    out.push(q);
  }
  if (!out.length) return "Add at least one question.";
  if (out.length > 40) return "40 questions at most.";
  return out;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** eNPS: % promoters (9–10) minus % detractors (0–6), −100 … +100 */
export function enps(scores: number[]): { score: number | null; promoters: number; passives: number; detractors: number } {
  const promoters = scores.filter((s) => s >= 9).length, detractors = scores.filter((s) => s <= 6).length, passives = scores.length - promoters - detractors;
  return { score: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null, promoters, passives, detractors };
}

export interface QResult {
  id: string; text: string; type: QType; answered: number;
  average?: number | null;            // rating / enps
  favourable?: number | null;         // rating: % agree + strongly agree
  counts?: { label: string; n: number }[];
  enps?: ReturnType<typeof enps>;
  comments?: string[];
}

export function questionResults(questions: Question[], responses: Response[]): QResult[] {
  return questions.map((q) => {
    const vals = responses.map((r) => r.answers?.[q.id]).filter((v) => v !== undefined && v !== null && v !== "");
    const base: QResult = { id: q.id, text: q.text, type: q.type, answered: vals.length };
    if (q.type === "rating" || q.type === "enps") {
      const n = vals.map(num).filter((x): x is number => x !== null);
      base.answered = n.length;
      base.average = n.length ? Math.round((n.reduce((s, x) => s + x, 0) / n.length) * 10) / 10 : null;
      if (q.type === "rating") {
        base.favourable = n.length ? Math.round((n.filter((x) => x >= 4).length / n.length) * 100) : null;
        base.counts = [1, 2, 3, 4, 5].map((k) => ({ label: RATING_LABELS[k - 1]!, n: n.filter((x) => x === k).length }));
      } else {
        base.enps = enps(n);
        base.counts = Array.from({ length: 11 }, (_, k) => ({ label: String(k), n: n.filter((x) => x === k).length }));
      }
    } else if (q.type === "yesno") {
      base.counts = [{ label: "Yes", n: vals.filter((v) => v === "yes").length }, { label: "No", n: vals.filter((v) => v === "no").length }];
    } else if (q.type === "choice") {
      base.counts = (q.options ?? []).map((o) => ({ label: o, n: vals.filter((v) => v === o).length }));
    } else {
      base.comments = vals.map((v) => String(v).trim()).filter((v) => v.length > 0);
      base.answered = base.comments.length;
    }
    return base;
  });
}

/** the overall engagement index: average % favourable across the rating questions */
export function engagementIndex(results: QResult[]): number | null {
  const f = results.filter((r) => r.type === "rating" && r.favourable != null).map((r) => r.favourable!);
  return f.length ? Math.round(f.reduce((s, x) => s + x, 0) / f.length) : null;
}

/** results per group (department / plant) — only groups with MIN_GROUP or more answers; the rest are counted as "other" */
export function byGroup(questions: Question[], responses: Response[], key: "department_id" | "plant_id"): { group: string | null; n: number; index: number | null; enps: number | null }[] {
  const groups = new Map<string | null, Response[]>();
  for (const r of responses) { const g = r[key] ?? null; groups.set(g, [...(groups.get(g) ?? []), r]); }
  const out: { group: string | null; n: number; index: number | null; enps: number | null }[] = [];
  const small: Response[] = [];
  for (const [g, rs] of groups) {
    if (rs.length < MIN_GROUP) { small.push(...rs); continue; }
    const res = questionResults(questions, rs);
    out.push({ group: g, n: rs.length, index: engagementIndex(res), enps: res.find((x) => x.type === "enps")?.enps?.score ?? null });
  }
  out.sort((a, b) => b.n - a.n);
  if (small.length >= MIN_GROUP) {
    const res = questionResults(questions, small);
    out.push({ group: "__other", n: small.length, index: engagementIndex(res), enps: res.find((x) => x.type === "enps")?.enps?.score ?? null });
  }
  return out;
}

/** is the survey open today (status open and within its dates)? */
export function surveyOpen(s: { status: string; opens_on: string | null; closes_on: string | null }, today: string): boolean {
  return s.status === "open" && (!s.opens_on || s.opens_on <= today) && (!s.closes_on || s.closes_on >= today);
}

export interface SuggestionRow { status: string; created_at: string; decided_at: string | null; saving_per_year: number | null; category: string; employee_id: string }
/** suggestion figures for a period: how many came, from how many people, decided within 7 days, implemented, saving */
export function suggestionStats(rows: SuggestionRow[], headcount: number, now = new Date()) {
  const decided = rows.filter((r) => r.decided_at);
  const fast = decided.filter((r) => (new Date(r.decided_at!).getTime() - new Date(r.created_at).getTime()) / 864e5 <= 7).length;
  const waiting = rows.filter((r) => ["submitted", "under_review"].includes(r.status));
  const late = waiting.filter((r) => (now.getTime() - new Date(r.created_at).getTime()) / 864e5 > 7).length;
  const implemented = rows.filter((r) => r.status === "implemented");
  return {
    total: rows.length, people: new Set(rows.map((r) => r.employee_id)).size,
    per100: headcount ? Math.round((rows.length / headcount) * 1000) / 10 : null,
    participation: headcount ? Math.round((new Set(rows.map((r) => r.employee_id)).size / headcount) * 100) : null,
    implemented: implemented.length, implementedPct: rows.length ? Math.round((implemented.length / rows.length) * 100) : null,
    saving: implemented.reduce((s, r) => s + Number(r.saving_per_year ?? 0), 0),
    waiting: waiting.length, waitingOver7: late, decidedIn7Pct: decided.length ? Math.round((fast / decided.length) * 100) : null,
  };
}
