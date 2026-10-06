import { describe, it, expect } from "vitest";
import { featureForPath, hasFeature } from "@/lib/features";

describe("feature lock", () => {
  it("maps optional screens to their feature, core screens to none", () => {
    expect(featureForPath("/app/payroll/2026-10")).toBe("hrm.payroll-statutory-reports");
    expect(featureForPath("/app/settings/leave")).toBe("hrm.attendance-shifts-leave");
    expect(featureForPath("/me/payslips")).toBe("hrm.payroll-statutory-reports");
    expect(featureForPath("/app/employees")).toBeNull();
    expect(featureForPath("/app/leaveX")).toBeNull();
  });
  it("opens everything when no list is set, otherwise only the listed features", () => {
    expect(hasFeature(null, "hrm.payroll-statutory-reports")).toBe(true);
    expect(hasFeature(["hrm.attendance-shifts-leave"], "hrm.payroll-statutory-reports")).toBe(false);
    expect(hasFeature(["hrm.attendance-shifts-leave"], "hrm.attendance-shifts-leave")).toBe(true);
    expect(hasFeature([], null)).toBe(true);
  });
});
