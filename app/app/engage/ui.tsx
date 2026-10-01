import { p } from "@/lib/base-path";

export type EngageTab = "home" | "ann" | "rec" | "sug" | "sur";

export function EngageTabs({ active, hr = true }: { active: EngageTab; hr?: boolean }) {
  const t: [EngageTab, string, string, boolean][] = [
    ["home", "Overview", "/app/engage", true], ["ann", "Announcements", "/app/engage/announcements", hr], ["rec", "Recognition", "/app/engage/recognition", true],
    ["sug", "Suggestions / Kaizen", "/app/engage/suggestions", true], ["sur", "Surveys", "/app/engage/surveys", hr],
  ];
  return <div className="tabs" style={{ marginBottom: 16 }}>{t.filter((x) => x[3]).map(([k, label, href]) => <a key={k} href={p(href)} className={k === active ? "active" : ""}>{label}</a>)}</div>;
}

/** a small horizontal bar for a share (0–100) */
export function Bar({ pct, tone = "brand" }: { pct: number; tone?: "brand" | "ok" | "warn" | "danger" }) {
  const c = tone === "brand" ? "var(--brand)" : `var(--${tone})`;
  return <span style={{ display: "inline-block", width: 120, height: 8, background: "var(--border)", borderRadius: 4, verticalAlign: "middle", overflow: "hidden" }}>
    <span style={{ display: "block", width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: c }} /></span>;
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const when = (t: string | null | undefined) => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
export const dayLabel = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
export const monthName = (m: string | null | undefined) => {
  if (!m) return "";
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y!, mm! - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};
