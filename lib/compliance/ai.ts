import "server-only";
// The free AI drafts the text of a policy or procedure from HR's title and points. It becomes a draft revision marked
// "AI draft"; HR edits it and a named person approves it. It is told not to invent laws, section numbers or figures.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askAi, extractJson } from "@/lib/ai/gateway";
import { aiOn, logRun, type Actor } from "@/lib/qms/ai";
import { DOC_KINDS } from "./rules";

const SYSTEM = "You are an experienced HR and quality-systems manager (ISO 9001, IATF 16949) in an Indian manufacturing company. " +
  "Write clear, short, plain English that shop-floor people understand. Do NOT invent laws, section numbers, amounts, dates, names or committee members — " +
  "where such a detail is needed, write [to be filled] instead. Answer with one JSON object only.";

export async function draftDocument(db: SupabaseClient, actor: Actor, inp: { title: string; kind: string; points: string; company: string }): Promise<{ body: string; model: string } | { error: string }> {
  if (!(await aiOn(db, actor.tenantId))) return { error: "The free AI is not set up or is switched off (QMS › AI & review)." };
  const kind = DOC_KINDS[inp.kind] ?? "Document";
  const prompt = `Write the ${kind.toLowerCase()} "${inp.title}" for ${inp.company}, a manufacturing company in India.
${inp.points ? `HR's points (use them all, add nothing that contradicts them):\n${inp.points.slice(0, 3000)}` : "HR gave no points: write the usual content for this kind of document, with [to be filled] where company details are needed."}
Structure it with numbered headings: 1. Purpose, 2. Scope, 3. ${inp.kind === "procedure" || inp.kind === "work_instruction" ? "Responsibilities, 4. Procedure (numbered steps), 5. Records" : "Policy, 4. Responsibilities, 5. If the policy is not followed"}.
Short lines; "- " for bullets; at most about 600 words.
Answer as JSON: {"body": "the full text with line breaks"}`;
  const r = await askAi({ system: SYSTEM, prompt, json: true, maxTokens: 2200, budgetMs: 40000 });
  const j = r.ok ? extractJson<{ body?: unknown }>(r.text!) : null;
  const body = typeof j?.body === "string" ? j.body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000) : "";
  if (body.length < 200 || !/purpose/i.test(body)) {
    await logRun(actor, { agent: "document", subject: inp.title, r, used: "none", error: r.ok ? "The AI's text was incomplete." : undefined });
    return { error: r.ok ? "The AI's text was incomplete — try again, or write it yourself." : `No free AI answered: ${r.error ?? "unknown"}` };
  }
  await logRun(actor, { agent: "document", subject: inp.title, r, used: "ai", summary: `${body.length} characters`, output: { body: body.slice(0, 3000) } });
  return { body, model: `${r.provider}/${r.model}` };
}
