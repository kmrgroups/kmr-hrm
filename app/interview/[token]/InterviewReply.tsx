"use client";
import { useState } from "react";
import { p } from "@/lib/base-path";

export function InterviewReply({ token, status }: { token: string; status: string }) {
  const [st, setSt] = useState(status), [ask, setAsk] = useState(false), [note, setNote] = useState(""), [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function send(action: "confirm" | "reschedule") {
    if (action === "reschedule" && note.trim().length < 3) return setMsg({ error: "Tell us which days or times suit you." });
    const res = await fetch(p(`/api/interview/${token}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : { error: "Network problem — please try again." };
    if (res?.ok && j.ok) { setSt(action === "confirm" ? "confirmed" : "reschedule_requested"); setMsg({ ok: j.ok }); setAsk(false); } else setMsg({ error: j.error || "Please try again." });
  }
  return (
    <div className="stack">
      {st === "confirmed" && !msg.ok && <div className="alert ok">You have confirmed. See you then!</div>}
      {st === "reschedule_requested" && !msg.ok && <div className="alert ok">You asked for another time. The company will contact you.</div>}
      <div className="toolbar">
        {st !== "confirmed" && <button className="btn" onClick={() => send("confirm")}>I will attend</button>}
        <button className="btn secondary" onClick={() => setAsk(!ask)}>I need another time</button>
      </div>
      {ask && <div className="stack"><label className="field">Which days or times suit you?<textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Any weekday after 4 pm, or Saturday morning" /></label>
        <div><button className="btn" onClick={() => send("reschedule")}>Send</button></div></div>}
      {msg.ok && <div className="alert ok">{msg.ok}</div>}
      {msg.error && <div className="alert error">{msg.error}</div>}
    </div>
  );
}
