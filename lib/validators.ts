// Indian identity and bank field validation, shared by the browser form and the server.

// Verhoeff checksum tables (used by UIDAI for the Aadhaar check digit)
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(num: string): boolean {
  let c = 0;
  const digits = num.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}

export function cleanDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** 12 digits, does not start with 0 or 1, valid Verhoeff check digit */
export function isValidAadhaar(s: string): boolean {
  const d = cleanDigits(s);
  return /^[2-9][0-9]{11}$/.test(d) && verhoeffValid(d);
}

export function maskAadhaar(s: string): string {
  const d = cleanDigits(s);
  return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : "";
}

/** ABCDE1234F — 4th character is the holder type (P = individual) */
export function isValidPan(s: string): boolean {
  return /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/.test((s || "").toUpperCase().trim());
}

/** 4 letters, 0, then 6 alphanumerics */
export function isValidIfsc(s: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test((s || "").toUpperCase().trim());
}

export function isValidAccountNumber(s: string): boolean {
  return /^[0-9]{9,18}$/.test((s || "").replace(/\s/g, ""));
}

/** UAN is 12 digits */
export function isValidUan(s: string): boolean {
  return /^[0-9]{12}$/.test(cleanDigits(s));
}

/** Indian mobile: 10 digits starting 6-9, optional +91 / 0 prefix */
export function normalizeIndianMobile(s: string): string | null {
  let d = cleanDigits(s);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? d : null;
}

/** E.164 without "+", as the WhatsApp Cloud API expects (e.g. 919876543210) */
export function toWhatsAppNumber(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = normalizeIndianMobile(s);
  if (m) return "91" + m;
  const d = cleanDigits(s);
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((s || "").trim());
}

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
