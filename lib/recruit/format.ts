// Display helpers for recruitment (India: times in IST, money in lakhs).

/** "2026-10-05T10:30" typed in a date-time box, in Indian time → the moment it means */
export function fromLocal(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** the moment → "2026-10-05T10:30" for a date-time box (IST) */
export function toLocal(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  return d.toISOString().slice(0, 16);
}
/** "Mon, 5 Oct 2026, 10:30 am" (IST) */
export function fmtWhen(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
export const modeLabel = (m: string) => ({ in_person: "In person", video: "Video call", phone: "Phone call" } as Record<string, string>)[m] ?? m;
/** 650000 → "6.5 L" */
export const lakh = (n: number | null | undefined) => (n == null ? "—" : `${(n / 1e5).toFixed(n % 1e5 === 0 ? 0 : n % 1e4 === 0 ? 1 : 2)} L`);
export const RECO_CLASS: Record<string, string> = { suitable: "ok", hold: "warn", not_suitable: "bad" };
