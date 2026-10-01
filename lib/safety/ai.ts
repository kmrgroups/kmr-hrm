import "server-only";
// The free AI drafts the why-why, the likely root cause and suggested actions of an incident from what was recorded.
// The investigator reads it, corrects it and saves it — and adds only the actions he agrees with.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askAi, extractJson } from "@/lib/ai/gateway";
import { aiOn, logRun, type Actor } from "@/lib/qms/ai";
import { KINDS } from "./rules";

const SYSTEM = "You are an experienced safety engineer (ISO 45001, Indian Factories Act) in a manufacturing plant. Use the hierarchy of controls " +
  "(elimination, substitution, engineering, administrative, PPE) and prefer engineering controls over telling people to be careful. Never name or blame a person. " +
  "Use only the facts given; where something is unknown write 'to be checked'. Answer with one JSON object only.";

export interface WhyDraft { why: string[]; root_cause: string; actions: { action: string; kind: "corrective" | "preventive"; days: number }[] }

export async function draftWhyWhy(db: SupabaseClient, actor: Actor, inc: { ref: string; kind: string; area: string | null; description: string; immediate_action: string | null; injury_nature: string | null }): Promise<{ draft: WhyDraft; model: string } | { error: string }> {
  if (!(await aiOn(db, actor.tenantId))) return { error: "The free AI is not set up or is switched off (QMS › AI & review)." };
  const prompt = `Incident ${inc.ref}: ${KINDS[inc.kind] ?? inc.kind} at ${inc.area ?? "(place not given)"}.
What happened: ${inc.description.slice(0, 2000)}
${inc.injury_nature ? `Injury: ${inc.injury_nature.slice(0, 300)}` : ""}
${inc.immediate_action ? `Immediate action taken: ${inc.immediate_action.slice(0, 1000)}` : ""}
Do a why-why analysis (3 to 5 whys, each "Why …? — because …"), state the most likely root cause (a system cause, not a person), and suggest 2 to 5 actions:
corrective (fix this case) and preventive (stop it anywhere else), each with how many days it should take.
Answer as JSON: {"why": ["...", "..."], "root_cause": "...", "actions": [{"action": "...", "kind": "corrective", "days": 7}]}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 1200, budgetMs: 35000 });
  const j = r.ok ? extractJson<Record<string, unknown>>(r.text!) : null;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const why = (Array.isArray(j?.why) ? j!.why as unknown[] : []).map((x) => s(x, 300)).filter((x) => x.length > 5).slice(0, 5);
  const actions = (Array.isArray(j?.actions) ? j!.actions as Record<string, unknown>[] : []).map((a) => ({ action: s(a?.action, 300), kind: a?.kind === "preventive" ? "preventive" as const : "corrective" as const,
    days: Math.min(180, Math.max(1, Math.round(Number(a?.days) || 14))) })).filter((a) => a.action.length > 5).slice(0, 6);
  const root = s(j?.root_cause, 600);
  if (why.length < 2 || !root || !actions.length) {
    await logRun(actor, { agent: "safety", subject: inc.ref, r, used: "none", error: r.ok ? "The AI's analysis was incomplete." : undefined });
    return { error: r.ok ? "The AI's analysis was incomplete — try again, or write it yourself." : `No free AI answered: ${r.error ?? "unknown"}` };
  }
  const draft = { why, root_cause: root, actions };
  await logRun(actor, { agent: "safety", subject: inc.ref, r, used: "ai", summary: `${why.length} whys, ${actions.length} actions`, output: draft });
  return { draft, model: `${r.provider}/${r.model}` };
}
