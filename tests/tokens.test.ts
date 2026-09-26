import { describe, it, expect } from "vitest";
import { randomToken, hashToken, signPayload, verifyPayload, tempPassword } from "@/lib/tokens";
import { slugFromHost } from "@/lib/tenant-host";

describe("tokens", () => {
  it("random tokens are long and unique", () => {
    const a = randomToken(), b = randomToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toHaveLength(64);
  });
  it("signed payloads verify, and reject tampering or wrong secret", () => {
    const s = "x".repeat(40);
    const v = signPayload({ c: "abc" }, s, 60);
    expect(verifyPayload<{ c: string }>(v, s)?.c).toBe("abc");
    expect(verifyPayload(v, "y".repeat(40))).toBeNull();
    expect(verifyPayload(v.replace(/^./, "Z"), s)).toBeNull();
    expect(verifyPayload(signPayload({ c: 1 }, s, -1), s)).toBeNull();
  });
  it("temporary passwords have letters, digits and a symbol", () => {
    expect(tempPassword()).toMatch(/^[A-Za-z]{4}-\d{4}!$/);
  });
});

describe("tenant from host", () => {
  it("reads the subdomain of the platform domain", () => {
    expect(slugFromHost("deno.hrmsuite.in", "hrmsuite.in")).toBe("deno");
    expect(slugFromHost("DENO.hrmsuite.in:443", "hrmsuite.in")).toBe("deno");
    expect(slugFromHost("hrmsuite.in", "hrmsuite.in")).toBeNull();
    expect(slugFromHost("www.hrmsuite.in", "hrmsuite.in")).toBeNull();
    expect(slugFromHost("a.b.hrmsuite.in", "hrmsuite.in")).toBeNull();
    expect(slugFromHost("hr.customer.com", "hrmsuite.in")).toBeNull();
  });
});
