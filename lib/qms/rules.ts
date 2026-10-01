// QMS people-development rules — plain functions (no database), so they are easy to test and explain to an auditor.
// Clause references: IATF 16949 7.2.1 (competence, training needs), 7.2.2 (OJT), 7.2.3 (internal auditors), 7.3 (awareness);
// ISO 9001 5.3 (roles), 6.2 / 9.1 (objectives and KPIs), 7.2 (competence, effectiveness).

export const SKILL_LEVELS = [
  { level: 0, short: "0", label: "Not trained", hint: "Must not work on this operation" },
  { level: 1, short: "1", label: "Under training", hint: "Works only with the trainer beside him" },
  { level: 2, short: "2", label: "Under supervision", hint: "Works with a qualified person checking" },
  { level: 3, short: "3", label: "Qualified", hint: "Works alone; meets output and quality" },
  { level: 4, short: "4", label: "Trainer", hint: "Can train and certify others" },
] as const;
export const QUALIFIED = 3;

export const COMP_LEVELS = ["Not shown", "Awareness", "Basic — with guidance", "Proficient — independent", "Expert — can teach"];

export const COMP_CATEGORIES: Record<string, string> = {
  technical: "Technical", quality: "Quality & core tools", safety: "Safety", behavioural: "Behavioural", management: "Management",
};
export const PROGRAM_CATEGORIES: Record<string, string> = {
  induction: "Induction", safety: "Safety", quality: "Quality", technical: "Technical", awareness: "Awareness (IATF 7.3)",
  core_tools: "Core tools", behavioural: "Behavioural", ojt: "On-the-job",
};
export const EVAL_METHODS: Record<string, string> = {
  test: "Test (pre and post)", observation: "Supervisor observes on the job", kpi: "KPI change", signoff: "Sign-off only (awareness)",
};
export const NEED_SOURCES: Record<string, string> = {
  competency_gap: "Competency gap", skill_gap: "Skill-matrix gap", new_joiner: "New joiner", process_change: "Process / product change",
  customer_complaint: "Customer complaint / 8D", audit_finding: "Audit finding", request: "Request", retraining: "Retraining (not effective)",
  awareness: "Awareness", recertification: "Re-certification due",
};
export const NEED_STATUS: Record<string, string> = { open: "Open", planned: "Planned", trained: "Trained", closed: "Closed", cancelled: "Cancelled" };
export const EFF_RESULTS: Record<string, string> = { effective: "Effective", partly: "Partly effective", not_effective: "Not effective" };
export const AUDITOR_KINDS: Record<string, string> = { qms: "System (QMS)", process: "Process", product: "Product", supplier: "Supplier" };
export const STANDARDS = ["IATF 16949", "ISO 9001", "VDA 6.3", "VDA 6.5", "ISO 14001", "ISO 45001"];
export const CORE_TOOLS = ["APQP", "PPAP", "FMEA", "SPC", "MSA"];

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

// ------------------------------------------------------------------ skill matrix coverage
export interface Operation { id: string; line: string; code: string; name: string; critical: boolean; min_qualified: number | null; safety_required?: boolean }
export interface SkillRow { employee_id: string; operation_id: string; level: number; valid_until?: string | null }
export interface Coverage {
  operation_id: string; qualified: number; trainers: number; inTraining: number; min: number;
  short: boolean;            // fewer qualified people than needed
  singlePoint: boolean;      // exactly one qualified person: no backup
  expired: number;           // qualified people whose re-certification date has passed
  alert: string | null;
}

/** Who is qualified (level 3–4 and not past re-certification) per operation, and what is wrong */
export function coverage(ops: Operation[], rows: SkillRow[], minDefault: number, on = today()): Coverage[] {
  return ops.map((o) => {
    const mine = rows.filter((r) => r.operation_id === o.id);
    const expired = mine.filter((r) => r.level >= QUALIFIED && r.valid_until && r.valid_until < on).length;
    const qualified = mine.filter((r) => r.level >= QUALIFIED && !(r.valid_until && r.valid_until < on)).length;
    const min = o.min_qualified ?? minDefault;
    const short = qualified < min, singlePoint = qualified === 1;
    let alert: string | null = null;
    if (qualified === 0) alert = `Nobody is qualified on ${o.code}${o.critical ? " — a critical operation" : ""}`;
    else if (short) alert = `${qualified} qualified on ${o.code}, ${min} needed`;
    else if (singlePoint) alert = `Only one person is qualified on ${o.code}: no backup`;
    if (expired) alert = [alert, `${expired} re-certification${expired > 1 ? "s" : ""} overdue on ${o.code}`].filter(Boolean).join("; ");
    return { operation_id: o.id, qualified, trainers: mine.filter((r) => r.level === 4).length, inTraining: mine.filter((r) => r.level > 0 && r.level < QUALIFIED).length,
      min, short, singlePoint, expired, alert };
  });
}

// ------------------------------------------------------------------ competency gaps
export interface Requirement { designation_id: string; competency_id: string; required_level: number }
export interface Assessment { employee_id: string; competency_id: string; level: number }
export interface Person { id: string; designation_id: string | null; date_of_joining?: string | null; status?: string }
export interface Gap { employee_id: string; competency_id: string; required: number; actual: number; gap: number }

export function competencyGaps(people: Person[], req: Requirement[], assessed: Assessment[]): Gap[] {
  const lvl = new Map(assessed.map((a) => [`${a.employee_id}|${a.competency_id}`, a.level]));
  const out: Gap[] = [];
  for (const p of people) {
    if (!p.designation_id) continue;
    for (const r of req.filter((x) => x.designation_id === p.designation_id)) {
      const actual = lvl.get(`${p.id}|${r.competency_id}`) ?? 0;
      if (actual < r.required_level) out.push({ employee_id: p.id, competency_id: r.competency_id, required: r.required_level, actual, gap: r.required_level - actual });
    }
  }
  return out;
}

/** share of the required competencies met, 0–100 (for one person or a group) */
export function competencyCoverage(people: Person[], req: Requirement[], assessed: Assessment[]): number {
  let need = 0, met = 0;
  const lvl = new Map(assessed.map((a) => [`${a.employee_id}|${a.competency_id}`, a.level]));
  for (const p of people) for (const r of req.filter((x) => x.designation_id === p.designation_id)) {
    need += 1; if ((lvl.get(`${p.id}|${r.competency_id}`) ?? 0) >= r.required_level) met += 1;
  }
  return need ? Math.round((met / need) * 100) : 100;
}

// ------------------------------------------------------------------ training need identification
export interface Program { id: string; title: string; category: string; competency_id: string | null; operation_id: string | null; active?: boolean }
export interface NeedDraft {
  employee_id: string; program_id: string | null; competency_id: string | null; operation_id: string | null;
  topic: string; source: string; reason: string; priority: "high" | "normal" | "low"; target_month: string;
}
export interface FindInput {
  people: Person[]; requirements: Requirement[]; assessed: Assessment[]; competencyNames: Record<string, string>;
  ops: Operation[]; skills: SkillRow[]; minQualified: number;
  programs: Program[];
  attended: { employee_id: string; program_id: string; on: string }[];   // attended sessions
  open: { employee_id: string; source: string; competency_id: string | null; operation_id: string | null; program_id: string | null }[];
  newJoinerDays: number;
}

/**
 * Finds what training each person needs, from the records alone:
 *  • a competency below the level his designation needs → the programme that builds it (high when 2+ levels short)
 *  • an operation short of qualified people → the people already learning it (level 1–2) go next; overdue re-certification
 *  • a new joiner (within N days) without induction, safety induction and quality awareness
 *  • awareness of the quality policy not refreshed for 12 months (IATF 7.3)
 * Needs already open for the same thing are not added again.
 */
export function findNeeds(inp: FindInput, on = today()): NeedDraft[] {
  const month = on.slice(0, 7), next = addMonths(month, 1);
  const out: NeedDraft[] = [];
  const has = (emp: string, source: string, key: { competency_id?: string | null; operation_id?: string | null; program_id?: string | null }) =>
    inp.open.some((n) => n.employee_id === emp && (n.source === source || n.source === "retraining") &&
      ((key.competency_id && n.competency_id === key.competency_id) || (key.operation_id && n.operation_id === key.operation_id) || (key.program_id && n.program_id === key.program_id)))
    || out.some((n) => n.employee_id === emp && ((key.competency_id && n.competency_id === key.competency_id) || (key.operation_id && n.operation_id === key.operation_id) || (key.program_id && n.program_id === key.program_id)));
  const active = inp.people.filter((p) => !p.status || ["active", "invited", "onboarding", "submitted"].includes(p.status));
  const progFor = (competency: string) => inp.programs.find((p) => p.active !== false && p.competency_id === competency) ?? null;
  const progByCat = (cat: string, word: RegExp) => inp.programs.find((p) => p.active !== false && p.category === cat && word.test(p.title)) ?? null;
  const attendedProg = (emp: string, prog: string, withinDays?: number) =>
    inp.attended.some((a) => a.employee_id === emp && a.program_id === prog && (withinDays == null || daysBetween(a.on, on) <= withinDays));

  // 1. competency gaps
  for (const g of competencyGaps(active, inp.requirements, inp.assessed)) {
    const prog = progFor(g.competency_id);
    if (has(g.employee_id, "competency_gap", { competency_id: g.competency_id, program_id: prog?.id })) continue;
    const name = inp.competencyNames[g.competency_id] ?? "Competency";
    out.push({ employee_id: g.employee_id, program_id: prog?.id ?? null, competency_id: g.competency_id, operation_id: null, topic: prog?.title ?? name,
      source: "competency_gap", reason: `${name}: level ${g.actual} of ${g.required} needed for the role`, priority: g.gap >= 2 ? "high" : "normal",
      target_month: g.gap >= 2 ? next : addMonths(month, 2) });
  }

  // 2. skill matrix: short operations, and overdue re-certification
  const cov = coverage(inp.ops, inp.skills, inp.minQualified, on);
  for (const c of cov) {
    const op = inp.ops.find((o) => o.id === c.operation_id)!;
    if (c.short || c.singlePoint) {
      const learners = inp.skills.filter((s) => s.operation_id === op.id && s.level >= 1 && s.level < QUALIFIED).sort((a, b) => b.level - a.level);
      for (const l of learners.slice(0, Math.max(1, c.min - c.qualified))) {
        if (!active.some((p) => p.id === l.employee_id) || has(l.employee_id, "skill_gap", { operation_id: op.id })) continue;
        out.push({ employee_id: l.employee_id, program_id: null, competency_id: null, operation_id: op.id, topic: `${op.code} ${op.name}`, source: "skill_gap",
          reason: c.alert ?? `More qualified people needed on ${op.code}`, priority: op.critical || c.qualified === 0 ? "high" : "normal", target_month: next });
      }
    }
    for (const s of inp.skills.filter((x) => x.operation_id === op.id && x.level >= QUALIFIED && x.valid_until && x.valid_until < addDaysIso(on, 30))) {
      if (!active.some((p) => p.id === s.employee_id) || has(s.employee_id, "recertification", { operation_id: op.id })) continue;
      out.push({ employee_id: s.employee_id, program_id: null, competency_id: null, operation_id: op.id, topic: `Re-certify on ${op.code} ${op.name}`, source: "recertification",
        reason: s.valid_until! < on ? `Certification lapsed on ${s.valid_until}` : `Certification lapses on ${s.valid_until}`, priority: s.valid_until! < on ? "high" : "normal", target_month: month });
    }
  }

  // 3. new joiners: induction, safety induction, quality awareness
  const induction = progByCat("induction", /./), safety = progByCat("safety", /induction/i), awareness = progByCat("awareness", /policy/i);
  for (const p of active.filter((x) => x.date_of_joining && daysBetween(x.date_of_joining, on) <= inp.newJoinerDays && daysBetween(x.date_of_joining, on) >= -60)) {
    for (const prog of [induction, safety, awareness]) {
      if (!prog || attendedProg(p.id, prog.id) || has(p.id, "new_joiner", { program_id: prog.id })) continue;
      out.push({ employee_id: p.id, program_id: prog.id, competency_id: prog.competency_id, operation_id: null, topic: prog.title, source: "new_joiner",
        reason: `Joined on ${p.date_of_joining}`, priority: "high", target_month: (p.date_of_joining! > on ? p.date_of_joining! : on).slice(0, 7) });
    }
  }

  // 4. awareness refreshed every year (quality policy, objectives, product safety)
  if (awareness) {
    for (const p of active.filter((x) => !x.date_of_joining || daysBetween(x.date_of_joining, on) > inp.newJoinerDays)) {
      if (attendedProg(p.id, awareness.id, 365) || has(p.id, "awareness", { program_id: awareness.id }) || has(p.id, "new_joiner", { program_id: awareness.id })) continue;
      out.push({ employee_id: p.id, program_id: awareness.id, competency_id: null, operation_id: null, topic: awareness.title, source: "awareness",
        reason: "Not refreshed in the last 12 months", priority: "normal", target_month: addMonths(month, 1) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the training plan from the needs
export interface OpenNeed { id: string; employee_id: string; program_id: string | null; priority: string; target_month: string | null }
export interface PlannedSession { id: string; program_id: string; plan_month: string; status: string; size: number }
export interface PlanStep { session_id: string | null; program_id: string; plan_month: string; need_ids: string[]; employee_ids: string[] }

/**
 * Puts open needs into sessions: one session per programme per month (the need's target month, or by priority —
 * high next month, normal in 2 months, low in 4), joining a session already planned for that month when there is
 * room (batch size), otherwise a new one. Needs without a programme stay open for HR to decide.
 */
export function planFromNeeds(needs: OpenNeed[], sessions: PlannedSession[], month: string, batch = 20): PlanStep[] {
  const steps: PlanStep[] = [];
  const room = new Map(sessions.filter((s) => s.status === "planned" || s.status === "scheduled").map((s) => [s.id, batch - s.size]));
  for (const n of needs) {
    if (!n.program_id) continue;
    let m = n.target_month && n.target_month >= month ? n.target_month : addMonths(month, n.priority === "high" ? 1 : n.priority === "low" ? 4 : 2);
    if (m < month) m = month;
    let step = steps.find((s) => s.program_id === n.program_id && s.plan_month === m && (s.session_id ? (room.get(s.session_id) ?? 0) > 0 : s.employee_ids.length < batch) && !s.employee_ids.includes(n.employee_id));
    if (!step) {
      const ex = sessions.find((s) => s.program_id === n.program_id && s.plan_month === m && (s.status === "planned" || s.status === "scheduled") && (room.get(s.id) ?? 0) > 0);
      step = { session_id: ex?.id ?? null, program_id: n.program_id, plan_month: m, need_ids: [], employee_ids: [] };
      steps.push(step);
    }
    step.need_ids.push(n.id); step.employee_ids.push(n.employee_id);
    if (step.session_id) room.set(step.session_id, (room.get(step.session_id) ?? 0) - 1);
  }
  return steps;
}

// ------------------------------------------------------------------ effectiveness and tests
/** Test result: passed when the post-test reaches the pass mark (and shows learning when there is a pre-test) */
export function testOutcome(pre: number | null, post: number | null, pass: number): { passed: boolean; gain: number | null; note: string } {
  if (post == null) return { passed: false, gain: null, note: "No post-test score" };
  const gain = pre == null ? null : post - pre;
  const passed = post >= pass;
  return { passed, gain, note: `${post}% after${pre != null ? ` (${pre}% before, ${gain! >= 0 ? "+" : ""}${gain})` : ""}; pass mark ${pass}%` };
}

export function effectivenessDue(sessionDate: string, days: number): string { return addDaysIso(sessionDate, days); }

// ------------------------------------------------------------------ KPIs
/** How far a KPI met its target, as a % (capped at 120). For "lower is better", meeting the target is 100. */
export function kpiAchievement(target: number, actual: number, direction: "higher" | "lower"): number {
  let v: number;
  if (direction === "higher") v = target === 0 ? (actual >= 0 ? 100 : 0) : (actual / target) * 100;
  else if (target === 0) v = actual <= 0 ? 100 : Math.max(0, 100 - actual * 50);      // zero-target KPIs (incidents): each one costs half
  else v = actual <= target ? 100 + Math.min(20, ((target - actual) / target) * 20) : (target / actual) * 100;
  return Math.round(Math.max(0, Math.min(120, v)) * 10) / 10;
}
/** Weighted score of several KPIs for one person / month */
export function kpiScore(items: { achievement: number; weight: number }[]): number | null {
  const w = items.reduce((s, i) => s + i.weight, 0);
  return w ? Math.round((items.reduce((s, i) => s + i.achievement * i.weight, 0) / w) * 10) / 10 : null;
}

// ------------------------------------------------------------------ internal auditors
export interface AuditorRow { valid_until: string | null; audits_per_year: number; active: boolean }
export function auditorStatus(a: AuditorRow, auditsLast12: number, on = today()): { tone: "ok" | "warn" | "danger"; text: string } {
  if (!a.active) return { tone: "warn", text: "Not active" };
  if (a.valid_until && a.valid_until < on) return { tone: "danger", text: `Qualification lapsed on ${a.valid_until}` };
  if (a.valid_until && daysBetween(on, a.valid_until) <= 60) return { tone: "warn", text: `Qualification lapses on ${a.valid_until}` };
  if (auditsLast12 < a.audits_per_year) return { tone: "warn", text: `${auditsLast12} of ${a.audits_per_year} audits in the last 12 months` };
  return { tone: "ok", text: "Qualified" };
}
