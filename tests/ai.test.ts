import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractJson, aiProviders, askAi } from "@/lib/ai/gateway";

describe("free AI gateway", () => {
  const saved = { ...process.env };
  beforeEach(() => { delete process.env.OPENROUTER_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY; });
  afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

  it("reads the JSON out of a chatty answer", () => {
    expect(extractJson('Sure! ```json\n{"a": 1, "b": [2]}\n``` hope this helps')).toEqual({ a: 1, b: [2] });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
    expect(extractJson("no json here")).toBeNull();
  });

  it("uses only the providers whose key is set, in order", () => {
    expect(aiProviders()).toEqual([]);
    process.env.GEMINI_API_KEY = "g"; process.env.OPENROUTER_API_KEY = ' "Bearer x"\n';
    expect(aiProviders()).toEqual(["openrouter", "gemini"]);
  });

  it("says plainly when nothing is set up (no network call)", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const r = await askAi({ prompt: "hi" });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/No free AI service is set up/); expect(f).not.toHaveBeenCalled();
  });

  it("moves on to the next provider when one fails", async () => {
    process.env.GROQ_API_KEY = "k"; process.env.GROQ_MODEL = "m1"; process.env.GEMINI_API_KEY = "g"; process.env.GEMINI_MODEL = "gm";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("groq")) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
    });
    const r = await askAi({ prompt: "hi", json: true });
    expect(r.ok).toBe(true); expect(r.provider).toBe("gemini"); expect(r.model).toBe("gm");
    expect(r.attempts?.join(" ")).toMatch(/groq › m1: rate limited/);
  });

  it("only picks OpenRouter models priced at zero", async () => {
    process.env.OPENROUTER_API_KEY = "k"; delete process.env.OPENROUTER_MODEL;
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [
        { id: "paid/llama-3.3-70b", pricing: { prompt: "0.0001", completion: "0.0002" }, context_length: 128000 },
        { id: "free/llama-3.3-70b-instruct:free", pricing: { prompt: "0", completion: "0" }, context_length: 128000 }] }));
      asked.push(JSON.parse(String(init?.body)).model);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    });
    const r = await askAi({ prompt: "hi" });
    expect(r.ok).toBe(true); expect(asked).toEqual(["free/llama-3.3-70b-instruct:free"]);
  });
});
