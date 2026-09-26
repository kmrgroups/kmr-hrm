import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import { buildIdCardsPdf, CARD_W, CARD_H } from "@/lib/idcard";

describe("ID card PDF", () => {
  it("builds a 2-page CR80 card per employee, with photo and logo", async () => {
    // generate a sample "photo" and "logo" as PNGs
    const photo = await QRCode.toBuffer("photo-placeholder", { width: 300, color: { dark: "#335577", light: "#ddeeff" } });
    const logo = await QRCode.toBuffer("logo", { width: 120 });
    const bytes = await buildIdCardsPdf([
      {
        company: "DENO Manufacturing and Solutions India Pvt Ltd",
        companyAddress: "Plot 42, KIADB Industrial Area, Bommasandra, Bengaluru 560099",
        companyPhone: "080 4000 1234",
        primaryColor: "#1F3A5F", accentColor: "#E07A1F",
        photo, logo: null,
        name: "Priya Ramanathan", employeeCode: "DEN-PL1-0042",
        designation: "Quality Engineer", department: "Quality",
        bloodGroup: "B+", emergencyName: "R. Ramanathan (Father)", emergencyPhone: "+91 98450 12345",
        validUntil: "30 Sep 2029", verifyUrl: "https://deno.hrmsuite.in/v/abc123", signatory: "Head - HR",
      },
      {
        company: "Acme", primaryColor: "#0b6e4f", accentColor: "#f2c14e", logo,
        name: "Very Long Name Of An Employee Who Has Many Initials", employeeCode: "ACM-0001",
        verifyUrl: "https://acme.hrmsuite.in/v/x", emergencyPhone: null, bloodGroup: null,
      },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(Math.round(CARD_W));
    expect(Math.round(height)).toBe(Math.round(CARD_H));
    mkdirSync("/tmp/claude-0/idcard", { recursive: true });
    writeFileSync("/tmp/claude-0/idcard/sample.pdf", bytes);
  });
});
