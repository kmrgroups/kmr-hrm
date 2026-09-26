import {
  PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
  type PDFFont, type PDFImage, type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";

// CR80 card, portrait: 53.98 mm x 85.6 mm
const MM = 72 / 25.4;
export const CARD_W = 53.98 * MM; // 153.0 pt
export const CARD_H = 85.6 * MM; // 242.6 pt

export interface IdCardData {
  company: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  primaryColor: string;
  accentColor: string;
  logo?: Uint8Array | null;
  logoType?: "png" | "jpg";
  photo?: Uint8Array | null;
  photoType?: "png" | "jpg";
  name: string;
  employeeCode: string;
  designation?: string | null;
  department?: string | null;
  bloodGroup?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  validUntil?: string | null;
  verifyUrl: string;
  signatory?: string | null;
}

function hex(c: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  const n = parseInt(m ? m[1] : "1F3A5F", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard PDF fonts only cover Latin-1; replace anything else so drawing never fails. */
function safe(s: string | null | undefined): string {
  return (s ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function fit(font: PDFFont, text: string, size: number, maxW: number, min = 5): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.25;
  return s;
}

function centered(page: PDFPage, font: PDFFont, text: string, size: number, y: number, color = rgb(0.1, 0.12, 0.16), maxW = CARD_W - 16) {
  const t = safe(text);
  const s = fit(font, t, size, maxW);
  page.drawText(t, { x: (CARD_W - font.widthOfTextAtSize(t, s)) / 2, y, size: s, font, color });
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function embed(doc: PDFDocument, bytes?: Uint8Array | null, type?: "png" | "jpg"): Promise<PDFImage | null> {
  if (!bytes?.length) return null;
  try {
    const isPng = type ? type === "png" : bytes[0] === 0x89;
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** Draws front and back of one card; returns nothing, adds 2 pages to doc. */
export async function addIdCard(doc: PDFDocument, d: IdCardData) {
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const primary = hex(d.primaryColor);
  const accent = hex(d.accentColor);
  const white = rgb(1, 1, 1);
  const grey = rgb(0.38, 0.42, 0.48);
  const logo = await embed(doc, d.logo, d.logoType);
  const photo = await embed(doc, d.photo, d.photoType);

  // ---------------- FRONT ----------------
  const f = doc.addPage([CARD_W, CARD_H]);
  f.drawRectangle({ x: 0, y: 0, width: CARD_W, height: CARD_H, color: white });
  // header band
  const headH = 44;
  f.drawRectangle({ x: 0, y: CARD_H - headH, width: CARD_W, height: headH, color: logo ? white : primary });
  f.drawRectangle({ x: 0, y: CARD_H - headH - 3, width: CARD_W, height: 3, color: accent });
  if (logo) {
    const s = Math.min((CARD_W - 20) / logo.width, 30 / logo.height);
    const w = logo.width * s, h = logo.height * s;
    f.drawImage(logo, { x: (CARD_W - w) / 2, y: CARD_H - headH + (headH - h) / 2, width: w, height: h });
  } else {
    centered(f, bold, d.company, 10, CARD_H - 27, white);
  }

  // photo
  const pw = 62, ph = 74;
  const px = (CARD_W - pw) / 2, py = CARD_H - headH - 12 - ph;
  f.drawRectangle({ x: px - 2, y: py - 2, width: pw + 4, height: ph + 4, color: primary });
  if (photo) {
    // cover-crop: scale to fill the frame, clip whatever overflows
    const s = Math.max(pw / photo.width, ph / photo.height);
    const w = photo.width * s, h = photo.height * s;
    f.pushOperators(pushGraphicsState(), rectangle(px, py, pw, ph), clip(), endPath());
    f.drawImage(photo, { x: px + (pw - w) / 2, y: py + (ph - h) / 2, width: w, height: h });
    f.pushOperators(popGraphicsState());
  } else {
    f.drawRectangle({ x: px, y: py, width: pw, height: ph, color: rgb(0.93, 0.94, 0.96) });
    centered(f, reg, "PHOTO", 7, py + ph / 2 - 3, grey);
  }

  let y = py - 18;
  const nameText = safe(d.name.toUpperCase());
  const maxNameW = CARD_W - 16;
  if (bold.widthOfTextAtSize(nameText, 8.5) <= maxNameW) {
    centered(f, bold, nameText, 10.5, y);
    y -= 12;
  } else {
    // two lines at a smaller size; anything beyond is shrunk to fit
    const lines = wrap(bold, nameText, 8, maxNameW);
    const first = lines[0];
    const rest = lines.slice(1).join(" ");
    centered(f, bold, first, 8, y + 3);
    centered(f, bold, rest, 8, y - 6);
    y -= 16;
  }
  if (d.designation) { centered(f, reg, d.designation, 7.5, y, grey); y -= 10; }
  if (d.department) { centered(f, reg, d.department, 7, y, grey); y -= 10; }

  // code pill
  y -= 6;
  const code = safe(d.employeeCode);
  const cw = bold.widthOfTextAtSize(code, 8.5) + 16;
  f.drawRectangle({ x: (CARD_W - cw) / 2, y: y - 4, width: cw, height: 14, color: primary });
  centered(f, bold, code, 8.5, y, white);

  // blood group + emergency
  const boxY = 12;
  const boxH = 30;
  f.drawRectangle({ x: 8, y: boxY, width: 36, height: boxH, color: rgb(0.78, 0.1, 0.12) });
  const bg = safe(d.bloodGroup || "-");
  f.drawText("BLOOD", { x: 8 + (36 - reg.widthOfTextAtSize("BLOOD", 5)) / 2, y: boxY + boxH - 9, size: 5, font: reg, color: white });
  const bgs = fit(bold, bg, 11, 32);
  f.drawText(bg, { x: 8 + (36 - bold.widthOfTextAtSize(bg, bgs)) / 2, y: boxY + 7, size: bgs, font: bold, color: white });

  f.drawText("IN EMERGENCY CALL", { x: 50, y: boxY + boxH - 8, size: 5, font: reg, color: grey });
  const en = safe(d.emergencyName || "");
  if (en) f.drawText(en, { x: 50, y: boxY + 12, size: fit(reg, en, 6.5, CARD_W - 58), font: reg, color: rgb(0.1, 0.12, 0.16) });
  const ep = safe(d.emergencyPhone || "-");
  f.drawText(ep, { x: 50, y: boxY + 2, size: fit(bold, ep, 8, CARD_W - 58), font: bold, color: rgb(0.1, 0.12, 0.16) });
  f.drawRectangle({ x: 0, y: 0, width: CARD_W, height: 4, color: primary });

  // ---------------- BACK ----------------
  const b = doc.addPage([CARD_W, CARD_H]);
  b.drawRectangle({ x: 0, y: 0, width: CARD_W, height: CARD_H, color: white });
  b.drawRectangle({ x: 0, y: CARD_H - 6, width: CARD_W, height: 6, color: primary });

  const qrPng = await QRCode.toBuffer(d.verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 360, color: { dark: "#111827", light: "#ffffff" } });
  const qr = await doc.embedPng(qrPng);
  const qs = 92;
  b.drawImage(qr, { x: (CARD_W - qs) / 2, y: CARD_H - 18 - qs, width: qs, height: qs });
  centered(b, reg, "Scan to verify this card", 6, CARD_H - 18 - qs - 10, grey);

  let by = CARD_H - 18 - qs - 28;
  centered(b, bold, d.company, 8, by);
  by -= 10;
  for (const line of wrap(reg, d.companyAddress || "", 6, CARD_W - 20).slice(0, 3)) {
    centered(b, reg, line, 6, by, grey);
    by -= 8;
  }
  if (d.companyPhone) { centered(b, reg, `Ph: ${d.companyPhone}`, 6, by, grey); by -= 8; }

  by -= 4;
  for (const line of wrap(reg, "This card is the property of the company. If found, please return to the address above.", 5.5, CARD_W - 20)) {
    centered(b, reg, line, 5.5, by, grey);
    by -= 7;
  }

  // signature + validity
  b.drawLine({ start: { x: CARD_W - 70, y: 26 }, end: { x: CARD_W - 10, y: 26 }, thickness: 0.5, color: grey });
  const sig = safe(d.signatory || "Authorised Signatory");
  b.drawText(sig, { x: CARD_W - 70, y: 18, size: fit(reg, sig, 5.5, 60), font: reg, color: grey });
  if (d.validUntil) {
    b.drawText("VALID UPTO", { x: 10, y: 26, size: 5, font: reg, color: grey });
    b.drawText(safe(d.validUntil), { x: 10, y: 17, size: 7, font: bold, color: rgb(0.1, 0.12, 0.16) });
  }
  b.drawRectangle({ x: 0, y: 0, width: CARD_W, height: 6, color: accent });
}

export async function buildIdCardsPdf(cards: IdCardData[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(cards.length === 1 ? `ID Card - ${cards[0].name}` : `ID Cards (${cards.length})`);
  doc.setCreator("HRM Suite");
  for (const c of cards) await addIdCard(doc, c);
  return doc.save();
}
