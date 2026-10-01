import "server-only";
// Free AI gateway (server side only; keys never reach the browser). Same approach as the KMR IDMS gateway
// (kmrgroups/ironvale-website › ai.js), limited to providers with a free tier:
//   OPENROUTER_API_KEY — free, no card; only models priced at 0 are used
//   GROQ_API_KEY       — free, no card, fast
//   GEMINI_API_KEY     — Google AI Studio free tier
// Whichever keys are set are tried in that order; a dead, slow or rate-limited free model is common, so each provider
// tries up to two models with a timeout, and the whole call has a time budget. When nothing answers, the caller falls
// back to the HRM's own rule-based writer — AI is a help, never a dependency.

export interface AiArgs { system?: string; prompt: string; maxTokens?: number; json?: boolean; budgetMs?: number }
export interface AiResult { ok: boolean; text?: string; provider?: string; model?: string; error?: string; attempts?: string[]; ms?: number }

const clean = (v: string | undefined) => String(v ?? "").replace(/[\r\n\t]/g, "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/^Bearer\s+/i, "").trim();
const key = (name: string) => clean(process.env[name]);
const PER_CALL_MS = 20000;
const cache: Record<string, { at: number; ids: string[] }> = {};

/** the providers with a key set, in the order they are tried */
export function aiProviders(): string[] {
  return [["openrouter", "OPENROUTER_API_KEY"], ["groq", "GROQ_API_KEY"], ["gemini", "GEMINI_API_KEY"]].filter(([, k]) => key(k!)).map(([p]) => p!);
}
export const aiConfigured = () => aiProviders().length > 0;

async function fetchT(url: string, opts: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}
const base = (name: string, def: string) => (process.env[name] || def).replace(/\/+$/, "");

async function openrouterModels(): Promise<string[]> {
  if (process.env.OPENROUTER_MODEL) return [process.env.OPENROUTER_MODEL];
  const c = cache.openrouter; if (c && Date.now() - c.at < 6 * 3600e3) return c.ids;
  try {
    const r = await fetchT(`${base("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")}/models`, {}, 8000);
    const j = (await r.json()) as { data?: { id: string; pricing?: { prompt?: string | number; completion?: string | number }; context_length?: number }[] };
    const free = (j.data ?? []).filter((m) => String(m.pricing?.prompt) === "0" && String(m.pricing?.completion) === "0" && (m.context_length ?? 0) >= 16000);
    const score = (id: string) => (/llama-3\.3-70b|llama-4|qwen3|qwen-2\.5-72b|deepseek|gemma-3-27b|mistral-small/i.test(id) ? 20 : 0) + (/70b|72b|120b|235b|405b/i.test(id) ? 10 : 0) - (/\b[1-9]b\b|vision|vl\b/i.test(id) ? 10 : 0);
    const ids = free.map((m) => m.id).sort((a, b) => score(b) - score(a));
    if (ids.length) { cache.openrouter = { at: Date.now(), ids }; return ids; }
  } catch { /* fall through to the known free models */ }
  return ["meta-llama/llama-3.3-70b-instruct:free", "deepseek/deepseek-chat-v3-0324:free", "qwen/qwen-2.5-72b-instruct:free"];
}

async function groqModels(k: string): Promise<string[]> {
  if (process.env.GROQ_MODEL) return [process.env.GROQ_MODEL];
  const c = cache.groq; if (c && Date.now() - c.at < 6 * 3600e3) return c.ids;
  try {
    const r = await fetchT(`${base("GROQ_BASE_URL", "https://api.groq.com/openai/v1")}/models`, { headers: { Authorization: `Bearer ${k}` } }, 8000);
    const j = (await r.json()) as { data?: { id: string }[] };
    const ids = (j.data ?? []).map((m) => m.id).filter((id) => !/whisper|tts|guard|embed|playai|orpheus/i.test(id));
    const score = (id: string) => (/llama-3\.3-70b|llama-4-maverick|qwen3|gpt-oss-120b|kimi/i.test(id) ? 20 : 0) + (/70b|120b|maverick/i.test(id) ? 10 : 0) - (/8b|instant|1b|3b/i.test(id) ? 10 : 0);
    ids.sort((a, b) => score(b) - score(a));
    if (ids.length) { cache.groq = { at: Date.now(), ids }; return ids; }
  } catch { /* known models */ }
  return ["llama-3.3-70b-versatile", "meta-llama/llama-4-maverick-17b-128e-instruct"];
}

async function openaiCompatible(provider: string, url: string, k: string, models: string[], a: AiArgs, deadline: number, extra: Record<string, string> = {}): Promise<AiResult> {
  const attempts: string[] = [];
  for (const model of models.slice(0, 2)) {
    const left = deadline - Date.now(); if (left < 3000) break;
    try {
      const messages = [...(a.system ? [{ role: "system", content: a.system }] : []), { role: "user", content: a.prompt }];
      const body: Record<string, unknown> = { model, messages, max_tokens: a.maxTokens ?? 2500, temperature: 0.2 };
      if (a.json && provider === "groq") body.response_format = { type: "json_object" };
      const r = await fetchT(`${url}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) }, Math.min(PER_CALL_MS, left));
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } | string; choices?: { message?: { content?: string } }[] };
      if (!r.ok) { attempts.push(`${model}: ${typeof j.error === "string" ? j.error : j.error?.message ?? r.status}`); continue; }
      const text = j.choices?.[0]?.message?.content?.trim();
      if (text) return { ok: true, text, provider, model, attempts };
      attempts.push(`${model}: empty answer`);
    } catch (e) { attempts.push(`${model}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`); }
  }
  return { ok: false, error: attempts.at(-1) ?? "no model answered", attempts };
}

async function gemini(k: string, a: AiArgs, deadline: number): Promise<AiResult> {
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
  const attempts: string[] = [];
  for (const model of models.slice(0, 2)) {
    const left = deadline - Date.now(); if (left < 3000) break;
    try {
      const body: Record<string, unknown> = { contents: [{ role: "user", parts: [{ text: a.prompt }] }],
        generationConfig: { maxOutputTokens: a.maxTokens ?? 2500, temperature: 0.2, ...(a.json ? { responseMimeType: "application/json" } : {}) } };
      if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };
      const r = await fetchT(`${base("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")}/models/${model}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": k }, body: JSON.stringify(body) }, Math.min(PER_CALL_MS, left));
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
      if (!r.ok) { attempts.push(`${model}: ${j.error?.message ?? r.status}`); continue; }
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n").trim();
      if (text) return { ok: true, text, provider: "gemini", model, attempts };
      attempts.push(`${model}: empty answer`);
    } catch (e) { attempts.push(`${model}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`); }
  }
  return { ok: false, error: attempts.at(-1) ?? "no model answered", attempts };
}

/** asks the free providers in turn until one answers (or the time budget runs out) */
export async function askAi(a: AiArgs): Promise<AiResult> {
  const started = Date.now(), deadline = started + (a.budgetMs ?? 40000);
  const all: string[] = [];
  for (const p of aiProviders()) {
    if (deadline - Date.now() < 3000) break;
    let r: AiResult;
    if (p === "openrouter") r = await openaiCompatible("openrouter", base("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), key("OPENROUTER_API_KEY"), await openrouterModels(), a, deadline,
      { "HTTP-Referer": process.env.APP_PUBLIC_URL || "https://www.kmr-groups.com", "X-Title": "KMR HRM Suite" });
    else if (p === "groq") { const k = key("GROQ_API_KEY"); r = await openaiCompatible("groq", base("GROQ_BASE_URL", "https://api.groq.com/openai/v1"), k, await groqModels(k), a, deadline); }
    else r = await gemini(key("GEMINI_API_KEY"), a, deadline);
    if (r.ok) return { ...r, attempts: [...all, ...(r.attempts ?? [])], ms: Date.now() - started };
    all.push(...(r.attempts ?? []).map((x) => `${p} › ${x}`));
  }
  return { ok: false, error: all.length ? "The free AI services did not answer in time." : "No free AI service is set up.", attempts: all, ms: Date.now() - started };
}

/** the JSON object in a model's answer (models wrap it in ``` fences or add a sentence around it) */
export function extractJson<T = unknown>(text: string): T | null {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const a = t.indexOf(open), b = t.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) as T; } catch { /* try the other shape */ } }
  }
  return null;
}
