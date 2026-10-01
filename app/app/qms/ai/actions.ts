"use server";
// The free AI in the QMS: every action here either asks the AI for a draft (which waits for a person) or is that
// person's decision on a draft. Nothing the AI writes is used before a named person accepts or approves it.
import { revalidatePath } from "next/cache";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { istToday } from "@/lib/attendance/time";
import { isSampleRecipient } from "@/lib/notify/render";
import { askAi, aiConfigured, extractJson } from "@/lib/ai/gateway";
import { aiOn, logRun, proposePrograms, writeQuiz, rankFindings, type Actor } from "@/lib/qms/ai";
import { loadHealth } from "@/lib/qms/health";
import type { ActionState } from "@/app/app/employees/actions";
import type { Session } from "@/lib/auth";

const HR = HR_ROLES;
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const done = async (ok: string): Promise<ActionState> => { await setFlash({ ok }); return { ok, flashed: true }; };
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const uuid = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return isId(v) ? v : null; };
const actorOf = (s: Session): Actor => ({ tenantId: s.tenant.id, userId: s.user.id, userName: s.user.full_name });
const NOT_SET = "The free AI is not set up yet. Add a free key (OpenRouter, Groq or Gemini) to the HRM's environment variables — see AI › How to set it up.";

function refresh() { for (const p of ["/app/qms/ai", "/app/qms", "/app/qms/needs", "/app/qms/training"]) revalidatePath(p); }

// ------------------------------------------------------------------ settings and connection check
export async function setAiEnabled(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(["hr_manager"]);
    const on = f.get("on") === "1";
    const db = await createClient();
    const { error } = await db.from("qms_settings").upsert({ tenant_id: s.tenant.id, ai_enabled: on }, { onConflict: "tenant_id" });
    if (error) return { error: error.message };
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: on ? "ai.enabled" : "ai.disabled", entity: "qms_settings", entityId: s.tenant.id });
    refresh();
    return done(on ? "AI drafting is on. Everything it writes still waits for your review." : "AI drafting is off. The HRM's own rule-based writer is used.");
  } catch (e) { return fail(e); }
}

export async function checkAi(_: ActionState, f: FormData): Promise<ActionState> {
  void f;
  try {
    const s = await assertRole(HR);
    if (!aiConfigured()) return { error: NOT_SET };
    const r = await askAi({ prompt: 'Reply with this JSON only: {"ok": true, "say": "ready"}', json: true, maxTokens: 50, budgetMs: 30000 });
    const j = r.ok ? extractJson<{ ok?: boolean }>(r.text!) : null;
    await logRun(actorOf(s), { agent: "check", subject: "Connection check", r, used: j?.ok ? "ai" : "none", summary: j?.ok ? "Answered" : undefined, error: r.ok && !j?.ok ? "Answered, but not in the expected form." : undefined });
    refresh();
    if (!r.ok) return { error: `No free AI answered: ${r.error ?? "unknown"}${r.attempts?.length ? ` (${r.attempts.slice(-2).join(" | ")})` : ""}` };
    if (!j?.ok) return { error: `${r.provider} / ${r.model} answered, but not in the form the HRM needs. Drafts will fall back to the rule-based writer until a model answers properly.` };
    return { ok: `Connected — ${r.provider} / ${r.model} answered in ${((r.ms ?? 0) / 1000).toFixed(1)} s.` };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ QMS agent: rule-based findings, AI-ranked
export async function runQmsAgent(_: ActionState, f: FormData): Promise<ActionState> {
  void f;
  try {
    const s = await assertRole(HR);
    const db = await createClient();
    const h = await loadHealth(db, true, istToday());
    const ai = await aiOn(db, s.tenant.id);
    const { order, model } = ai ? await rankFindings(actorOf(s), h.findings)
      : { order: [...h.findings].sort((a, b) => b.severity - a.severity || b.count - a.count).map((x) => ({ key: x.key, why: "" })), model: null };
    if (!ai) await logRun(actorOf(s), { agent: "qms_agent", subject: `${h.findings.length} findings`, r: null, used: "rules", summary: "Ranked by severity (AI off or not set up)." });
    const result = { findings: h.findings, order, model, by: s.user.full_name };
    const { error } = await db.from("qms_settings").upsert({ tenant_id: s.tenant.id, agent_result: result, agent_run_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) return { error: error.message };
    refresh();
    return done(h.findings.length ? `QMS check done: ${h.findings.length} finding${h.findings.length === 1 ? "" : "s"}, ${model ? "put in order by the AI" : "in order of severity"}.` : "QMS check done: nothing an auditor would raise was found.");
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ training programmes for needs that have none
export async function proposeProgramsForNeeds(_: ActionState, f: FormData): Promise<ActionState> {
  void f;
  try {
    const s = await assertRole(HR);
    const db = await createClient();
    if (!(await aiOn(db, s.tenant.id))) return { error: aiConfigured() ? "AI drafting is switched off (QMS › AI)." : NOT_SET };
    const { data: needs } = await db.from("training_needs").select("id,topic,reason,competency_id,employee:employees(email)").eq("status", "open").is("program_id", null).limit(500);
    if (!needs?.length) return { error: "Every open training need already has a programme." };
    const groups = new Map<string, { topic: string; reason: string | null; count: number; sample: boolean; comps: Set<string> }>();
    for (const n of needs) {
      const k = n.topic.trim().toLowerCase();
      const email = (Array.isArray(n.employee) ? n.employee[0] : n.employee as { email: string | null } | null)?.email;
      const g = groups.get(k) ?? { topic: n.topic.trim(), reason: n.reason, count: 0, sample: true, comps: new Set<string>() };
      g.count++; g.sample = g.sample && isSampleRecipient(email); if (n.competency_id) g.comps.add(n.competency_id);
      groups.set(k, g);
    }
    const topics = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 15);
    const { data: ex } = await db.from("training_programs").select("title");
    const r = await proposePrograms(actorOf(s), topics, (ex ?? []).map((x) => x.title));
    if (!r.programs.length) return { error: r.error ?? "The AI proposed nothing." };
    let added = 0;
    for (const p of r.programs) {
      const mine = topics.filter((t) => p.for_topics.some((x) => x.toLowerCase() === t.topic.toLowerCase()));
      const comps = new Set(mine.flatMap((t) => [...t.comps]));
      const { error } = await db.from("training_programs").insert({ tenant_id: s.tenant.id, title: p.title, category: p.category, duration_hours: p.duration_hours, eval_method: p.eval_method,
        eff_days: p.eval_method === "signoff" ? null : p.eff_days, pass_mark: p.pass_mark, content: p.content || null, active: false, ai_proposed: true, ai_model: r.model,
        ai_topics: mine.map((t) => t.topic), competency_id: comps.size === 1 ? [...comps][0] : null, sample: mine.length > 0 && mine.every((t) => t.sample) });
      if (!error) added++;
      else if (!error.message.includes("duplicate")) throw new Error(error.message);
    }
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "ai.programmes_proposed", entity: "training_programs", data: { added, model: r.model } });
    refresh();
    return done(`The AI proposed ${added} programme${added === 1 ? "" : "s"}. They are switched off until you accept them — see QMS › AI.`);
  } catch (e) { return fail(e); }
}

export async function acceptProgram(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Unknown programme." };
    const db = await createClient();
    const { data: p } = await db.from("training_programs").select("id,title,ai_topics,reviewed_at").eq("id", id).single();
    if (!p) return { error: "Programme not found." };
    if (p.reviewed_at) return { error: "Already reviewed." };
    const { error } = await db.from("training_programs").update({ active: true, reviewed_by: s.user.id, reviewed_by_name: s.user.full_name, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: error.message };
    // the open needs it was proposed for are linked to it, ready for "Put open needs into the plan"
    let linked = 0;
    const topics = (p.ai_topics ?? []).map((t: string) => t.toLowerCase());
    if (topics.length) {
      const { data: needs } = await db.from("training_needs").select("id,topic").eq("status", "open").is("program_id", null);
      const ids = (needs ?? []).filter((n) => topics.includes(n.topic.trim().toLowerCase())).map((n) => n.id);
      if (ids.length) { await db.from("training_needs").update({ program_id: id }).in("id", ids); linked = ids.length; }
    }
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "ai.programme_accepted", entity: "training_programs", entityId: id, data: { linked } });
    refresh();
    return done(`${p.title} accepted and switched on${linked ? `; ${linked} open need${linked === 1 ? "" : "s"} linked to it` : ""}. Edit it any time on the Training calendar tab.`);
  } catch (e) { return fail(e); }
}

export async function rejectProgram(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Unknown programme." };
    const db = await createClient();
    const { data: p } = await db.from("training_programs").select("title,ai_proposed,reviewed_at").eq("id", id).single();
    if (!p?.ai_proposed || p.reviewed_at) return { error: "Only an AI proposal waiting for review can be rejected." };
    const { error } = await db.from("training_programs").delete().eq("id", id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: "ai.programme_rejected", entity: "training_programs", entityId: id, data: { title: p.title } });
    refresh();
    return done(`${p.title} rejected and removed.`);
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ pre / post test questions
export async function writeProgramQuiz(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"); if (!id) return { error: "Unknown programme." };
    const db = await createClient();
    if (!(await aiOn(db, s.tenant.id))) return { error: aiConfigured() ? "AI drafting is switched off (QMS › AI)." : NOT_SET };
    const { data: p } = await db.from("training_programs").select("title,content,category").eq("id", id).single();
    if (!p) return { error: "Programme not found." };
    const n = Math.min(15, Math.max(5, Number(f.get("count")) || 10));
    const r = await writeQuiz(actorOf(s), p, n);
    if (!r.quiz.length) return { error: r.error ?? "No questions came back." };
    const { error } = await db.from("training_programs").update({ quiz: r.quiz, quiz_status: "ai_draft", quiz_model: r.model }).eq("id", id);
    if (error) return { error: error.message };
    refresh(); revalidatePath(`/app/qms/ai/quiz/${id}`);
    return done(`${r.quiz.length} test questions drafted for ${p.title}. Check every answer, then accept them.`);
  } catch (e) { return fail(e); }
}

export async function decideQuiz(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertRole(HR);
    const id = uuid(f, "id"), accept = f.get("accept") === "1";
    if (!id) return { error: "Unknown programme." };
    const db = await createClient();
    const { error } = await db.from("training_programs").update(accept ? { quiz_status: "accepted" } : { quiz: [], quiz_status: null, quiz_model: null }).eq("id", id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: s.tenant.id, actorId: s.user.id, action: accept ? "ai.quiz_accepted" : "ai.quiz_discarded", entity: "training_programs", entityId: id });
    refresh(); revalidatePath(`/app/qms/ai/quiz/${id}`);
    return done(accept ? "Test questions accepted — print them from the programme's test page." : "Test questions discarded.");
  } catch (e) { return fail(e); }
}

/** HR corrects a question's right answer (or removes a question) before accepting */
export async function editQuizItem(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    await assertRole(HR);
    const id = uuid(f, "id"), i = Number(f.get("i")), what = String(f.get("what") ?? "");
    if (!id || !Number.isInteger(i)) return { error: "Unknown question." };
    const db = await createClient();
    const { data: p } = await db.from("training_programs").select("quiz").eq("id", id).single();
    const quiz = (p?.quiz ?? []) as { q: string; options: string[]; answer: number }[];
    if (!quiz[i]) return { error: "Unknown question." };
    if (what === "remove") quiz.splice(i, 1);
    else { const a = Number(f.get("answer")); if (!(a >= 0 && a <= 3)) return { error: "Choose the right option." }; quiz[i]!.answer = a; }
    const { error } = await db.from("training_programs").update({ quiz, quiz_status: quiz.length ? "ai_draft" : null }).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath(`/app/qms/ai/quiz/${id}`);
    return { ok: what === "remove" ? "Question removed." : "Answer corrected." };
  } catch (e) { return fail(e); }
}
