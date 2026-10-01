"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { p } from "@/lib/base-path";

type Row = { name: string; state: "waiting" | "reading" | "done" | "error"; note?: string; score?: number | null; reco?: string | null; appId?: string };
const OK = /\.(pdf|docx?|txt|png|jpe?g)$/i;
const RECO: Record<string, string> = { suitable: "Suitable", hold: "Maybe", not_suitable: "Not suitable" };

/** Many resumes at once — pick several files, or one ZIP with up to 500 resumes. Each is read and scored on the server. */
export function ResumeUploader({ requisitionId }: { requisitionId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function expand(list: FileList): Promise<File[]> {
    const out: File[] = [];
    for (const f of Array.from(list)) {
      if (/\.zip$/i.test(f.name)) {
        const { unzipSync } = await import("fflate");
        const files = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (x) => OK.test(x.name) && !x.name.startsWith("__MACOSX") && !/(^|\/)\./.test(x.name) });
        for (const [name, bytes] of Object.entries(files)) out.push(new File([bytes as BlobPart], name.split("/").pop()!));
      } else if (OK.test(f.name)) out.push(f);
    }
    return out.slice(0, 500);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setBusy(true);
    const files = await expand(e.target.files);
    e.target.value = "";
    const list: Row[] = files.map((f) => ({ name: f.name, state: "waiting" }));
    setRows(list);
    for (let i = 0; i < files.length; i++) {
      list[i] = { ...list[i], state: "reading" }; setRows([...list]);
      try {
        const fd = new FormData(); fd.set("file", files[i]); fd.set("requisition_id", requisitionId);
        const res = await fetch(p("/api/recruitment/resumes"), { method: "POST", body: fd });
        const j = await res.json().catch(() => ({ error: "The server did not answer." }));
        if (!res.ok || j.error) list[i] = { ...list[i], state: "error", note: j.error || `Error ${res.status}` };
        else list[i] = { ...list[i], state: "done", score: j.score, reco: j.recommendation, appId: j.applicationId,
          note: [j.name, j.duplicate ? (j.already ? "already in this list — resume updated" : "known candidate — merged") : null, j.status === "scanned" ? "scanned: no text inside, please type the details" : j.status === "failed" ? "could not read the text" : null].filter(Boolean).join(" · ") };
      } catch { list[i] = { ...list[i], state: "error", note: "Network problem — try this file again." }; }
      setRows([...list]);
    }
    setBusy(false);
    router.refresh();
  }

  const done = rows.filter((r) => r.state === "done").length, bad = rows.filter((r) => r.state === "error").length;
  return (
    <div className="stack">
      <label className="btn" style={{ alignSelf: "flex-start", cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Reading resumes…" : "Upload resumes"}
        <input type="file" multiple hidden disabled={busy} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.zip" onChange={onPick} />
      </label>
      <span className="help">PDF, Word, text or photos — pick many at once, or a ZIP (up to 500). Each resume is read, merged with the same person if already known, and scored against the JD.</span>
      {rows.length > 0 && (
        <div className="tablewrap"><table>
          <thead><tr><th>File</th><th>Result</th><th className="num">Score</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>
            <td className="mono" style={{ fontSize: 12.5 }}>{r.name}</td>
            <td>{r.state === "waiting" ? <span className="muted">waiting</span> : r.state === "reading" ? <span className="badge info">reading…</span>
              : r.state === "error" ? <span className="badge danger">{r.note}</span>
              : <span>{r.reco ? <span className={`badge ${r.reco === "suitable" ? "ok" : r.reco === "hold" ? "warn" : "danger"}`}>{RECO[r.reco]}</span> : null} {r.note}</span>}</td>
            <td className="num">{r.state === "done" ? (r.appId ? <a href={p(`/app/recruitment/candidates/${r.appId}`)}><b>{r.score ?? "—"}</b></a> : r.score) : ""}</td>
          </tr>)}</tbody>
        </table></div>
      )}
      {!busy && rows.length > 0 && <div className="alert ok">{done} read and scored{bad ? `, ${bad} could not be read` : ""}. The list below is updated.</div>}
    </div>
  );
}
