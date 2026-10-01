import { describe, it, expect } from "vitest";
import { fill, toPlainText, toEmailHtml, isSampleRecipient } from "@/lib/notify/render";
import { DEFAULT_TEMPLATES } from "@/lib/notify/templates";

describe("sample people", () => {
  it("are never messaged; real addresses are", () => {
    expect(isSampleRecipient("manikandan.p@demo.kmr.test")).toBe(true);
    expect(isSampleRecipient("Admin@KMR-DEMO.test ")).toBe(true);
    expect(isSampleRecipient("hr@kmr-groups.com")).toBe(false);
    expect(isSampleRecipient("someone@demo.kmr.test.example.com")).toBe(false);
    expect(isSampleRecipient(null)).toBe(false);
  });
});

describe("message rendering", () => {
  it("fills placeholders and blanks unknown ones", () => {
    expect(fill("Hi {{name}}, {{missing}}!", { name: "Priya" })).toBe("Hi Priya, !");
  });
  it("turns buttons into 'Label: url' for WhatsApp", () => {
    expect(toPlainText("[[Start|{{link}}]]", { link: "https://x.in/a" })).toBe("Start: https://x.in/a");
  });
  it("renders a branded, escaped email with a button", () => {
    const html = toEmailHtml("Dear {{name}},\n\n[[Open|{{link}}]]", { name: "<script>", link: "https://x.in/a" }, { company: "DENO", primaryColor: "#1F3A5F", logoUrl: null });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="https://x.in/a"');
    expect(html).toContain("#1F3A5F");
  });
  it("drops non-http button links", () => {
    expect(toEmailHtml("[[Bad|javascript:alert(1)]]", {}, { company: "X", primaryColor: "#000000", logoUrl: null })).not.toContain("javascript:");
  });
  it("every WhatsApp template parameter is used in its message", () => {
    for (const [event, t] of Object.entries(DEFAULT_TEMPLATES)) {
      for (const p of t.wa_params) expect(t.whatsapp + t.email, `${event}.${p}`).toContain(`{{${p}}}`);
    }
  });
});
