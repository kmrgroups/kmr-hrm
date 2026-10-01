// Safety arithmetic — incident figures (IS 3786 style, per million man-hours), PPE and medical due dates. Pure, tested.

export const KINDS: Record<string, string> = {
  near_miss: "Near miss", unsafe_act: "Unsafe act", unsafe_condition: "Unsafe condition", first_aid: "First aid", injury: "Injury (medical treatment)",
  lost_time: "Lost-time injury", property_damage: "Property damage", fire: "Fire", environment: "Environment (spill, emission)", dangerous_occurrence: "Dangerous occurrence",
};
/** what an employee can report from his portal */
export const EMPLOYEE_KINDS = ["near_miss", "unsafe_act", "unsafe_condition"];
export const INJURY_KINDS = ["first_aid", "injury", "lost_time"];
export const STATUS: Record<string, string> = { reported: "Reported", investigating: "Investigating", action: "Actions open", closed: "Closed" };
export const POTENTIAL = ["", "Minor", "Moderate", "Serious", "Major", "Could have been fatal"];

const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
export function daysBetween(a: string, b: string): number { return Math.round((day(b) - day(a)) / 864e5); }
export function addMonthsIso(d: string, m: number): string {
  const y = Number(d.slice(0, 4)), mo = Number(d.slice(5, 7)) - 1 + m, dd = Number(d.slice(8, 10));
  const ny = y + Math.floor(mo / 12), nm = (mo % 12) + 1, last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`;
}

/** frequency rate: lost-time injuries per million man-hours worked */
export const ltifr = (lti: number, manHours: number) => (manHours > 0 ? Math.round(((lti * 1e6) / manHours) * 100) / 100 : null);
/** severity rate: man-days lost per million man-hours worked */
export const severityRate = (daysLost: number, manHours: number) => (manHours > 0 ? Math.round(((daysLost * 1e6) / manHours) * 10) / 10 : null);

/** days since the last lost-time injury (null when there has been none on record) */
export function daysSinceLti(incidents: { kind: string; occurred_at: string }[], today: string): number | null {
  const lti = incidents.filter((i) => i.kind === "lost_time").map((i) => i.occurred_at.slice(0, 10)).sort().pop();
  return lti ? daysBetween(lti, today) : null;
}

/** the safety pyramid: near misses + unsafe acts / conditions reported for each injury — more reporting is good */
export function pyramid(incidents: { kind: string }[]) {
  const c = (k: string[]) => incidents.filter((i) => k.includes(i.kind)).length;
  const lti = c(["lost_time"]), inj = c(["injury"]), fa = c(["first_aid"]), nm = c(["near_miss"]), ua = c(["unsafe_act", "unsafe_condition"]);
  const injuries = lti + inj + fa;
  return { lti, injury: inj, firstAid: fa, nearMiss: nm, unsafe: ua, ratio: injuries ? Math.round(((nm + ua) / injuries) * 10) / 10 : null };
}

/** an incident may be closed when the cause is known and every action is done */
export function canClose(inc: { kind: string; root_cause: string | null }, actions: { status: string }[]): string | null {
  if (!inc.root_cause?.trim()) return "Write the root cause first.";
  if (actions.some((a) => a.status !== "done")) return "Close every action first.";
  if (!["unsafe_act", "unsafe_condition", "near_miss"].includes(inc.kind) && !actions.length) return "Add at least one action so it does not happen again.";
  return null;
}

export type PpeState = "ok" | "due_soon" | "overdue" | "never";
export interface PpeItem { id: string; name: string; life_months: number; departments: string[]; for_all?: boolean; active: boolean }
export interface PpeIssue { employee_id: string; item_id: string; issued_on: string; next_due: string }
/** for one person: each PPE item his department needs, and whether it is in date */
export function ppeFor(person: { id: string; department_id: string | null }, items: PpeItem[], issues: PpeIssue[], today: string, soonDays = 15) {
  return items.filter((it) => it.active && (it.for_all || (person.department_id && it.departments.includes(person.department_id)))).map((it) => {
    const last = issues.filter((x) => x.employee_id === person.id && x.item_id === it.id).sort((a, b) => b.issued_on.localeCompare(a.issued_on))[0];
    const state: PpeState = !last ? "never" : last.next_due < today ? "overdue" : daysBetween(today, last.next_due) <= soonDays ? "due_soon" : "ok";
    return { item: it, last: last ?? null, state };
  });
}

export function dueState(next: string | null, today: string, soonDays = 30): "none" | "overdue" | "due_soon" | "ok" {
  if (!next) return "none";
  if (next < today) return "overdue";
  return daysBetween(today, next) <= soonDays ? "due_soon" : "ok";
}
