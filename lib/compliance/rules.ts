// Compliance register and document control — the arithmetic (pure, tested). Due dates come from fixed rules;
// nothing here guesses.

export interface Item {
  id: string; code: string; kind: string; frequency: string; due_months: number[]; due_day: number;
  valid_until: string | null; renew_days: number; remind_days: number; start_on: string; active: boolean;
}
export interface Task { due_on: string; status: string; done_on: string | null }

export const KINDS: Record<string, string> = { payment: "Payment", return: "Return / filing", register: "Register", licence: "Licence / renewal", notice: "Notice to employees", report: "Report", other: "Other" };
export const FREQS: Record<string, string> = { monthly: "Every month", quarterly: "Quarterly", half_yearly: "Twice a year", yearly: "Once a year", once: "Once (licence renewal)" };
export const DOC_KINDS: Record<string, string> = { policy: "Policy", procedure: "Procedure", work_instruction: "Work instruction", format: "Format / form", manual: "Manual", other: "Other" };
export const DOC_PREFIX: Record<string, string> = { policy: "POL", procedure: "P", work_instruction: "WI", format: "F", manual: "M", other: "D" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m: 1–12
export function addDaysIso(d: string, n: number): string { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string): number { return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 864e5); }

/** the due dates of an item between from and to (inclusive), never before the item's start date */
export function dueDates(it: Item, from: string, to: string): string[] {
  if (!it.active) return [];
  const start = from > it.start_on ? from : it.start_on;
  if (it.frequency === "once") {
    if (!it.valid_until) return [];
    const d = addDaysIso(it.valid_until, -it.renew_days);
    return d <= to ? [d] : [];                         // a renewal stays due until it is done, however late
  }
  const months = it.frequency === "monthly" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : it.due_months;
  const out: string[] = [];
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  const endY = Number(to.slice(0, 4)), endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    if (months.includes(m)) {
      const d = `${y}-${pad(m)}-${pad(Math.min(it.due_day, lastDay(y, m)))}`;
      if (d >= start && d <= to) out.push(d);
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** what the occurrence is for: monthly payments are for the month before; the rest by their due date */
export function periodLabel(it: Pick<Item, "frequency" | "kind">, due: string): string {
  const y = Number(due.slice(0, 4)), m = Number(due.slice(5, 7));
  if (it.frequency === "monthly") { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return `${MONTHS[pm - 1]} ${py}`; }
  if (it.frequency === "once") return "Renewal";
  return `due ${MONTHS[m - 1]} ${y}`;
}

export type TaskState = "done" | "done_late" | "not_applicable" | "overdue" | "due_soon" | "upcoming";
export function taskState(t: Task, today: string, remindDays = 7): TaskState {
  if (t.status === "not_applicable") return "not_applicable";
  if (t.status === "done") return t.done_on && t.done_on > t.due_on ? "done_late" : "done";
  if (t.due_on < today) return "overdue";
  return daysBetween(today, t.due_on) <= remindDays ? "due_soon" : "upcoming";
}
export const STATE_LABEL: Record<TaskState, string> = { done: "Done on time", done_late: "Done late", not_applicable: "Not applicable", overdue: "Overdue", due_soon: "Due soon", upcoming: "Upcoming" };
export const STATE_TONE: Record<TaskState, string> = { done: "ok", done_late: "warn", not_applicable: "", overdue: "danger", due_soon: "warn", upcoming: "info" };

/** on-time rate of the occurrences that fell due in the period (not-applicable ones left out); null when none */
export function onTimeRate(tasks: Task[], today: string): number | null {
  const due = tasks.filter((t) => t.status !== "not_applicable" && t.due_on < today);
  if (!due.length) return null;
  return Math.round((due.filter((t) => t.status === "done" && (!t.done_on || t.done_on <= t.due_on)).length / due.length) * 100);
}

/** next document number for a kind: <prefix>-<kind>-<nn> (e.g. HR-POL-04) */
export function nextDocNo(existing: string[], kind: string, prefix = "HR"): string {
  const k = DOC_PREFIX[kind] ?? "D", head = `${prefix}-${k}-`;
  const n = existing.filter((x) => x.startsWith(head)).map((x) => Number(x.slice(head.length))).filter((x) => Number.isFinite(x));
  return `${head}${pad((n.length ? Math.max(...n) : 0) + 1)}`;
}

/** review due: effective date + review months (end-of-month safe) */
export function reviewDue(effective: string, months: number): string {
  const y = Number(effective.slice(0, 4)), m = Number(effective.slice(5, 7)) - 1 + months, d = Number(effective.slice(8, 10));
  const ny = y + Math.floor(m / 12), nm = (m % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDay(ny, nm)))}`;
}
