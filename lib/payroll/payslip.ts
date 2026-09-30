import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRANDING_BUCKET } from "@/lib/storage";
import { fmtMonth } from "@/lib/attendance/time";
import type { Tenant } from "@/lib/types";
import { inr, rupeesInWords } from "./compute";
import type { Line } from "./service";

// A4 payslips with pdf-lib. Standard PDF fonts cannot draw "₹", so amounts are shown as "Rs." / plain figures.
const W = 595.28, H = 841.89, M = 40;
const safe = (s: unknown) => String(s ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
function hex(c: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim()); const n = parseInt(m ? m[1] : "1F3A5F", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const GREY = rgb(0.42, 0.45, 0.5), INK = rgb(0.1, 0.12, 0.16), LINE = rgb(0.86, 0.87, 0.9);

export async function companyLogo(tenant: Tenant): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  if (!tenant.logo_path || !/\.(png|jpe?g)$/i.test(tenant.logo_path)) return null;
  const { data } = await createAdminClient().storage.from(BRANDING_BUCKET).download(tenant.logo_path);
  return data ? { bytes: new Uint8Array(await data.arrayBuffer()), png: /\.png$/i.test(tenant.logo_path) } : null;
}

function text(p: PDFPage, f: PDFFont, s: unknown, x: number, y: number, size = 9, color = INK) { p.drawText(safe(s), { x, y, size, font: f, color }); }
function right(p: PDFPage, f: PDFFont, s: unknown, xr: number, y: number, size = 9, color = INK) { const t = safe(s); p.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color }); }
function fitText(f: PDFFont, s: string, size: number, max: number) { let t = safe(s); while (t.length > 3 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2); return t === safe(s) ? t : t + ".."; }

async function drawSlip(pdf: PDFDocument, fonts: { r: PDFFont; b: PDFFont }, tenant: Tenant, month: string, l: Line, logo: PDFImage | null, note?: string | null) {
  const p = pdf.addPage([W, H]); const { r, b } = fonts; const brand = hex(tenant.primary_color);
  let y = H - M;
  // header
  if (logo) { const s = Math.min(46 / logo.height, 120 / logo.width); p.drawImage(logo, { x: M, y: y - logo.height * s, width: logo.width * s, height: logo.height * s }); }
  const hx = logo ? M + 132 : M;
  text(p, b, tenant.legal_name || tenant.name, hx, y - 14, 14, brand);
  let ay = y - 28;
  for (const line of safe(tenant.address).split(/,\s*(?=[^,]{0,40}$)|\n/).slice(0, 2)) { text(p, r, fitText(r, line, 8.5, W - hx - M), hx, ay, 8.5, GREY); ay -= 11; }
  y -= 62;
  p.drawRectangle({ x: M, y: y - 26, width: W - 2 * M, height: 26, color: brand });
  text(p, b, `Payslip for ${fmtMonth(month)}`, M + 12, y - 17, 12, rgb(1, 1, 1));
  right(p, r, "Private and confidential", W - M - 12, y - 17, 8.5, rgb(1, 1, 1));
  y -= 40;

  // employee details (two columns)
  const i = l.info;
  const left: [string, unknown][] = [["Employee", i.name], ["Employee code", i.code], ["Designation", i.designation], ["Department", i.department], ["Date of joining", i.joined ? new Date(`${i.joined}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null]];
  const rightCol: [string, unknown][] = [["PAN", i.pan], ["UAN (PF)", i.uan], ["ESI number", i.esi_no], ["Bank account", i.account ? `${i.bank ?? ""} ...${String(i.account).slice(-4)}` : null],
    ["Paid days", `${l.paid_days} of ${l.days_in_month}${Number(l.lop_days) ? `  (LOP ${l.lop_days})` : ""}`]];
  for (let k = 0; k < 5; k++) {
    const [a, av] = left[k], [c, cv] = rightCol[k];
    text(p, r, a, M, y, 8.5, GREY); text(p, b, fitText(b, String(av ?? "-"), 9, 150), M + 90, y, 9);
    text(p, r, c, W / 2 + 10, y, 8.5, GREY); text(p, b, fitText(b, String(cv ?? "-"), 9, 150), W / 2 + 100, y, 9);
    y -= 15;
  }
  y -= 8;

  // earnings | deductions table
  const colW = (W - 2 * M) / 2;
  p.drawRectangle({ x: M, y: y - 20, width: W - 2 * M, height: 20, color: rgb(0.95, 0.96, 0.97) });
  text(p, b, "Earnings", M + 8, y - 14, 9.5); right(p, b, "Amount (Rs.)", M + colW - 8, y - 14, 9.5);
  text(p, b, "Deductions", M + colW + 8, y - 14, 9.5); right(p, b, "Amount (Rs.)", W - M - 8, y - 14, 9.5);
  y -= 20;
  const rows = Math.max(l.earnings.length, l.deductions.length, 4);
  for (let k = 0; k < rows; k++) {
    const e = l.earnings[k], d = l.deductions[k];
    if (e) { text(p, r, fitText(r, e.name, 9, colW - 90), M + 8, y - 14); right(p, r, inr(e.amount), M + colW - 8, y - 14); }
    if (d) { text(p, r, fitText(r, d.name, 9, colW - 90), M + colW + 8, y - 14); right(p, r, inr(d.amount), W - M - 8, y - 14); }
    y -= 18;
    p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
  }
  p.drawLine({ start: { x: M + colW, y }, end: { x: M + colW, y: y + rows * 18 + 20 }, thickness: 0.5, color: LINE });
  text(p, b, "Gross earnings", M + 8, y - 15, 9.5); right(p, b, inr(l.gross), M + colW - 8, y - 15, 9.5);
  text(p, b, "Total deductions", M + colW + 8, y - 15, 9.5); right(p, b, inr(l.total_deductions), W - M - 8, y - 15, 9.5);
  y -= 30;

  // net pay
  p.drawRectangle({ x: M, y: y - 44, width: W - 2 * M, height: 44, borderColor: brand, borderWidth: 1.2, color: rgb(0.97, 0.98, 1) });
  text(p, b, "Net pay", M + 12, y - 18, 11, brand); right(p, b, `Rs. ${inr(l.net_pay)}`, W - M - 12, y - 19, 14, brand);
  text(p, r, fitText(r, rupeesInWords(l.net_pay), 8.5, W - 2 * M - 24), M + 12, y - 34, 8.5, GREY);
  y -= 62;

  // employer contributions (for the employee's information)
  if (l.employer.length) {
    text(p, b, "Employer contributions (not deducted from your pay)", M, y, 9, GREY); y -= 14;
    const parts = l.employer.filter((e) => e.amount > 0).map((e) => `${e.name}: Rs. ${inr(e.amount)}`);
    for (let k = 0; k < parts.length; k += 2) { text(p, r, parts[k], M, y, 8.5); if (parts[k + 1]) text(p, r, parts[k + 1], W / 2 + 10, y, 8.5); y -= 12; }
    y -= 6;
  }
  if (l.notes) { text(p, r, fitText(r, `Note: ${l.notes}`, 8.5, W - 2 * M), M, y, 8.5); y -= 14; }
  if (note) text(p, r, fitText(r, note, 8, W - 2 * M), M, y, 8, GREY);
  text(p, r, "This is a computer-generated payslip and does not need a signature.", M, M, 8, GREY);
  right(p, r, safe(tenant.name), W - M, M, 8, GREY);
}

/** One PDF with one page per payslip. */
export async function buildPayslipsPdf(tenant: Tenant, month: string, lines: Line[], note?: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payslips ${month}`); pdf.setAuthor(safe(tenant.name));
  const fonts = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const lg = await companyLogo(tenant).catch(() => null);
  let logo: PDFImage | null = null;
  try { if (lg) logo = lg.png ? await pdf.embedPng(lg.bytes) : await pdf.embedJpg(lg.bytes); } catch { logo = null; }
  for (const l of lines) await drawSlip(pdf, fonts, tenant, month, l, logo, note);
  return pdf.save();
}
