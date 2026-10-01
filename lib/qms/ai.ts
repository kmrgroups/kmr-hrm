import "server-only";
// What the free AI does in the QMS — and only this. The rules of the HRM decide what is a gap, a need or a finding;
// the AI writes drafts (job description, R&R sheet, training programmes, test questions) and ranks findings.
// Every answer is checked before it is used; anything it writes is marked as AI-drafted until a named person accepts
// or approves it; every run is logged. When the AI is off, not set up or does not answer, the HRM's own
// rule-based writer is used instead — the work never stops for it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { askAi, aiConfigured, extractJson, type AiResult } from "@/lib/ai/gateway";
import { COMPETENCIES } from "@/lib/recruit/vocab";
import { draftJd, type JdDraft, type JdInput } from "@/lib/recruit/jd";
import { sheetFromJd, competencyCategory, type Sheet, type SheetKpi } from "./sheet";
import { kpiDefault } from "./kpi-catalog";

export interface Actor { tenantId: string; userId: string | null; userName: string | null }

const SYSTEM = "You are a senior HR and quality-systems specialist (IATF 16949, ISO 9001) in an Indian automotive / engineering manufacturing plant. " +
  "Write plain, short, practical English that shop-floor people understand. Never name a person. Answer with one JSON object only — no text around it.";

// ------------------------------------------------------------------ helpers
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strArr = (v: unknown, maxItems = 20, maxLen = 220) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, maxLen).replace(/^[-•*\d.)\s]+/, "")).filter((x) => x.length >= 3)
    .filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).slice(0, maxItems);
const int = (v: unknown, lo: number, hi: number, def: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const FREQ = ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"];

export async function aiOn(db: SupabaseClient, tenantId: string): Promise<boolean> {
  if (!aiConfigured()) return false;
  const { data } = await db.from("qms_settings").select("ai_enabled").eq("tenant_id", tenantId).maybeSingle();
  return data?.ai_enabled !== false;
}

export async function logRun(a: Actor, run: { agent: string; subject: string; r: AiResult | null; used: "ai" | "rules" | "none"; summary?: string; output?: unknown; error?: string }) {
  await createAdminClient().from("ai_runs").insert({
    tenant_id: a.tenantId, agent: run.agent, subject: run.subject.slice(0, 300), ok: !!run.r?.ok && run.used === "ai", provider: run.r?.provider ?? null, model: run.r?.model ?? null,
    used: run.used, summary: run.summary?.slice(0, 2000) ?? null, output: run.output ?? null,
    error: (run.error ?? (run.r && !run.r.ok ? [run.r.error, ...(run.r.attempts ?? [])].filter(Boolean).join(" | ") : null))?.slice(0, 2000) ?? null,
    ms: run.r?.ms ?? null, created_by: a.userId, created_by_name: a.userName,
  });
}

// ------------------------------------------------------------------ 1. job description of a position
export async function smartJd(db: SupabaseClient, actor: Actor, inp: JdInput): Promise<{ draft: JdDraft; model: string | null }> {
  const rule = draftJd(inp);
  const subject = `${inp.title}${inp.role ? ` — ${inp.role}` : ""}${inp.department ? ` (${inp.department})` : ""}`;
  if (!(await aiOn(db, actor.tenantId))) return { draft: rule, model: null };
  const prompt = `Write the job description of this POSITION (not of a person) for a manufacturing company.
Position: ${inp.title}
Role (the areas this position handles): ${inp.role || "(not given)"}
Department: ${inp.department || "(not given)"}
Experience: ${rule.experience}
Competencies HR says it needs: ${(inp.competencies ?? []).join("; ") || "(none named)"}

A first draft made by rules is below; improve it so it fits THIS position and role exactly — specific, measurable, no filler:
${JSON.stringify({ purpose: rule.purpose, responsibilities: rule.responsibilities, kpis: rule.kpis, must_have: rule.must_have, qualifications: rule.qualifications })}

For competency names, prefer these where they fit (they are recognised in resumes): ${Object.keys(COMPETENCIES).join("; ")}.
Answer as JSON: {"purpose": "one or two sentences", "responsibilities": ["8 to 12 lines, each starting with a verb"],
"kpis": ["4 to 7 measurable KPI names, e.g. 'Customer PPM', 'Calibration plan adherence %'"],
"must_have": [{"name": "competency", "weight": 1-3}], "good_to_have": ["competency"], "qualifications": "short", "reporting_to": "position title", "outcomes": ["2 or 3 results the position must deliver"]}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 1800 });
  const j = r.ok ? extractJson<Record<string, unknown>>(r.text!) : null;
  const resp = strArr(j?.responsibilities, 14), kpis = strArr(j?.kpis, 8, 80);
  const must = (Array.isArray(j?.must_have) ? j!.must_have as unknown[] : []).map((m) => {
    const o = (typeof m === "string" ? { name: m, weight: 2 } : m) as { name?: unknown; weight?: unknown };
    return { name: str(o.name, 80), weight: int(o.weight, 1, 3, 2) };
  }).filter((m) => m.name.length >= 2).slice(0, 10);
  if (!j || resp.length < 5 || kpis.length < 2 || must.length < 2) {
    await logRun(actor, { agent: "jd", subject, r, used: "rules", error: r.ok ? "The AI's answer was incomplete; the rule-based draft was used." : undefined });
    return { draft: rule, model: null };
  }
  // HR's own competencies always stay, at the top weight
  for (const c of inp.competencies ?? []) { const m = must.find((x) => x.name.toLowerCase() === c.toLowerCase()); if (m) m.weight = 3; else must.unshift({ name: c, weight: 3 }); }
  const draft: JdDraft = { ...rule, purpose: str(j.purpose, 600) || rule.purpose, responsibilities: resp, kpis, must_have: must.slice(0, 10),
    good_to_have: strArr(j.good_to_have, 6, 80).filter((g) => !must.some((m) => m.name.toLowerCase() === g.toLowerCase())).map((name) => ({ name, weight: 1 })),
    qualifications: str(j.qualifications, 300) || rule.qualifications, reporting_to: str(j.reporting_to, 120) || rule.reporting_to, outcomes: strArr(j.outcomes, 4, 160).length ? strArr(j.outcomes, 4, 160) : rule.outcomes };
  await logRun(actor, { agent: "jd", subject, r, used: "ai", summary: `${resp.length} responsibilities, ${kpis.length} KPIs, ${must.length} competencies`, output: draft });
  return { draft, model: `${r.provider}/${r.model}` };
}

// ------------------------------------------------------------------ 2. R&R sheet of a position
export async function smartSheet(db: SupabaseClient, actor: Actor, jd: Parameters<typeof sheetFromJd>[0] & { qualifications?: string | null }, position: { title: string; role: string | null; department?: string | null }): Promise<{ sheet: Sheet; model: string | null }> {
  const rule = sheetFromJd(jd, position);
  const subject = `${position.title}${position.role ? ` — ${position.role}` : ""}`;
  if (!(await aiOn(db, actor.tenantId))) return { sheet: rule, model: null };
  const prompt = `From this approved job description, write the Roles, Responsibilities, Authority, Competency and KPI sheet of the POSITION
"${position.title}" (role: ${position.role || "-"}, department: ${position.department || "-"}). It describes the position, never a person.
Job description: ${JSON.stringify({ purpose: jd.purpose, responsibilities: jd.responsibilities, kpis: jd.kpis, must_have: jd.must_have })}
A rule-based sheet for comparison: ${JSON.stringify({ roles: rule.roles, authorities: rule.authorities, competencies: rule.competencies, kpis: rule.kpis })}
Competency levels: 1 awareness, 2 basic with guidance, 3 proficient and independent, 4 expert who can teach. Heads / in-charges usually need 3–4 in their core areas.
KPI frequency must be one of ${FREQ.join(", ")}; direction "higher" or "lower" (which is better); target a number (use 0 for "zero incidents"); review_method says who reviews it, in which meeting.
Answer as JSON: {"roles": ["2 to 5 short role names"], "responsibilities": ["8 to 14 lines, verb first"], "authorities": ["3 to 8 decisions this position may take alone, e.g. 'Stop the line on a quality doubt'"],
"competencies": [{"name": "...", "level": 1-4}], "kpis": [{"name": "...", "unit": "%", "target": 98, "direction": "higher", "frequency": "monthly", "review_method": "...", "data_source": "..."}]}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 2200 });
  const j = r.ok ? extractJson<Record<string, unknown>>(r.text!) : null;
  const comps = (Array.isArray(j?.competencies) ? j!.competencies as { name?: unknown; level?: unknown }[] : [])
    .map((c) => ({ name: str(c?.name, 100), level: int(c?.level, 1, 4, 3) })).filter((c) => c.name.length >= 2)
    .filter((c, i, a) => a.findIndex((y) => y.name.toLowerCase() === c.name.toLowerCase()) === i).slice(0, 12)
    .map((c) => ({ ...c, category: competencyCategory(c.name) }));
  const kpis: SheetKpi[] = (Array.isArray(j?.kpis) ? j!.kpis as Record<string, unknown>[] : []).map((k) => {
    const name = str(k?.name, 100), d = kpiDefault(name), t = Number(k?.target);
    return { name, unit: str(k?.unit, 20) || d.unit, target: Number.isFinite(t) ? t : d.target, direction: k?.direction === "lower" ? "lower" : k?.direction === "higher" ? "higher" : d.direction,
      frequency: FREQ.includes(String(k?.frequency)) ? String(k?.frequency) : d.frequency, review_method: str(k?.review_method, 200) || d.review_method, data_source: str(k?.data_source, 200) || d.data_source } as SheetKpi;
  }).filter((k) => k.name.length >= 3).slice(0, 10);
  const resp = strArr(j?.responsibilities, 16), auth = strArr(j?.authorities, 8), roles = strArr(j?.roles, 6, 80);
  if (!j || resp.length < 5 || comps.length < 2 || kpis.length < 2 || auth.length < 2) {
    await logRun(actor, { agent: "sheet", subject, r, used: "rules", error: r.ok ? "The AI's answer was incomplete; the rule-based sheet was used." : undefined });
    return { sheet: rule, model: null };
  }
  const sheet: Sheet = { purpose: jd.purpose, roles: roles.length ? roles : rule.roles, responsibilities: resp, authorities: auth, competencies: comps, kpis };
  await logRun(actor, { agent: "sheet", subject, r, used: "ai", summary: `${roles.length} roles, ${resp.length} responsibilities, ${auth.length} authorities, ${comps.length} competencies, ${kpis.length} KPIs`, output: sheet });
  return { sheet, model: `${r.provider}/${r.model}` };
}

// ------------------------------------------------------------------ 3. training programmes for needs that have none
export interface ProgramDraft { title: string; category: string; duration_hours: number; eval_method: string; eff_days: number | null; pass_mark: number; content: string; for_topics: string[] }
const CATS = ["induction", "safety", "quality", "technical", "awareness", "core_tools", "behavioural", "ojt"], METHODS = ["test", "observation", "kpi", "signoff"];
export async function proposePrograms(actor: Actor, topics: { topic: string; reason: string | null; count: number }[], existing: string[]): Promise<{ programs: ProgramDraft[]; model: string | null; error?: string }> {
  const subject = `${topics.length} training need topic${topics.length === 1 ? "" : "s"} without a programme`;
  const prompt = `These training needs in a manufacturing plant have no training programme yet:
${topics.map((t) => `- "${t.topic}" (${t.count} people)${t.reason ? ` — why: ${t.reason}` : ""}`).join("\n")}
Programmes that already exist (do not repeat them): ${existing.join("; ") || "(none)"}.
Propose one practical in-house training programme per topic (merge topics that are really the same training).
category: one of ${CATS.join(", ")}; eval_method: one of ${METHODS.join(", ")} (test = pre/post test, observation = supervisor watches on the job, kpi = a KPI should improve, signoff = awareness only);
eff_days: 30, 60 or 90 (null for signoff); pass_mark 50–80; content: 3 to 6 short lines of what is taught, separated by "; ".
Answer as JSON: {"programs": [{"title": "...", "category": "...", "duration_hours": 2, "eval_method": "...", "eff_days": 30, "pass_mark": 70, "content": "...", "for_topics": ["exact topic text from the list"]}]}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 2000 });
  const j = r.ok ? extractJson<{ programs?: Record<string, unknown>[] }>(r.text!) : null;
  const programs = (j?.programs ?? []).map((p) => ({
    title: str(p.title, 160), category: CATS.includes(String(p.category)) ? String(p.category) : "technical", duration_hours: Math.min(40, Math.max(0.5, Number(p.duration_hours) || 2)),
    eval_method: METHODS.includes(String(p.eval_method)) ? String(p.eval_method) : "observation", eff_days: [30, 60, 90].includes(Number(p.eff_days)) ? Number(p.eff_days) : null,
    pass_mark: int(p.pass_mark, 40, 90, 60), content: str(p.content, 1500), for_topics: strArr(p.for_topics, 10, 200),
  })).filter((p) => p.title.length >= 3 && !existing.some((e) => e.toLowerCase() === p.title.toLowerCase())).slice(0, 15);
  if (!programs.length) {
    await logRun(actor, { agent: "programmes", subject, r, used: "none", error: r.ok ? "The AI proposed nothing usable." : undefined });
    return { programs: [], model: null, error: r.ok ? "The AI proposed nothing usable — try again, or add the programmes yourself." : r.error };
  }
  await logRun(actor, { agent: "programmes", subject, r, used: "ai", summary: programs.map((p) => p.title).join("; "), output: programs });
  return { programs, model: `${r.provider}/${r.model}` };
}

// ------------------------------------------------------------------ 4. pre / post test questions
export interface QuizItem { q: string; options: string[]; answer: number }
export async function writeQuiz(actor: Actor, program: { title: string; content: string | null; category: string }, count = 10): Promise<{ quiz: QuizItem[]; model: string | null; error?: string }> {
  const prompt = `Write ${count} multiple-choice questions for the pre-test and post-test of the training "${program.title}" (${program.category}) for shop-floor and staff employees in an Indian manufacturing plant.
What is taught: ${program.content || "(the usual content of this training)"}.
Questions test understanding and safe, correct practice — not trivia. Exactly 4 short options each, one correct.
Answer as JSON: {"questions": [{"q": "...", "options": ["...", "...", "...", "..."], "answer": 0}]} where answer is the index (0–3) of the correct option.`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 2500 });
  const j = r.ok ? extractJson<{ questions?: { q?: unknown; options?: unknown; answer?: unknown }[] }>(r.text!) : null;
  const quiz = (j?.questions ?? []).map((x) => ({ q: str(x.q, 300), options: strArr(x.options, 4, 160), answer: int(x.answer, 0, 3, -1) }))
    .filter((x) => x.q.length >= 8 && x.options.length === 4 && x.answer >= 0).slice(0, 20);
  if (quiz.length < Math.min(5, count)) {
    await logRun(actor, { agent: "quiz", subject: program.title, r, used: "none", error: r.ok ? "The AI's questions were incomplete." : undefined });
    return { quiz: [], model: null, error: r.ok ? "The AI's questions were incomplete — try again." : r.error };
  }
  await logRun(actor, { agent: "quiz", subject: program.title, r, used: "ai", summary: `${quiz.length} questions`, output: quiz });
  return { quiz, model: `${r.provider}/${r.model}` };
}

// ------------------------------------------------------------------ 5. what to work on first (the agent's findings are rule-based)
export interface Finding { key: string; clause: string; severity: 1 | 2 | 3; text: string; href: string; count: number }
export async function rankFindings(actor: Actor, findings: Finding[]): Promise<{ order: { key: string; why: string }[]; model: string | null }> {
  const bySeverity = [...findings].sort((a, b) => b.severity - a.severity || b.count - a.count).map((f) => ({ key: f.key, why: "" }));
  if (findings.length < 2) return { order: bySeverity, model: null };
  const prompt = `An IATF 16949 / ISO 9001 audit of competence, training and awareness (clauses 5.3, 7.2, 7.3) may come at any time.
These findings were worked out from the HR records by fixed rules (severity 3 = an auditor would raise a nonconformity):
${findings.map((f) => `- ${f.key} [${f.clause}, severity ${f.severity}, ${f.count}]: ${f.text}`).join("\n")}
Rank them in the order HR should work on them, with one short reason each (risk to the customer / audit, effort, what unblocks what).
Answer as JSON: {"order": [{"key": "finding key from the list", "why": "one short sentence"}]}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 1200, budgetMs: 30000 });
  const j = r.ok ? extractJson<{ order?: { key?: unknown; why?: unknown }[] }>(r.text!) : null;
  const keys = new Set(findings.map((f) => f.key));
  const order = (j?.order ?? []).map((o) => ({ key: String(o.key ?? ""), why: str(o.why, 240) })).filter((o) => keys.has(o.key))
    .filter((o, i, a) => a.findIndex((y) => y.key === o.key) === i);
  if (order.length < Math.min(3, findings.length)) {
    await logRun(actor, { agent: "qms_agent", subject: `${findings.length} findings`, r, used: "rules", summary: "Ranked by severity (the AI did not answer usefully)." });
    return { order: bySeverity, model: null };
  }
  for (const f of bySeverity) if (!order.some((o) => o.key === f.key)) order.push(f);       // nothing found is dropped
  await logRun(actor, { agent: "qms_agent", subject: `${findings.length} findings`, r, used: "ai", summary: order.slice(0, 5).map((o) => o.key).join(" › "), output: order });
  return { order, model: `${r.provider}/${r.model}` };
}

export { aiConfigured };
