import { p } from "@/lib/base-path";
import { ActionForm } from "@/components/ActionForm";
import type { Finding } from "@/lib/qms/ai";
import { runQmsAgent } from "./actions";

interface Saved { findings: Finding[]; order: { key: string; why: string }[]; model: string | null; by?: string }

/** the QMS agent on the overview: fixed-rule findings, put in order by the free AI (or by severity) */
export function AgentCard({ findings, saved, runAt, ai }: { findings: Finding[]; saved: Saved | null; runAt: string | null; ai: boolean }) {
  // the live findings, in the order of the last run (new ones at the end, by severity)
  const rank = new Map((saved?.order ?? []).map((o, i) => [o.key, { i, why: o.why }]));
  const list = [...findings].sort((a, b) => (rank.get(a.key)?.i ?? 999) - (rank.get(b.key)?.i ?? 999) || b.severity - a.severity || b.count - a.count);
  const tone = (s: number) => (s === 3 ? "danger" : s === 2 ? "warn" : "");
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>QMS agent — what to work on first</h2>
          <p className="muted" style={{ margin: 0 }}>
            The findings come from fixed rules on your records. {ai ? "The free AI only puts them in order and says why." : "They are in order of severity."}
            {runAt && <> Last run {new Date(runAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}{saved?.by ? ` by ${saved.by}` : ""}{saved?.model ? ` · ranked by ${saved.model}` : ""}.</>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionForm action={runQmsAgent} submitLabel={runAt ? "Run again" : "Run the QMS check"} pendingLabel="Checking…" className="inline" />
          <a className="btn secondary" href={p("/app/qms/ai")}>AI &amp; review</a>
        </div>
      </div>
      {list.length === 0 ? <p style={{ marginBottom: 0 }}><span className="badge ok">Clear</span> Nothing an auditor would raise was found.</p> : (
        <ol style={{ margin: "12px 0 0", paddingLeft: 20 }}>{list.slice(0, 10).map((f) => (
          <li key={f.key} style={{ marginBottom: 6 }}>
            <span className={`badge ${tone(f.severity)}`} style={{ marginRight: 6 }}>{f.clause}</span>
            <a href={p(f.href)}>{f.text}</a>
            {rank.get(f.key)?.why && <div className="muted" style={{ fontSize: 13 }}>{rank.get(f.key)!.why}</div>}
          </li>))}</ol>
      )}
    </div>
  );
}
