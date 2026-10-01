import "server-only";
// Landscape QMS documents (A4): the R&R sheet of a position (no names), the competency-mapping sheet (with names)
// and the KPI sheet of a person. Company logo, title, document number, revision and the ISO 9001 / IATF 16949 clauses
// on every page. Free — pdf-lib on the server.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { companyLogo } from "@/lib/payroll/payslip";
import type { Tenant } from "@/lib/types";
import { COMP_LEVELS } from "./rules";
import { FREQUENCIES } from "./kpi-catalog";

const W = 841.89, H = 595.28, M = 28;
const safe = (s: unknown) => String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/₹/g, "Rs.").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/[^\x20-\x7E\xA0-\xFF\u2022]/g, "?");
const GREY = rgb(0.4, 0.43, 0.48), INK = rgb(0.1, 0.12, 0.16), LINE = rgb(0.75, 0.78, 0.82), BAND = rgb(0.93, 0.95, 0.97);
const OK = rgb(0.05, 0.45, 0.28), BAD = rgb(0.75, 0.15, 0.1), BADBG = rgb(0.99, 0.91, 0.9), OKBG = rgb(0.9, 0.97, 0.93);
const fmt = (d: string | Date | null | undefined) => (d ? new Date(typeof d === "string" && d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "-");
function hex(c: string | null | undefined) { const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim()); const n = parseInt(m ? m[1]! : "1F3A5F", 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }

interface Doc { title: string; docNo: string; rev: string | number; date: string | null; clauses: string; status?: string }

async function setup(tenant: Tenant, doc: Doc) {
  const pdf = await PDFDocument.create(); pdf.setTitle(`${doc.title}`); pdf.setAuthor(tenant.legal_name || tenant.name);
  const r = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lg = await companyLogo(tenant).catch(() => null);
  const logo = lg ? (lg.png ? await pdf.embedPng(lg.bytes) : await pdf.embedJpg(lg.bytes)) : null;
  const brand = hex(tenant.primary_color);
  let page!: PDFPage; let pageNo = 0;
  const T = (s: unknown, x: number, y: number, size = 8, f: PDFFont = r, color: RGB = INK) => page.drawText(safe(s), { x, y, size, font: f, color });
  const wrap = (s: string, size: number, max: number, f: PDFFont = r) => {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) { let line = ""; for (const w of para.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w; } else line = t; } out.push(line); }
    return out;
  };
  /** header band: logo | company + title | document box; returns the y below it */
  const newPage = () => {
    page = pdf.addPage([W, H]); pageNo++;
    const top = H - M, hh = 52;
    page.drawRectangle({ x: M, y: top - hh, width: W - 2 * M, height: hh, borderColor: LINE, borderWidth: 0.8 });
    if (logo) { const s = Math.min(38 / logo.height, 110 / logo.width); page.drawImage(logo, { x: M + 8, y: top - hh / 2 - (logo.height * s) / 2, width: logo.width * s, height: logo.height * s }); }
    page.drawLine({ start: { x: M + 128, y: top }, end: { x: M + 128, y: top - hh }, thickness: 0.8, color: LINE });
    const boxX = W - M - 170;
    page.drawLine({ start: { x: boxX, y: top }, end: { x: boxX, y: top - hh }, thickness: 0.8, color: LINE });
    const cx = (M + 128 + boxX) / 2;
    const comp = safe(tenant.legal_name || tenant.name), title = safe(doc.title);
    T(comp, cx - b.widthOfTextAtSize(comp, 11) / 2, top - 18, 11, b, brand);
    T(title, cx - b.widthOfTextAtSize(title, 12) / 2, top - 34, 12, b);
    const cl = safe(doc.clauses); T(cl, cx - r.widthOfTextAtSize(cl, 6.8) / 2, top - 46, 6.8, r, GREY);
    const rows: [string, string][] = [["Doc. no.", doc.docNo], ["Revision", String(doc.rev)], ["Date", fmt(doc.date)], ["Page", String(pageNo)]];
    rows.forEach(([k, v], i) => { const y = top - 12 - i * 11.5; T(k, boxX + 6, y, 7.5, r, GREY); T(v, boxX + 62, y, 7.5, b); });
    if (doc.status && doc.status !== "approved") { const st = "DRAFT - NOT APPROVED"; T(st, W - M - b.widthOfTextAtSize(st, 8) , top - hh - 10, 8, b, BAD); }
    return top - hh - 14;
  };
  return { pdf, r, b, brand, T, wrap, newPage, get page() { return page; } };
}

// ------------------------------------------------------------------ R&R sheet of a position
export interface RrSheet {
  position: string; role: string | null; department: string | null; purpose: string | null; reportsTo?: string | null;
  roles: string[]; responsibilities: string[]; authorities: string[];
  competencies: { name: string; level: number }[];
  kpis: { name: string; unit: string | null; target: number | null; direction: string; frequency: string; review_method: string | null }[];
  docNo: string; version: number; date: string | null; status: string; jdVersion?: number | null;
}

export async function rrSheetPdf(tenant: Tenant, s: RrSheet): Promise<Uint8Array> {
  const d = await setup(tenant, { title: "Roles, Responsibilities, Authority, Competency & KPI", docNo: s.docNo, rev: s.version, date: s.date, status: s.status,
    clauses: "ISO 9001:2015 cl. 5.3, 6.2, 7.1.2, 7.2, 9.1.1  |  IATF 16949:2016 cl. 5.3.1, 5.3.2, 7.2.1, 7.2.2" });
  const { T, wrap, b, r } = d;
  let y = d.newPage();
  // position band (the position, never a person)
  const info: [string, string][] = [["Position", s.position], ["Role", s.role ?? "-"], ["Department", s.department ?? "-"]];
  let x = M;
  const colW = (W - 2 * M) / 3;
  info.forEach(([k, v]) => { d.page.drawRectangle({ x, y: y - 18, width: colW, height: 18, color: BAND, borderColor: LINE, borderWidth: 0.5 }); T(k, x + 6, y - 12, 7.5, r, GREY); T(v, x + 60, y - 12, 9, b); x += colW; });
  y -= 24;
  if (s.purpose) { for (const l of wrap(`Purpose: ${s.purpose}`, 8, W - 2 * M - 8)) { T(l, M + 4, y - 8, 8); y -= 10; } y -= 4; }

  // five columns side by side
  const cols = [{ h: "Roles", w: 0.13 }, { h: "Responsibilities", w: 0.3 }, { h: "Authority", w: 0.19 }, { h: "Competency (level needed)", w: 0.18 }, { h: "KPI (target · review)", w: 0.2 }];
  const widths = cols.map((c) => c.w * (W - 2 * M));
  const items: string[][][] = [
    s.roles.map((t) => wrap(`• ${t}`, 7.6, widths[0]! - 10)),
    s.responsibilities.map((t, i) => wrap(`${i + 1}. ${t}`, 7.6, widths[1]! - 10)),
    s.authorities.map((t) => wrap(`• ${t}`, 7.6, widths[2]! - 10)),
    s.competencies.map((c) => wrap(`• ${c.name} — L${c.level} ${COMP_LEVELS[c.level]?.split(" — ")[0] ?? ""}`, 7.6, widths[3]! - 10)),
    s.kpis.map((k) => wrap(`• ${k.name}: ${k.target != null ? `${k.direction === "lower" ? "<=" : ">="} ${k.target}${k.unit ? ` ${k.unit}` : ""}` : "target to be set"} · ${FREQUENCIES[k.frequency] ?? k.frequency}${k.review_method ? ` · ${k.review_method}` : ""}`, 7.6, widths[4]! - 10)),
  ];
  const bottom = 92;        // room for the signature block
  const head = () => { let cx = M; cols.forEach((c, i) => { d.page.drawRectangle({ x: cx, y: y - 16, width: widths[i]!, height: 16, color: d.brand }); T(c.h, cx + 5, y - 11, 8.2, b, rgb(1, 1, 1)); cx += widths[i]!; }); y -= 16; };
  head();
  const pos = items.map(() => 0);          // next item per column
  while (pos.some((p, i) => p < items[i]!.length)) {
    const yStart = y;
    const used = items.map(() => 0);
    let more = false;
    items.forEach((col, i) => {
      let yy = yStart - 4;
      while (pos[i]! < col.length) {
        const ls = col[pos[i]!]!;
        if (yy - ls.length * 9.4 < bottom) { more = true; break; }
        let cx = M + widths.slice(0, i).reduce((a, w) => a + w, 0);
        ls.forEach((l, j) => T(l, cx + 5, yy - 8 - j * 9.4, 7.6));
        yy -= ls.length * 9.4 + 3; pos[i]!++; cx = 0;
      }
      used[i] = yStart - yy;
    });
    const h = Math.max(...used, 20);
    let cx = M; widths.forEach((w) => { d.page.drawRectangle({ x: cx, y: yStart - h - 4, width: w, height: h + 4, borderColor: LINE, borderWidth: 0.6 }); cx += w; });
    y = yStart - h - 4;
    if (more) { sign(); y = d.newPage(); head(); }
  }
  sign();
  function sign() {
    const yy = 70;
    T("Competency levels: 1 Awareness · 2 Basic, with guidance · 3 Proficient, independent · 4 Expert, can teach. This sheet describes the position, not a person; each holder acknowledges it.", M, yy + 12, 6.8, r, GREY);
    const boxes = ["Prepared by (HR)", "Reviewed by (Head of department)", "Approved by (Plant / Management head)"];
    const bw = (W - 2 * M) / 3;
    boxes.forEach((t, i) => { const bx = M + i * bw; d.page.drawRectangle({ x: bx, y: 24, width: bw, height: 40, borderColor: LINE, borderWidth: 0.6 }); T(t, bx + 6, 54, 7.5, r, GREY); T("Sign & date", bx + 6, 30, 7, r, GREY); });
    if (s.jdVersion) T(`Written from job description version ${s.jdVersion}`, W - M - 160, yy + 12, 6.8, r, GREY);
  }
  return d.pdf.save();
}

// ------------------------------------------------------------------ competency mapping (names allowed here)
export interface MappingSheet {
  position: string; role: string | null; department: string | null; docNo: string; date: string;
  competencies: { id: string; name: string; required: number }[];
  people: { name: string; code: string | null; designation: string | null; levels: Record<string, number>; assessed: string | null }[];
}
export async function mappingPdf(tenant: Tenant, s: MappingSheet): Promise<Uint8Array> {
  const d = await setup(tenant, { title: "Competency Mapping", docNo: s.docNo, rev: "-", date: s.date, clauses: "IATF 16949:2016 cl. 7.2.1  |  ISO 9001:2015 cl. 7.2 a), b)" });
  const { T, wrap, b, r } = d;
  let y = d.newPage();
  T(`Position: ${s.position}${s.role ? ` - ${s.role}` : ""}${s.department ? `   |   Department: ${s.department}` : ""}`, M, y - 8, 9.5, b); y -= 18;
  const fixed = [{ h: "#", w: 18 }, { h: "Name", w: 110 }, { h: "Emp. code", w: 56 }, { h: "Designation", w: 86 }];
  const fixedW = fixed.reduce((a, c) => a + c.w, 0), gapW = 120;
  const n = Math.max(1, s.competencies.length);
  const cw = Math.max(44, Math.min(90, (W - 2 * M - fixedW - gapW) / n));
  const headH = 58;
  const header = () => {
    let x = M;
    for (const c of fixed) { d.page.drawRectangle({ x, y: y - headH, width: c.w, height: headH, color: BAND, borderColor: LINE, borderWidth: 0.5 }); T(c.h, x + 3, y - headH + 6, 7.5, b); x += c.w; }
    for (const c of s.competencies) {
      d.page.drawRectangle({ x, y: y - headH, width: cw, height: headH, color: BAND, borderColor: LINE, borderWidth: 0.5 });
      wrap(c.name, 6.6, cw - 6, b).slice(0, 4).forEach((l, j) => T(l, x + 3, y - 10 - j * 8, 6.6, b));
      T(`needs L${c.required}`, x + 3, y - headH + 6, 6.8, r, GREY); x += cw;
    }
    d.page.drawRectangle({ x, y: y - headH, width: gapW, height: headH, color: BAND, borderColor: LINE, borderWidth: 0.5 }); T("Gaps (go to TNI)", x + 3, y - headH + 6, 7.5, b);
    y -= headH;
  };
  header();
  s.people.forEach((p, i) => {
    const gaps = s.competencies.filter((c) => (p.levels[c.id] ?? 0) < c.required);
    const gapText = gaps.length ? gaps.map((c) => c.name).join(", ") : "None";
    const gl = wrap(gapText, 6.8, gapW - 6);
    const h = Math.max(16, gl.length * 8.5 + 6);
    if (y - h < 60) { y = d.newPage(); header(); }
    let x = M;
    [String(i + 1), p.name, p.code ?? "-", p.designation ?? "-"].forEach((v, j) => { d.page.drawRectangle({ x, y: y - h, width: fixed[j]!.w, height: h, borderColor: LINE, borderWidth: 0.5 }); T(wrap(v, 7.5, fixed[j]!.w - 5)[0], x + 3, y - 11, 7.5); x += fixed[j]!.w; });
    for (const c of s.competencies) {
      const l = p.levels[c.id] ?? 0, short = l < c.required;
      d.page.drawRectangle({ x, y: y - h, width: cw, height: h, color: short ? BADBG : OKBG, borderColor: LINE, borderWidth: 0.5 });
      const t = String(l); T(t, x + cw / 2 - b.widthOfTextAtSize(t, 9) / 2, y - 12, 9, b, short ? BAD : OK); x += cw;
    }
    d.page.drawRectangle({ x, y: y - h, width: gapW, height: h, borderColor: LINE, borderWidth: 0.5 });
    gl.forEach((l, j) => T(l, x + 3, y - 10 - j * 8.5, 6.8, r, gaps.length ? BAD : OK));
    y -= h;
  });
  if (!s.people.length) { T("Nobody holds this position yet.", M, y - 14, 9, r, GREY); y -= 20; }
  T(`Levels: ${COMP_LEVELS.map((l, i) => `${i} ${l}`).join(" · ")}. Green = meets the position's need; red = gap, raised as a training need.`, M, 40, 7, r, GREY);
  T("Assessed by: ____________________      Reviewed by (HOD): ____________________      Date: __________", M, 24, 8, r, GREY);
  return d.pdf.save();
}

// ------------------------------------------------------------------ KPI sheet of a person
export interface KpiSheetPerson {
  name: string; code: string | null; designation: string | null; department: string | null;
  rows: { name: string; unit: string | null; target: number | null; direction: string; frequency: string; review_method: string | null; data_source: string | null;
    actuals: (number | null)[]; achievement: number | null }[];
}
export async function kpiSheetPdf(tenant: Tenant, s: { position: string; role: string | null; months: string[]; monthLabels: string[]; date: string; docNo: string; people: KpiSheetPerson[] }): Promise<Uint8Array> {
  const d = await setup(tenant, { title: "KPI Sheet", docNo: s.docNo, rev: "-", date: s.date, clauses: "ISO 9001:2015 cl. 6.2, 9.1.1, 9.1.3  |  IATF 16949:2016 cl. 5.3.1, 9.1.1.1" });
  const { T, wrap, b, r } = d;
  for (const p of s.people.length ? s.people : [null]) {
    let y = d.newPage();
    if (!p) { T("Nobody holds this position yet.", M, y - 14, 9, r, GREY); continue; }
    const info: [string, string][] = [["Name", p.name], ["Emp. code", p.code ?? "-"], ["Designation", p.designation ?? "-"], ["Position", `${s.position}${s.role ? ` - ${s.role}` : ""}`], ["Department", p.department ?? "-"]];
    const iw = (W - 2 * M) / info.length;
    info.forEach(([k, v], i) => { const x = M + i * iw; d.page.drawRectangle({ x, y: y - 26, width: iw, height: 26, color: BAND, borderColor: LINE, borderWidth: 0.5 }); T(k, x + 5, y - 9, 6.8, r, GREY);
      const size = [8.5, 7.5, 6.6, 5.8].find((z) => b.widthOfTextAtSize(safe(v), z) <= iw - 8) ?? 5.8; T(wrap(v, size, iw - 8, b)[0], x + 5, y - 21, size, b); });
    y -= 34;
    const cols = [{ h: "#", w: 18 }, { h: "KPI", w: 170 }, { h: "Target", w: 76 }, { h: "Frequency of review", w: 70 }, { h: "Review method", w: 170 },
      ...s.monthLabels.map((m) => ({ h: `Actual ${m}`, w: 62 })), { h: "Achievement", w: 0 }];
    const used = cols.reduce((a, c) => a + c.w, 0); cols[cols.length - 1]!.w = W - 2 * M - used;
    let x = M; cols.forEach((c) => { d.page.drawRectangle({ x, y: y - 22, width: c.w, height: 22, color: d.brand }); wrap(c.h, 7, c.w - 6, b).slice(0, 2).forEach((l, j) => T(l, x + 3, y - 9 - j * 8, 7, b, rgb(1, 1, 1))); x += c.w; });
    y -= 22;
    p.rows.forEach((k, i) => {
      const vals = [String(i + 1), k.name, k.target != null ? `${k.direction === "lower" ? "<=" : ">="} ${k.target}${k.unit ? ` ${k.unit}` : ""}` : "-", (FREQUENCIES[k.frequency] ?? k.frequency),
        k.review_method ?? "-", ...k.actuals.map((a) => (a == null ? "-" : String(a))), k.achievement == null ? "-" : `${k.achievement}%`];
      const wrapped = vals.map((v, j) => wrap(v, 7.6, cols[j]!.w - 6));
      const h = Math.max(...wrapped.map((w) => w.length)) * 9 + 6;
      let cx = M;
      wrapped.forEach((ls, j) => {
        const isAch = j === vals.length - 1, a = k.achievement;
        d.page.drawRectangle({ x: cx, y: y - h, width: cols[j]!.w, height: h, borderColor: LINE, borderWidth: 0.5, color: isAch && a != null ? (a >= 95 ? OKBG : a < 80 ? BADBG : undefined) : undefined });
        ls.forEach((l, li) => T(l, cx + 3, y - 10 - li * 9, 7.6, isAch ? b : r, isAch && a != null ? (a >= 95 ? OK : a < 80 ? BAD : INK) : INK)); cx += cols[j]!.w;
      });
      y -= h;
    });
    if (!p.rows.length) { T("No KPIs set for this position.", M, y - 14, 9, r, GREY); }
    T("Achievement = the latest actual against the target (100 = on target, capped at 120). Reviewed as per the frequency with the reporting head.", M, 46, 7, r, GREY);
    T("Employee: ____________________      Reviewed by (Reporting head): ____________________      Date: __________", M, 26, 8, r, GREY);
  }
  return d.pdf.save();
}

/** the same landscape header (logo, company, title, clauses, doc no. / revision / date / page) for other registers */
export { setup as landscapeSheet, safe as pdfSafe, fmt as pdfDate };
