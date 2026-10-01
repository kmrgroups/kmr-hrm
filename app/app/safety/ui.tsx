import { p } from "@/lib/base-path";

export type SafeTab = "home" | "inc" | "ppe" | "med";
export function SafetyTabs({ active, hr = true }: { active: SafeTab; hr?: boolean }) {
  const t: [SafeTab, string, string, boolean][] = [["home", "Overview", "/app/safety", true], ["inc", "Incidents & near misses", "/app/safety/incidents", true],
    ["ppe", "PPE", "/app/safety/ppe", true], ["med", "Medical examinations", "/app/safety/medical", hr]];
  return <div className="tabs" style={{ marginBottom: 16 }}>{t.filter((x) => x[3]).map(([k, label, href]) => <a key={k} href={p(href)} className={k === active ? "active" : ""}>{label}</a>)}</div>;
}
export const dmy = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
export const dmyt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
export const KIND_TONE: Record<string, string> = { near_miss: "info", unsafe_act: "warn", unsafe_condition: "warn", first_aid: "warn", injury: "danger", lost_time: "danger", property_damage: "", fire: "danger", environment: "warn", dangerous_occurrence: "danger" };
