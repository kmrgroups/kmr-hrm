import { describe, it, expect } from "vitest";
import {
  isValidAadhaar, isValidPan, isValidIfsc, isValidAccountNumber, isValidUan, normalizeIndianMobile,
  toWhatsAppNumber, maskAadhaar, verhoeffValid, isValidEmail,
} from "@/lib/validators";

describe("Indian ID validation", () => {
  it("accepts a checksum-valid Aadhaar and rejects a single-digit change", () => {
    expect(isValidAadhaar("2345 6789 0124")).toBe(true);
    expect(isValidAadhaar("234567890125")).toBe(false);
    expect(isValidAadhaar("123456789012")).toBe(false); // cannot start with 0/1
    expect(isValidAadhaar("23456789012")).toBe(false); // 11 digits
  });
  it("Verhoeff catches transpositions", () => {
    expect(verhoeffValid("234567890124")).toBe(true);
    expect(verhoeffValid("243567890124")).toBe(false);
  });
  it("masks Aadhaar to last 4", () => expect(maskAadhaar("2345 6789 0124")).toBe("XXXX XXXX 0124"));
  it("validates PAN format including holder type", () => {
    expect(isValidPan("ABCPR1234K")).toBe(true);
    expect(isValidPan("abcpr1234k")).toBe(true);
    expect(isValidPan("ABCXR1234K")).toBe(false); // X is not a holder type
    expect(isValidPan("ABCP1234K")).toBe(false);
  });
  it("validates IFSC", () => {
    expect(isValidIfsc("SBIN0001234")).toBe(true);
    expect(isValidIfsc("SBIN1001234")).toBe(false); // 5th char must be 0
  });
  it("validates bank account and UAN", () => {
    expect(isValidAccountNumber("123456789012")).toBe(true);
    expect(isValidAccountNumber("12345678")).toBe(false);
    expect(isValidAccountNumber("1234-5678-90")).toBe(false);
    expect(isValidUan("100123456789")).toBe(true);
  });
  it("normalises Indian mobiles for WhatsApp", () => {
    expect(normalizeIndianMobile("+91 98450 12345")).toBe("9845012345");
    expect(normalizeIndianMobile("09845012345")).toBe("9845012345");
    expect(normalizeIndianMobile("5845012345")).toBeNull();
    expect(toWhatsAppNumber("98450 12345")).toBe("919845012345");
    expect(toWhatsAppNumber(null)).toBeNull();
  });
  it("validates email", () => {
    expect(isValidEmail("hr@deno.in")).toBe(true);
    expect(isValidEmail("hr@deno")).toBe(false);
  });
});
