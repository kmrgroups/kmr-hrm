import "server-only";
// Offer letter (page 1) + salary breakup annexure (page 2), A4, with pdf-lib — free, made on the server.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { companyLogo } from "@/lib/payroll/payslip";
import { inr, rupeesInWords } from "@/lib/payroll/compute";
import type { Tenant } from "@/lib/types";
import type { Breakup } from "./offer";

const W = 595.28, H = 841.89, M = 50;
const safe = (s: unknown) => String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/₹/g, "Rs.").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
function hex(c: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim()); const n = parseInt(m ? m[1] : "1F3A5F", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const GREY = rgb(0.42, 0.45, 0.5), INK = rgb(0.1, 0.12, 0.16), LINE = rgb(0.86, 0.87, 0.9), BAND = rgb(0.95, 0.96, 0.97);

function wrap(f: PDFFont, s: string, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of String(s ?? "").split(/\r?\n/).map(safe)) {           // split first: newlines are not printable characters
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const fmt = (d: string | null | undefined) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "-";

export interface OfferLetter {
  ref_no: string; date: string; candidate: string; email?: string | null; phone?: string | null;
  role: string; department?: string | null; plant?: string | null; reporting_to?: string | null;
  employment_type: string; date_of_joining: string; valid_until: string; breakup: Breakup; terms?: string | null; signatory?: string | null;
}

export async function buildOfferPdf(tenant: Tenant, o: OfferLetter): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); pdf.setTitle(`Offer letter ${o.ref_no}`); pdf.setAuthor(tenant.legal_name || tenant.name);
  const r = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hex(tenant.primary_color);
  const lg = await companyLogo(tenant).catch(() => null);
  const logo = lg ? (lg.png ? await pdf.embedPng(lg.bytes) : await pdf.embedJpg(lg.bytes)) : null;
  const T = (p: PDFPage, f: PDFFont, s: unknown, x: number, y: number, size = 10, color = INK) => p.drawText(safe(s), { x, y, size, font: f, color });
  const R = (p: PDFPage, f: PDFFont, s: unknown, xr: number, y: number, size = 10, color = INK) => { const t = safe(s); p.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color }); };

  const header = (p: PDFPage) => {
    let y = H - M;
    if (logo) { const s = Math.min(44 / logo.height, 120 / logo.width); p.drawImage(logo, { x: M, y: y - logo.height * s, width: logo.width * s, height: logo.height * s }); }
    const hx = logo ? M + 132 : M;
    T(p, b, tenant.legal_name || tenant.name, hx, y - 14, 14, brand);
    let ay = y - 28; for (const line of wrap(r, tenant.address || "", 8.5, W - hx - M).slice(0, 2)) { T(p, r, line, hx, ay, 8.5, GREY); ay -= 11; }
    p.drawLine({ start: { x: M, y: y - 56 }, end: { x: W - M, y: y - 56 }, thickness: 1.2, color: brand });
    return y - 76;
  };
  const para = (p: PDFPage, s: string, y: number, size = 10, f = r, gap = 14) => { for (const line of wrap(f, s, size, W - 2 * M)) { T(p, f, line, M, y, size, INK); y -= gap; } return y - 6; };
  const bk = o.breakup;

  // ---------- page 1: the letter ----------
  const p1 = pdf.addPage([W, H]); let y = header(p1);
  T(p1, r, `Ref: ${o.ref_no}`, M, y, 9.5, GREY); R(p1, r, `Date: ${fmt(o.date)}`, W - M, y, 9.5, GREY); y -= 26;
  T(p1, b, o.candidate, M, y, 11); y -= 14;
  if (o.email) { T(p1, r, o.email, M, y, 9.5, GREY); y -= 12; }
  if (o.phone) { T(p1, r, o.phone, M, y, 9.5, GREY); y -= 12; }
  y -= 14;
  T(p1, b, `Offer of employment - ${o.role}`, M, y, 13, brand); y -= 24;
  y = para(p1, `Dear ${o.candidate.split(" ")[0]},`, y);
  y = para(p1, `We are pleased to offer you the position of ${o.role}${o.department ? ` in the ${o.department} department` : ""} at ${tenant.legal_name || tenant.name}${o.plant ? `, ${o.plant}` : ""}. We were impressed by your experience and look forward to you joining us.`, y);
  // key terms box
  const rows: [string, string][] = [["Position", o.role], ["Department", o.department || "-"], ["Location", o.plant || "-"], ["Reporting to", o.reporting_to || "-"],
    ["Employment", o.employment_type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())], ["Date of joining", fmt(o.date_of_joining)],
    ["Annual CTC", `Rs. ${inr(bk.ctc_annual)} (${rupeesInWords(bk.ctc_annual)})`], ["Monthly gross", `Rs. ${inr(bk.monthly_gross)}`]];
  const boxTop = y; y -= 8;
  for (const [k, v] of rows) { const lines = wrap(b, v, 9.5, W - 2 * M - 140); T(p1, r, k, M + 12, y - 4, 9.5, GREY); for (const l of lines) { T(p1, b, l, M + 130, y - 4, 9.5); y -= 13; } y -= 3; }
  p1.drawRectangle({ x: M, y: y - 2, width: W - 2 * M, height: boxTop - y + 2, borderColor: LINE, borderWidth: 0.8 });
  y -= 18;
  y = para(p1, "The detailed salary structure is in Annexure A. All statutory contributions and deductions (Provident Fund, ESI, Professional Tax, Income Tax) apply as per law.", y);
  T(p1, b, "Terms of this offer", M, y, 10.5); y -= 16;
  y = para(p1, o.terms || "This offer is subject to verification of your documents and references.", y, 9.5, r, 13);
  y = para(p1, `Please accept this offer by ${fmt(o.valid_until)} using the link sent to you by e-mail and WhatsApp. After you accept, you will receive a link to complete your joining formalities online. If we do not hear from you by then, this offer will lapse.`, y);
  y -= 6; y = para(p1, "We look forward to welcoming you.", y);
  y -= 12; T(p1, r, "For " + (tenant.legal_name || tenant.name), M, y, 10); y -= 34;
  T(p1, b, o.signatory || "Human Resources", M, y, 10.5); y -= 13; T(p1, r, "Authorised signatory", M, y, 9, GREY);
  T(p1, r, "This letter is issued electronically and is valid without a physical signature.", M, 34, 7.5, GREY);

  // ---------- page 2: Annexure A, salary breakup ----------
  const p2 = pdf.addPage([W, H]); y = header(p2);
  T(p2, b, `Annexure A - Salary structure (${o.ref_no})`, M, y, 12.5, brand); y -= 14;
  T(p2, r, `${o.candidate} - ${o.role}`, M, y, 9.5, GREY); y -= 22;
  const cM = W - M - 130, cA = W - M - 10;
  const head = (label: string) => { p2.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: BAND }); T(p2, b, label, M + 8, y - 13, 9.5); R(p2, b, "Monthly (Rs.)", cM, y - 13, 9.5); R(p2, b, "Yearly (Rs.)", cA, y - 13, 9.5); y -= 18; };
  const row = (label: string, m: number, a: number, bold = false) => { const f = bold ? b : r; T(p2, f, label, M + 8, y - 13, 9.5); R(p2, f, inr(m), cM, y - 13, 9.5); R(p2, f, inr(a), cA, y - 13, 9.5); y -= 17; p2.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); };
  head("A. Earnings");
  for (const e of bk.earnings) row(e.name, e.monthly, e.annual);
  row("Gross salary (A)", bk.monthly_gross, bk.monthly_gross * 12, true); y -= 8;
  head("B. Employer contributions");
  for (const e of bk.employer) row(e.name, e.monthly, e.annual);
  if (bk.gratuity) row("Gratuity (4.81% of basic)", bk.gratuity.monthly, bk.gratuity.annual);
  if (!bk.employer.length && !bk.gratuity) row("None", 0, 0);
  y -= 4;
  p2.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 22, color: brand });
  T(p2, b, "Cost to company (A + B)", M + 8, y - 15, 10.5, rgb(1, 1, 1)); R(p2, b, inr(bk.ctc_monthly), cM, y - 15, 10.5, rgb(1, 1, 1)); R(p2, b, inr(bk.ctc_annual), cA, y - 15, 10.5, rgb(1, 1, 1));
  y -= 36;
  head("C. Deductions from salary (indicative)");
  for (const d of bk.deductions) row(d.name, d.monthly, d.annual);
  if (!bk.deductions.length) row("None", 0, 0);
  row("Take-home pay (A - C), before income tax", bk.net_monthly, bk.net_monthly * 12, true);
  y -= 14;
  for (const line of wrap(r, "Notes: Gratuity is paid as per the Payment of Gratuity Act after the qualifying service. Professional Tax follows the state's slab; income tax (TDS) depends on your declarations and is deducted monthly. Amounts are rounded to the nearest rupee.", 8.5, W - 2 * M)) { T(p2, r, line, M, y, 8.5, GREY); y -= 11; }
  return pdf.save();
}
