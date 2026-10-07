import { describe, it, expect } from "vitest";
import { computeLine } from "@/lib/payroll/compute";
import { ecrText, bankCsv } from "@/lib/payroll/exports";

describe("payroll exports (audit fixes)", () => {
  const info = { code: "E1", name: "A B", department: "", designation: "", bank: "SBI", account: "123456789012", ifsc: "SBIN0000001", holder: "A B", email: "", uan: "100", eps_wage: 15000 };
  const line = { info, gross: 20000, pf_wage: 15000, esi_wage: 0, lop_days: 0, net_pay: 17000, deductions: [{ code: "PF", amount: 1800 }, { code: "VPF", amount: 500 }], employer: [{ code: "EPS", amount: 1250 }, { code: "EPF_ER", amount: 550 }] } as never;
  it("ECR employee EPF share includes VPF; the EPF-EPS difference stays on the 12%", () => {
    const cols = ecrText([line]).trim().split("#~#");
    expect(cols[6]).toBe("2300");      // 1800 + 500
    expect(cols[8]).toBe("550");       // 1800 - 1250
  });
  it("bank CSV has the plain account number (no apostrophe)", () => {
    expect(bankCsv([line], "2026-09")).toContain("123456789012");
    expect(bankCsv([line], "2026-09")).not.toContain("'123456789012");
  });
});
