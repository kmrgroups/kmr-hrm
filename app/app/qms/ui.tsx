import { p } from "@/lib/base-path";

export type QmsTab = "ai" | "home" | "skills" | "competency" | "tni" | "plan" | "eff" | "ojt" | "auditors" | "roles" | "kpi" | "pack";

export function QmsTabs({ active, hr = true }: { active: QmsTab; hr?: boolean }) {
  // in the order of the flow: position → R&R → competency mapping → KPI sheets → TNI → calendar → effectiveness
  const t: [QmsTab, string, string, boolean][] = [
    ["home", "Overview", "/app/qms", true], ["roles", "Positions & R&R", "/app/qms/positions", true], ["competency", "Competency mapping", "/app/qms/competency", true],
    ["kpi", "KPI sheets", "/app/qms/kpi", true], ["tni", "Training needs", "/app/qms/needs", true], ["plan", "Training calendar", "/app/qms/training", true],
    ["eff", "Effectiveness", "/app/qms/effectiveness", true], ["skills", "Skill matrix", "/app/qms/skills", true], ["ojt", "On-the-job", "/app/qms/ojt", true],
    ["auditors", "Auditors", "/app/qms/auditors", hr], ["pack", "Audit pack", "/app/qms/audit-pack", hr], ["ai", "AI & review", "/app/qms/ai", hr],
  ];
  return <div className="tabs" style={{ marginBottom: 16 }}>{t.filter((x) => x[3]).map(([k, label, href]) => <a key={k} href={p(href)} className={k === active ? "active" : ""}>{label}</a>)}</div>;
}

/** clause reference shown on every QMS screen, so an auditor sees where each record belongs */
export function Clause({ children }: { children: React.ReactNode }) {
  return <span className="badge info" style={{ fontSize: 11, marginLeft: 8, verticalAlign: "middle" }}>{children}</span>;
}

/** skill level as the usual shop-floor quarter circles: 0 empty … 4 full with a ring (trainer) */
export function LevelPie({ level, size = 22, expired }: { level: number; size?: number; expired?: boolean }) {
  const r = size / 2 - 2, c = size / 2;
  const fill = expired ? "var(--danger)" : level >= 3 ? "var(--ok)" : level > 0 ? "var(--warn)" : "transparent";
  const q = Math.max(0, Math.min(4, level));
  const path = (n: number) => {
    if (n === 0) return "";
    if (n === 4) return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`;
    const a = (n / 4) * 2 * Math.PI, x = c + r * Math.sin(a), y = c - r * Math.cos(a);
    return `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${n > 2 ? 1 : 0} 1 ${x} ${y} Z`;
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Level ${level}${expired ? " (re-certification overdue)" : ""}`} style={{ verticalAlign: "middle" }}>
      <circle cx={c} cy={c} r={r} fill="#fff" stroke="#9aa5b4" strokeWidth={1.2} />
      {q > 0 && <path d={path(q)} fill={fill} />}
      {q === 4 && <circle cx={c} cy={c} r={r * 0.42} fill="#fff" />}
    </svg>
  );
}

export function PriorityBadge({ p: pr }: { p: string }) {
  return <span className={`badge ${pr === "high" ? "danger" : pr === "low" ? "" : "warn"}`}>{pr === "high" ? "High" : pr === "low" ? "Low" : "Normal"}</span>;
}

export const monthLabel = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y!, mm! - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
};

/** marks what the free AI wrote: "AI draft — review" until a person approves it, then who drafted it */
export function AiBadge({ model, draft }: { model: string; draft: boolean }) {
  return <span className={`badge ${draft ? "warn" : ""}`} title={`Drafted by ${model}`} style={{ marginLeft: 6, fontSize: 11 }}>{draft ? "AI draft — review" : "AI-drafted, approved by HR"}</span>;
}
