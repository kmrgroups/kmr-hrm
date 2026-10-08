"use client";
import { useState } from "react";
import type { Layout } from "@/lib/org/layout";

/** The chart as one SVG. "Fit to screen" shrinks it evenly (same factor across and down) to whatever space is available, so a big company still shows on one screen. */
export function ChartView({ layout, colors, logo, title, docNo, rev, draft }: {
  layout: Layout; colors: Record<string, string>; logo: string | null; title: string; docNo: string; rev: string; draft: boolean;
}) {
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const { width, height } = layout;
  const empty = layout.nodes.length === 0;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)", flexWrap: "wrap" }}>
        {logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logo} alt="" style={{ maxHeight: 44, maxWidth: 150, objectFit: "contain" }} /> : null}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div className="help" style={{ margin: 0 }}>{docNo} · Rev {rev} · {draft ? "DRAFT - not yet issued" : "Issued"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className={`btn small ${fit ? "" : "ghost"}`} onClick={() => { setFit(true); setZoom(1); }}>Fit to screen</button>
          <button type="button" className={`btn small ${fit ? "ghost" : ""}`} onClick={() => setFit(false)}>Actual size</button>
          {!fit && <>
            <button type="button" className="btn ghost small" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.2).toFixed(2)))}>−</button>
            <button type="button" className="btn ghost small" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}>+</button>
          </>}
        </div>
      </div>
      {empty ? <p className="help" style={{ padding: 24 }}>No one is on the chart yet. Add employees (with a reporting manager) or use Direct entry.</p> : (
        <div style={{ height: fit ? "calc(100vh - 330px)" : undefined, minHeight: 340, maxHeight: fit ? undefined : "calc(100vh - 330px)", overflow: fit ? "hidden" : "auto", background: "#fff" }}>
          <svg
            viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={title}
            style={fit ? { width: "100%", height: "100%", display: "block" } : { width: width * zoom, height: height * zoom, display: "block" }}
          >
            {layout.edges.map((e, i) => <polyline key={i} points={e.map((q) => q.join(",")).join(" ")} fill="none" stroke="#7a8494" strokeWidth={1.2} />)}
            {layout.nodes.map((n) => {
              const dashed = n.kind !== "person";
              const col = colors[n.group] ?? "#9aa3b2";
              const cut = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + "…" : t);
              return (
                <g key={n.key}>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} fill={n.kind === "vacant" ? "#fff8e1" : n.kind === "external" ? "#f1f3f5" : "#fff"}
                    stroke={n.kind === "vacant" ? "#c98a1a" : "#9aa3b2"} strokeWidth={1} strokeDasharray={dashed ? "4 3" : undefined} />
                  <rect x={n.x} y={n.y} width={5} height={n.h} fill={col} />
                  <text x={n.x + 11} y={n.y + 18} fontSize={12} fontWeight={700} fill="#1b1f27">{cut(n.title, 24)}</text>
                  {n.subtitle && <text x={n.x + 11} y={n.y + 33} fontSize={10} fill="#1b1f27">{cut(n.subtitle, 30)}</text>}
                  {n.line3 && <text x={n.x + 11} y={n.y + 48} fontSize={9} fill={n.kind === "vacant" ? "#a86400" : "#677084"}>{cut(n.line3, 34)}</text>}
                  <title>{[n.title, n.subtitle, n.line3].filter(Boolean).join(" · ")}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {Object.keys(colors).length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 12 }}>
          {Object.entries(colors).map(([n, c]) => <span key={n}><span style={{ display: "inline-block", width: 10, height: 10, background: c, marginRight: 5, borderRadius: 2 }} />{n}</span>)}
        </div>
      )}
    </div>
  );
}
