import { p } from "@/lib/base-path";
import { RECO_LABEL, STATUS_LABEL, REQ_STATUS_LABEL } from "@/lib/recruit/service";

/** Tabs across the recruitment screens */
export function RecruitTabs({ active, hr = true }: { active: "home" | "reqs" | "cands" | "interviews" | "offers" | "settings"; hr?: boolean }) {
  const t: [string, string, string, boolean][] = [["home", "Overview", "/app/recruitment", hr], ["reqs", "Requisitions", "/app/recruitment/requisitions", true],
    ["cands", "Candidates", "/app/recruitment/candidates", hr], ["interviews", "Interviews", "/app/recruitment/interviews", true], ["offers", "Offers", "/app/recruitment/offers", hr],
    ["settings", "Settings", "/app/settings/recruitment", hr]];
  return <div className="tabs" style={{ marginBottom: 16 }}>{t.filter((x) => x[3]).map(([k, label, href]) => <a key={k} href={p(href)} className={k === active ? "active" : ""}>{label}</a>)}</div>;
}

export function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="muted">—</span>;
  const c = score >= 70 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--danger)";
  return <span className="scorebar" title={`Match score ${score} of 100`}><i><b style={{ width: `${score}%`, background: c }} /></i><b>{score}</b></span>;
}

export function RecoBadge({ reco }: { reco: string | null | undefined }) {
  if (!reco) return null;
  return <span className={`badge ${reco === "suitable" ? "ok" : reco === "hold" ? "warn" : "danger"}`}>{RECO_LABEL[reco] ?? reco}</span>;
}

export function AppStatus({ status }: { status: string }) {
  const tone: Record<string, string> = { new: "info", shortlisted: "ok", on_hold: "warn", declined: "danger", interview: "info", selected: "ok", offered: "info", joined: "ok", withdrawn: "" };
  return <span className={`badge ${tone[status] ?? ""}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function ReqStatus({ status, published }: { status: string; published?: boolean }) {
  const tone: Record<string, string> = { draft: "", pending: "warn", approved: "info", open: "ok", on_hold: "warn", closed: "", cancelled: "danger" };
  return <span className={`badge ${tone[status] ?? ""}`}>{REQ_STATUS_LABEL[status] ?? status}{status === "open" && published ? " · on careers page" : ""}</span>;
}

export type Opt = { id: string; name: string };
export function MasterSelect({ name, label, list, value, required }: { name: string; label: string; list: Opt[]; value?: string | null; required?: boolean }) {
  return (
    <label className="field">{label}
      <select name={name} defaultValue={value ?? ""} required={required}>
        <option value="">{required ? "Choose…" : "—"}</option>
        {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
