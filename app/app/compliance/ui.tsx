import { p } from "@/lib/base-path";

export type CompTab = "home" | "docs" | "reg" | "items";

export function CompTabs({ active, hr = true }: { active: CompTab; hr?: boolean }) {
  const t: [CompTab, string, string, boolean][] = [
    ["home", "Overview", "/app/compliance", true], ["docs", "Documents & policies", "/app/compliance/documents", hr],
    ["reg", "Compliance register", "/app/compliance/register", true], ["items", "What we must comply with", "/app/compliance/items", hr],
  ];
  return <div className="tabs" style={{ marginBottom: 16 }}>{t.filter((x) => x[3]).map(([k, label, href]) => <a key={k} href={p(href)} className={k === active ? "active" : ""}>{label}</a>)}</div>;
}

export const dmy = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
