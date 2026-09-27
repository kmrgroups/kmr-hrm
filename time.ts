// Date helpers for attendance. Everything is in India Standard Time (UTC+05:30, no daylight saving),
// independent of the server's own time zone. Dates are "YYYY-MM-DD" strings, times are minutes of the day.

export const IST_OFFSET_MIN = 330;
const DAY_MS = 864e5;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-21" for an instant, in IST */
export function istDate(d: Date | number): string {
  const t = new Date((typeof d === "number" ? d : d.getTime()) + IST_OFFSET_MIN * 6e4);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "09:05" for an instant, in IST */
export function istTime(d: Date | number | string | null | undefined): string {
  if (d === null || d === undefined || d === "") return "—";
  const t = new Date(new Date(d).getTime() + IST_OFFSET_MIN * 6e4);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Instant (ms) of a date + minutes-of-day in IST. Minutes may exceed 1440 (next day). */
export function istInstant(date: string, minutes = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) + (minutes - IST_OFFSET_MIN) * 6e4;
}

/** Today's date in IST */
export function istToday(now: Date = new Date()): string {
  return istDate(now);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inclusive list of dates */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "HH:MM" or "HH:MM:SS" → minutes of the day */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function fromMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 485 → "8h 05m" */
export function fmtDuration(min: number | null | undefined): string {
  if (!min) return "—";
  return `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
}

/** First and last date of a "YYYY-MM" month */
export function monthBounds(month: string): { from: string; to: string; days: string[] } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${y}-${pad(m)}-01`;
  const to = `${y}-${pad(m)}-${pad(last)}`;
  return { from, to, days: dateRange(from, to) };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
