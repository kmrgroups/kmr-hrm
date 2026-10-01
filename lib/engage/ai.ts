import "server-only";
// The free AI in engagement — two drafts, both reviewed by a person:
//   • an announcement's wording from HR's points (HR edits it before publishing)
//   • a summary of a survey's written comments (themes + suggested actions), shown next to the comments themselves so
//     HR can check it; HR marks it checked. Comments go to the AI without names (surveys store none when anonymous),
//     and phone numbers / e-mail addresses are taken out first.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askAi, extractJson } from "@/lib/ai/gateway";
import { aiOn, logRun, type Actor } from "@/lib/qms/ai";

const SYSTEM = "You are an experienced HR manager in an Indian manufacturing plant. Write plain, short, warm and respectful English that shop-floor people understand. " +
  "Never invent facts, dates, names or numbers that are not given. Answer with one JSON object only — no text around it.";
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const scrub = (s: string) => s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, "[phone]");

export async function draftAnnouncement(db: SupabaseClient, actor: Actor, inp: { points: string; category: string; audience: string; needsAck: boolean }): Promise<{ title: string; body: string; model: string } | { error: string }> {
  if (!(await aiOn(db, actor.tenantId))) return { error: "The free AI is not set up or is switched off (QMS › AI & review)." };
  const prompt = `Write a notice-board announcement for the employees (${inp.audience}) of a manufacturing plant. Category: ${inp.category}.
${inp.needsAck ? "Each person must acknowledge reading it, so end with one line asking them to acknowledge in their portal." : ""}
Use ONLY these points from HR (do not add facts):
${scrub(inp.points).slice(0, 3000)}
Keep it short: a clear title (max 12 words) and 3 to 8 short sentences or bullet lines ("- ").
Answer as JSON: {"title": "...", "body": "..."}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 900, budgetMs: 35000 });
  const j = r.ok ? extractJson<{ title?: unknown; body?: unknown }>(r.text!) : null;
  const title = str(j?.title, 160), body = typeof j?.body === "string" ? j.body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000) : "";
  if (title.length < 3 || body.length < 20) {
    await logRun(actor, { agent: "announcement", subject: inp.points.slice(0, 120), r, used: "none", error: r.ok ? "The AI's answer was incomplete." : undefined });
    return { error: r.ok ? "The AI's answer was incomplete — try again, or write it yourself." : `No free AI answered: ${r.error ?? "unknown"}` };
  }
  await logRun(actor, { agent: "announcement", subject: title, r, used: "ai", summary: `${body.length} characters`, output: { title, body } });
  return { title, body, model: `${r.provider}/${r.model}` };
}

export interface CommentSummary { themes: { theme: string; count: number; points: string[] }[]; actions: string[]; positives: string[] }

export async function summariseComments(db: SupabaseClient, actor: Actor, survey: { title: string }, groups: { question: string; comments: string[] }[]): Promise<{ summary: CommentSummary; model: string } | { error: string }> {
  if (!(await aiOn(db, actor.tenantId))) return { error: "The free AI is not set up or is switched off (QMS › AI & review)." };
  const total = groups.reduce((s, g) => s + g.comments.length, 0);
  if (total < 3) return { error: "Fewer than 3 written comments — nothing to summarise." };
  const body = groups.filter((g) => g.comments.length).map((g) => `Question: ${g.question}\n${g.comments.slice(0, 150).map((c) => `- ${scrub(c).slice(0, 400)}`).join("\n")}`).join("\n\n");
  const prompt = `These are the written answers (anonymous) to the employee survey "${survey.title}" in a manufacturing plant (${total} comments).
${body.slice(0, 14000)}

Group them into the main themes (most mentioned first). For each theme: a short name, how many comments mention it, and 1–3 short points in your own words (no quotes that could identify a person).
Then list 3–6 practical actions HR and management could take, and 2–4 things people like.
Answer as JSON: {"themes": [{"theme": "...", "count": 3, "points": ["..."]}], "actions": ["..."], "positives": ["..."]}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 1500, budgetMs: 40000 });
  const j = r.ok ? extractJson<Record<string, unknown>>(r.text!) : null;
  const themes = (Array.isArray(j?.themes) ? j!.themes as Record<string, unknown>[] : []).map((t) => ({
    theme: str(t?.theme, 80), count: Math.max(1, Math.min(total, Math.round(Number(t?.count) || 1))),
    points: (Array.isArray(t?.points) ? t.points as unknown[] : []).map((p) => str(p, 200)).filter((p) => p.length > 3).slice(0, 3),
  })).filter((t) => t.theme.length >= 3).slice(0, 10);
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((x) => str(x, 240)).filter((x) => x.length > 3).slice(0, n);
  const summary: CommentSummary = { themes, actions: list(j?.actions, 6), positives: list(j?.positives, 4) };
  if (themes.length < 1 || !summary.actions.length) {
    await logRun(actor, { agent: "survey", subject: survey.title, r, used: "none", error: r.ok ? "The AI's summary was incomplete." : undefined });
    return { error: r.ok ? "The AI's summary was incomplete — try again." : `No free AI answered: ${r.error ?? "unknown"}` };
  }
  await logRun(actor, { agent: "survey", subject: survey.title, r, used: "ai", summary: `${themes.length} themes, ${summary.actions.length} actions from ${total} comments`, output: summary });
  return { summary, model: `${r.provider}/${r.model}` };
}
