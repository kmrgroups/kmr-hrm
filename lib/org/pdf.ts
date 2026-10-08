import "server-only";
// The organisation chart as a landscape A4 PDF: logo top-left, document box (doc. no., revision, date, page), the chart scaled evenly
// (same factor across and down) to fill one page, the department legend, the revision history and the prepared / approved block.
import { rgb } from "pdf-lib";
import { landscapeSheet, pdfSafe, pdfDate } from "@/lib/qms/sheet-pdf";
import type { Tenant } from "@/lib/types";
import { BOX, groupColors, layoutChart, type OrgItem } from "./layout";

export interface OrgPdfInput {
  tenant: Tenant; items: OrgItem[]; title: string; docNo: string;
  rev: { no: number; date: string; preparedBy: string | null; approvedBy: string | null } | null;
  history: { rev_no: number; issued_on: string; change_note: string | null }[];
  draft: boolean; printedOn: string; scopeNote?: string | null;
}

const INK = rgb(0.1, 0.12, 0.16), GREY = rgb(0.4, 0.43, 0.48), LINE = rgb(0.62, 0.66, 0.72), EDGE = rgb(0.45, 0.5, 0.58);
const hexRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

export async function orgChartPdf(inp: OrgPdfInput): Promise<Uint8Array> {
  const d = await landscapeSheet(inp.tenant, {
    title: inp.title, docNo: inp.docNo, rev: inp.rev ? String(inp.rev.no).padStart(2, "0") : "-", date: inp.rev?.date ?? inp.printedOn,
    clauses: "ISO 9001:2015 cl. 5.3, 7.1.2, 7.5  |  IATF 16949:2016 cl. 5.3.1", status: inp.draft ? "draft" : "approved",
  });
  const { b, r, T } = d;
  const top = d.newPage();                               // y just under the header band
  const page = d.page;
  const W = page.getWidth(), M = 28, footH = 74;
  const L = layoutChart(inp.items);
  const colors = groupColors(inp.items);

  // ---- chart area, scaled evenly in both directions
  const ax = M, aw = W - 2 * M, aTop = top - 4, aBot = M + footH + 8, ah = aTop - aBot;
  const s = Math.min(aw / L.width, ah / L.height, 1.35);
  const ox = ax + (aw - L.width * s) / 2, oy = (ah - L.height * s) / 2;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => aTop - oy - y * s;
  if (!L.nodes.length) T("No one is on the chart yet.", M, aTop - 30, 10, r, GREY);
  for (const e of L.edges) for (let i = 1; i < e.length; i++) page.drawLine({ start: { x: X(e[i - 1]![0]), y: Y(e[i - 1]![1]) }, end: { x: X(e[i]![0]), y: Y(e[i]![1]) }, thickness: Math.max(0.5, 1.1 * s), color: EDGE });
  const fit = (f: typeof r, text: string, size: number, max: number) => { let t = pdfSafe(text); while (t.length > 2 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -1); return t === pdfSafe(text) ? t : t.slice(0, -1) + "."; };
  for (const n of L.nodes) {
    const bx = X(n.x), by = Y(n.y + n.h), bw = n.w * s, bh = n.h * s;
    const vacant = n.kind === "vacant", ext = n.kind === "external";
    page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: vacant ? rgb(1, 0.97, 0.88) : ext ? rgb(0.95, 0.96, 0.97) : rgb(1, 1, 1), borderColor: vacant ? rgb(0.8, 0.55, 0.1) : LINE, borderWidth: Math.max(0.5, 0.9 * s), ...(vacant || ext ? { borderDashArray: [3 * s, 2 * s] } : {}) });
    const col = colors.get(n.group);
    page.drawRectangle({ x: bx, y: by, width: Math.max(1.6, 5 * s), height: bh, color: col ? hexRgb(col) : rgb(0.6, 0.64, 0.7) });
    const tx = bx + 9 * s, mw = bw - 13 * s;
    const t1 = 9.4 * s, t2 = 7.6 * s, t3 = 6.8 * s;
    T(fit(b, n.title, t1, mw), tx, by + bh - 17 * s, t1, b, INK);
    if (n.subtitle) T(fit(r, n.subtitle, t2, mw), tx, by + bh - 30 * s, t2, r, INK);
    if (n.line3) T(fit(r, n.line3, t3, mw), tx, by + bh - 43 * s, t3, r, vacant ? rgb(0.7, 0.4, 0) : GREY);
  }

  // ---- footer: legend | revision history | prepared / approved
  const fy = M + footH;                                   // top of footer block
  page.drawLine({ start: { x: M, y: fy }, end: { x: W - M, y: fy }, thickness: 0.6, color: LINE });
  T("Department", M, fy - 10, 7, b, GREY);
  let lx = M, ly = fy - 21;
  for (const [name, col] of colors) {
    const wlab = r.widthOfTextAtSize(pdfSafe(name), 6.8) + 18;
    if (lx + wlab > M + 250) { lx = M; ly -= 10; if (ly < M + 14) break; }
    page.drawRectangle({ x: lx, y: ly - 1, width: 8, height: 6, color: hexRgb(col) });
    T(name, lx + 11, ly, 6.8, r, INK); lx += wlab + 6;
  }
  T(pdfSafe(`Boxes with a dashed outline: vacancy / external. Chart scaled to ${Math.round(s * 100)}% to fit one page.${inp.scopeNote ? " " + inp.scopeNote : ""}`), M, M + 14, 6.4, r, GREY);

  const hx = M + 270;
  T("Revision history", hx, fy - 10, 7, b, GREY);
  const hist = inp.history.slice(0, 3);
  hist.forEach((h, i) => {
    T(`Rev ${String(h.rev_no).padStart(2, "0")}`, hx, fy - 21 - i * 10, 6.8, b, INK);
    T(pdfDate(h.issued_on), hx + 34, fy - 21 - i * 10, 6.8, r, INK);
    T(fit(r, h.change_note ?? "-", 6.8, 190), hx + 84, fy - 21 - i * 10, 6.8, r, INK);
  });
  if (!hist.length) T("Not yet issued", hx, fy - 21, 6.8, r, GREY);

  const px = W - M - 250;
  const sign = (label: string, name: string | null, y: number) => {
    T(label, px, y, 7, r, GREY);
    T(name ?? "", px + 56, y, 8, b, INK);
    page.drawLine({ start: { x: px + 54, y: y - 2 }, end: { x: px + 150, y: y - 2 }, thickness: 0.4, color: LINE });
    T("Sign / date", px + 160, y, 6.5, r, GREY);
    page.drawLine({ start: { x: px + 196, y: y - 2 }, end: { x: px + 250, y: y - 2 }, thickness: 0.4, color: LINE });
  };
  sign("Prepared by", inp.rev?.preparedBy ?? null, fy - 20);
  sign("Approved by", inp.rev?.approvedBy ?? null, fy - 40);
  T(pdfSafe(inp.draft ? "DRAFT - changes not yet issued as a revision" : "Issued revision"), px, fy - 56, 7, b, inp.draft ? rgb(0.75, 0.15, 0.1) : rgb(0.05, 0.45, 0.28));
  T(pdfSafe(`Controlled document: valid only as shown in the HRM. Printed copies are uncontrolled.  Printed ${pdfDate(inp.printedOn)}`), M, M + 3, 6.4, r, GREY);
  return d.pdf.save();
}
void BOX;
