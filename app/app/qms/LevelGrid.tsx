"use client";
import { startTransition, useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/app/app/employees/actions";

export interface GridCol { id: string; label: string; sub?: string; required?: number | null; flag?: string | null }
export interface GridRow { id: string; label: string; sub?: string }

/**
 * People × skills (or competencies) grid. Tap a cell to step its level 0 → 4 (→ 0); changed cells are highlighted
 * and saved together. A cell below the column's required level is marked as a gap.
 */
export function LevelGrid({ rows, cols, values, expired, kind, action, readOnly, labels }: {
  rows: GridRow[]; cols: GridCol[]; values: Record<string, number>; expired?: Record<string, boolean>;
  kind: "skill" | "competency"; action: (s: ActionState, f: FormData) => Promise<ActionState>; readOnly?: boolean; labels: string[];
}) {
  const [v, setV] = useState<Record<string, number>>(values);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const changed = useMemo(() => Object.keys(v).filter((k) => (v[k] ?? 0) !== (values[k] ?? 0)), [v, values]);
  const step = (k: string) => { if (!readOnly) setV((o) => ({ ...o, [k]: ((o[k] ?? 0) + 1) % 5 })); };
  const save = () => {
    const f = new FormData();
    f.set("kind", kind);
    f.set("changes", JSON.stringify(changed.map((k) => { const [row, col] = k.split("|"); return { row, col, level: v[k] ?? 0 }; })));
    startTransition(() => formAction(f));
  };
  const tone = (l: number, req?: number | null) => (req != null && l < req ? "gap" : l >= 3 ? "q" : l > 0 ? "t" : "");
  return (
    <div>
      <div className="tablewrap levelgrid">
        <table>
          <thead><tr><th style={{ minWidth: 170 }}>Person</th>{cols.map((c) => (
            <th key={c.id} className="lvlhead" title={c.sub}><span>{c.label}</span>{c.required != null && <small>needs {c.required}</small>}{c.flag && <small className="flag">{c.flag}</small>}</th>))}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><b>{r.label}</b>{r.sub && <div className="muted" style={{ fontSize: 12 }}>{r.sub}</div>}</td>
              {cols.map((c) => {
                const k = `${r.id}|${c.id}`, l = v[k] ?? 0, ex = !!expired?.[k] && l === (values[k] ?? 0);
                return (
                  <td key={c.id} className={`lvl ${tone(l, c.required)}${changed.includes(k) ? " changed" : ""}`}>
                    <button type="button" disabled={readOnly} onClick={() => step(k)} title={`${r.label} — ${c.label}: ${labels[l]}${ex ? " (re-certification overdue)" : ""}`}>
                      <Pie level={l} expired={ex} />
                    </button>
                  </td>);
              })}
            </tr>))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn" disabled={pending || !changed.length} onClick={save}>{pending ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length > 1 ? "s" : ""}` : "Tap a circle to change a level"}</button>
          {changed.length > 0 && <button type="button" className="btn secondary" onClick={() => setV(values)}>Undo</button>}
          {state.error && <span className="alert error">{state.error}</span>}
          {state.ok && !changed.length && <span className="alert ok">{state.ok}</span>}
        </div>
      )}
    </div>
  );
}

function Pie({ level, expired }: { level: number; expired?: boolean }) {
  const size = 24, r = 10, c = 12;
  const fill = expired ? "var(--danger)" : level >= 3 ? "var(--ok)" : level > 0 ? "var(--warn)" : "transparent";
  const d = (n: number) => {
    if (n >= 4) return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`;
    const a = (n / 4) * 2 * Math.PI;
    return `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${n > 2 ? 1 : 0} 1 ${c + r * Math.sin(a)} ${c - r * Math.cos(a)} Z`;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="#fff" stroke="#9aa5b4" strokeWidth={1.2} />
      {level > 0 && <path d={d(level)} fill={fill} />}
      {level === 4 && <circle cx={c} cy={c} r={4.2} fill="#fff" />}
    </svg>
  );
}
