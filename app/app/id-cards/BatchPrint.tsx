"use client";
import { p } from "@/lib/base-path";
import { useState } from "react";
import { Icon } from "@/components/Icon";

interface Row { id: string; code: string; name: string; dept: string; issued: string; validUntil: string; version: number }

export function BatchPrint({ rows }: { rows: Row[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const all = sel.size === rows.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const href = p(`/api/id-cards?ids=${[...sel].join(",")}`);
  return (
    <>
      <div className="toolbar">
        <a className={`btn${sel.size ? "" : " secondary"}`} href={sel.size ? href : undefined} target="_blank" aria-disabled={!sel.size}
          onClick={(e) => { if (!sel.size) e.preventDefault(); }}>
          <Icon name="download" /> Download {sel.size || ""} card{sel.size === 1 ? "" : "s"} (PDF)
        </a>
        <small>{sel.size > 200 ? "Up to 200 cards per file." : ""}</small>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th style={{ width: 36 }}><input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th>
            <th>Code</th><th>Name</th><th>Department</th><th>Issued</th><th>Valid upto</th><th className="num">Version</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => toggle(r.id)} style={{ cursor: "pointer" }}>
                <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.name}`} /></td>
                <td className="mono">{r.code}</td>
                <td><a href={p(`/app/employees/${r.id}`)} onClick={(e) => e.stopPropagation()}>{r.name}</a></td>
                <td>{r.dept}</td><td>{r.issued}</td><td>{r.validUntil}</td><td className="num">{r.version || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
