"use client";
import { useState } from "react";
import { p } from "@/lib/base-path";

export function OfferReply({ token, name }: { token: string; name: string }) {
  const [mode, setMode] = useState<"" | "accept" | "decline">(""), [typed, setTyped] = useState(""), [reason, setReason] = useState(""), [agree, setAgree] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; done?: string; error?: string }>({});
  async function send() {
    if (mode === "accept" && (typed.trim().toLowerCase() !== name.trim().toLowerCase() || !agree)) return setState({ error: `Type your name exactly as “${name}” and tick the box.` });
    setState({ busy: true });
    const res = await fetch(p(`/api/offer/${token}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: mode, name: typed, reason }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : { error: "Network problem — please try again." };
    setState(res?.ok && j.ok ? { done: j.ok } : { error: j.error || "Please try again." });
  }
  if (state.done) return <div className="alert ok">{state.done}</div>;
  return (
    <div className="stack">
      <div className="toolbar"><button className="btn" onClick={() => setMode("accept")}>Accept the offer</button><button className="btn secondary" onClick={() => setMode("decline")}>Decline</button></div>
      {mode === "accept" && <div className="stack">
        <label className="field">Type your full name to sign<input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="name" /></label>
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read the offer letter and accept the offer on its terms.</label>
        <div><button className="btn" disabled={state.busy} onClick={send}>{state.busy ? "Please wait…" : "Sign and accept"}</button></div></div>}
      {mode === "decline" && <div className="stack">
        <label className="field">May we know why? (optional)<textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div><button className="btn danger" disabled={state.busy} onClick={send}>{state.busy ? "Please wait…" : "Decline the offer"}</button></div></div>}
      {state.error && <div className="alert error">{state.error}</div>}
    </div>
  );
}
