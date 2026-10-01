import "server-only";
// Audit Pack: one PDF with the chosen people's competence, training and awareness evidence (IATF 16949 7.2 / 7.3).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { companyLogo } from "@/lib/payroll/payslip";
import type { Tenant } from "@/lib/types";

const W = 595.28, H = 841.89, M = 42;
const safe = (s: unknown) => String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/₹/g, "Rs.").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
const GREY = rgb(0.42, 0.45, 0.5), INK = rgb(0.1, 0.12, 0.16), LINE = rgb(0.86, 0.87, 0.9), BAND = rgb(0.95, 0.96, 0.97);
const OK = rgb(0.05, 0.5, 0.3), BAD = rgb(0.72, 0.16, 0.1), WARN = rgb(0.65, 0.4, 0);
function hex(c: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim()); const n = parseInt(m ? m[1]! : "1F3A5F", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const fmt = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "-");

export interface PackPerson {
  name: string; code: string | null; designation: string | null; department: string | null; plant: string | null; joined: string | null;
  rr: { version: number; acknowledged: string | null } | null;
  competencies: { name: string; required: number; actual: number; assessed: string | null; by: string | null }[];
  skills: { op: string; level: number; certified: string | null; valid: string | null }[];
  training: { date: string | null; title: string; hours: number; attended: boolean; pre: number | null; post: number | null; signed: string | null; result: string | null; evidence: string | null; by: string | null }[];
  ojt: { title: string; status: string; done: number; total: number; signed: string | null; on: string | null }[];
  auditor: { kind: string; qualification: string | null; valid: string | null; audits: number } | null;
  needs: { topic: string; source: string; status: string }[];
}
export interface Pack { scope: string; generatedBy: string; policy: string | null; objectives: string[]; people: PackPerson[] }

const LV = ["0 Not trained", "1 Under training", "2 Supervised", "3 Qualified", "4 Trainer"];
const RES: Record<string, string> = { effective: "Effective", partly: "Partly effective", not_effective: "Not effective" };

export async function buildAuditPack(tenant: Tenant, pack: Pack): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); pdf.setTitle(`Audit pack - ${pack.scope}`); pdf.setAuthor(tenant.legal_name || tenant.name);
  const r = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hex(tenant.primary_color);
  const lg = await companyLogo(tenant).catch(() => null);
  const logo = lg ? (lg.png ? await pdf.embedPng(lg.bytes) : await pdf.embedJpg(lg.bytes)) : null;
  let page!: PDFPage, y = 0, pageNo = 0;
  const T = (s: unknown, x: number, yy: number, size = 9, f: PDFFont = r, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const wrap = (s: string, size: number, max: number, f: PDFFont = r) => {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) { let line = ""; for (const w of para.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w; } else line = t; } out.push(line); }
    return out;
  };
  const newPage = (title?: string) => {
    page = pdf.addPage([W, H]); pageNo++;
    y = H - M;
    if (logo) { const s = Math.min(26 / logo.height, 90 / logo.width); page.drawImage(logo, { x: M, y: y - logo.height * s, width: logo.width * s, height: logo.height * s }); }
    T(tenant.legal_name || tenant.name, logo ? M + 100 : M, y - 12, 11, b, brand);
    T("Competence, training & awareness records - IATF 16949 7.2 / 7.3", logo ? M + 100 : M, y - 24, 8, r, GREY);
    page.drawLine({ start: { x: M, y: y - 32 }, end: { x: W - M, y: y - 32 }, thickness: 1, color: brand });
    T(`Page ${pageNo}`, W - M - 40, 24, 7.5, r, GREY); T(`Audit pack - ${pack.scope} - generated ${fmt(new Date().toISOString())} by ${pack.generatedBy}`, M, 24, 7.5, r, GREY);
    y -= 50;
    if (title) { T(title, M, y, 13, b, brand); y -= 18; }
  };
  const need = (h: number) => { if (y - h < 50) newPage(); };
  const section = (title: string, clause: string) => {
    need(40); y -= 6;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: BAND });
    T(title, M + 6, y, 9.5, b); const cw = r.widthOfTextAtSize(clause, 7.5); T(clause, W - M - 6 - cw, y + 1, 7.5, r, GREY);
    y -= 18;
  };
  const table = (cols: { label: string; w: number; right?: boolean }[], rows: { cells: string[]; color?: (ReturnType<typeof rgb> | null)[] }[], empty: string) => {
    if (!rows.length) { need(14); T(empty, M + 6, y, 8.5, r, GREY); y -= 14; return; }
    const head = () => { let x = M + 4; for (const c of cols) { T(c.label, c.right ? x + c.w - b.widthOfTextAtSize(c.label, 7.5) - 4 : x, y, 7.5, b, GREY); x += c.w; } y -= 11; };
    need(24); head();
    for (const row of rows) {
      const wrapped = row.cells.map((c, i) => wrap(c, 8, cols[i]!.w - 6));
      const h = Math.max(...wrapped.map((w) => w.length)) * 10 + 3;
      if (y - h < 50) { newPage(); head(); }
      let x = M + 4;
      wrapped.forEach((ls, i) => { ls.forEach((l, j) => T(l, cols[i]!.right ? x + cols[i]!.w - r.widthOfTextAtSize(l, 8) - 4 : x, y - j * 10, 8, r, row.color?.[i] ?? INK)); x += cols[i]!.w; });
      y -= h; page.drawLine({ start: { x: M, y: y + 7 }, end: { x: W - M, y: y + 7 }, thickness: 0.4, color: LINE });
    }
    y -= 4;
  };

  // ---------- cover ----------
  newPage("Audit pack");
  T(`Scope: ${pack.scope}`, M, y, 10, b); y -= 14;
  T(`${pack.people.length} people · generated ${fmt(new Date().toISOString())} from the HRM's live records`, M, y, 9, r, GREY); y -= 22;
  if (pack.policy) { T("Quality policy", M, y, 10, b); y -= 13; for (const l of wrap(pack.policy, 9, W - 2 * M)) { T(l, M, y, 9); y -= 12; } y -= 6; }
  if (pack.objectives.length) { T("Quality objectives", M, y, 10, b); y -= 13; for (const o of pack.objectives) for (const l of wrap(`- ${o}`, 9, W - 2 * M)) { T(l, M, y, 9); y -= 12; } y -= 6; }
  const tot = (f: (p: PackPerson) => number) => pack.people.reduce((s, p) => s + f(p), 0);
  const reqN = tot((p) => p.competencies.length), metN = tot((p) => p.competencies.filter((c) => c.actual >= c.required).length);
  const trN = tot((p) => p.training.filter((t) => t.attended).length), effN = tot((p) => p.training.filter((t) => t.result).length), effOk = tot((p) => p.training.filter((t) => t.result === "effective").length);
  const ackN = pack.people.filter((p) => p.rr?.acknowledged).length, rrN = pack.people.filter((p) => p.rr).length;
  section("Summary", "evidence index");
  table([{ label: "Clause", w: 90 }, { label: "Requirement", w: 250 }, { label: "Evidence in this pack", w: W - 2 * M - 340 }], [
    { cells: ["ISO 9001 5.3", "Roles, responsibilities and authorities", `${ackN} of ${rrN} acknowledged the current version`] },
    { cells: ["IATF 7.2.1", "Competence: required vs actual", reqN ? `${metN} of ${reqN} required competencies met (${Math.round((metN / reqN) * 100)}%)` : "No requirements set"] },
    { cells: ["IATF 7.2.1 / 7.2.3", "Skill matrix (qualification on operations)", `${tot((p) => p.skills.filter((s) => s.level >= 3).length)} qualifications on operations`] },
    { cells: ["ISO 9001 7.2(c)", "Training and its effectiveness", `${trN} trainings attended; ${effN} evaluated, ${effOk} effective`] },
    { cells: ["IATF 7.2.2", "On-the-job training (incl. CSR, nonconformity)", `${tot((p) => p.ojt.filter((o) => o.status === "completed").length)} completed, ${tot((p) => p.ojt.filter((o) => o.status === "in_progress").length)} in progress`] },
    { cells: ["IATF 7.2.3", "Internal auditor competency", `${pack.people.filter((p) => p.auditor).length} internal auditors in scope`] },
    { cells: ["IATF 7.3", "Awareness (policy, objectives, product safety, CSR)", `${tot((p) => p.training.filter((t) => t.signed).length)} awareness sign-offs`] },
  ], "");
  section("People in this pack", "");
  table([{ label: "Name", w: 150 }, { label: "Code", w: 70 }, { label: "Designation", w: 120 }, { label: "Department", w: W - 2 * M - 340 }],
    pack.people.map((p) => ({ cells: [p.name, p.code ?? "-", p.designation ?? "-", p.department ?? "-"] })), "Nobody in scope.");

  // ---------- one section per person ----------
  for (const p of pack.people) {
    newPage(p.name);
    T([p.code, p.designation, p.department, p.plant, p.joined ? `joined ${fmt(p.joined)}` : null].filter(Boolean).join("  |  "), M, y, 9, r, GREY); y -= 16;
    section("Roles & responsibilities", "ISO 9001 5.3");
    need(14); T(p.rr ? (p.rr.acknowledged ? `Version ${p.rr.version} acknowledged on ${fmt(p.rr.acknowledged)}` : `Version ${p.rr.version} - not acknowledged yet`) : "No roles & responsibilities written for this designation", M + 6, y, 8.5, r, p.rr?.acknowledged ? OK : WARN); y -= 14;
    section("Competence - required vs assessed", "IATF 7.2.1 / ISO 9001 7.2");
    table([{ label: "Competency", w: 220 }, { label: "Needs", w: 50, right: true }, { label: "Has", w: 50, right: true }, { label: "Assessed", w: W - 2 * M - 320 }],
      p.competencies.map((c) => ({ cells: [c.name, String(c.required), String(c.actual), c.assessed ? `${fmt(c.assessed)}${c.by ? ` by ${c.by}` : ""}` : "-"], color: [null, null, c.actual >= c.required ? OK : BAD, null] })), "No competency requirements for this designation.");
    section("Skill matrix", "IATF 7.2.1 / 7.2.3");
    table([{ label: "Operation", w: 230 }, { label: "Level", w: 100 }, { label: "Certified", w: 90 }, { label: "Valid until", w: W - 2 * M - 420 }],
      p.skills.map((s) => ({ cells: [s.op, LV[s.level] ?? String(s.level), fmt(s.certified), fmt(s.valid)], color: [null, s.level >= 3 ? OK : WARN, null, null] })), "No operations recorded.");
    section("Training and effectiveness", "ISO 9001 7.2(c) / IATF 7.3");
    table([{ label: "Date", w: 62 }, { label: "Training", w: 150 }, { label: "Hrs", w: 28, right: true }, { label: "Test", w: 56 }, { label: "Effectiveness / sign-off", w: W - 2 * M - 296 }],
      p.training.map((t) => ({
        cells: [fmt(t.date), t.title, String(t.hours), t.post != null ? `${t.pre ?? "-"} > ${t.post}%` : "-",
          !t.attended ? "Absent" : t.result ? `${RES[t.result]}${t.evidence ? `: ${t.evidence}` : ""}${t.by ? ` (${t.by})` : ""}` : t.signed ? `Signed off ${fmt(t.signed)}` : "Evaluation due"],
        color: [null, null, null, null, !t.attended ? GREY : t.result === "effective" || t.signed ? OK : t.result === "not_effective" ? BAD : WARN],
      })), "No training recorded.");
    if (p.ojt.length) { section("On-the-job training", "IATF 7.2.2");
      table([{ label: "Checklist", w: 250 }, { label: "Progress", w: 80 }, { label: "Signed off", w: W - 2 * M - 330 }],
        p.ojt.map((o) => ({ cells: [o.title, `${o.done} of ${o.total}`, o.status === "completed" ? `${fmt(o.on)}${o.signed ? ` by ${o.signed}` : ""}` : "In progress"] })), ""); }
    if (p.auditor) { section("Internal auditor", "IATF 7.2.3"); need(14);
      T(`${p.auditor.kind} auditor - ${p.auditor.qualification ?? ""} - valid until ${fmt(p.auditor.valid)} - ${p.auditor.audits} audits in the last 12 months`, M + 6, y, 8.5); y -= 14; }
    if (p.needs.length) { section("Open training needs", "IATF 7.2.1");
      table([{ label: "Training", w: 280 }, { label: "Why", w: 130 }, { label: "Status", w: W - 2 * M - 410 }], p.needs.map((n) => ({ cells: [n.topic, n.source, n.status] })), ""); }
  }
  return pdf.save();
}
