"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/app/employees/actions";

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector } }

/**
 * Attendance by scanning each person's ID card (its QR holds the card-verification link) with the phone or laptop
 * camera — the browser's own barcode reader, nothing to install. Typing the employee code works everywhere.
 */
export function ScanCard({ sessionId, action }: { sessionId: string; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef<{ v: string; t: number }>({ v: "", t: 0 });
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSupported(typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia), []);
  useEffect(() => { if (state.ok || state.error) setLog((l) => [(state.ok ?? `⚠ ${state.error}`), ...l].slice(0, 8)); }, [state]);

  const send = (code: string) => {
    const f = new FormData(); f.set("session_id", sessionId); f.set("code", code);
    startTransition(() => formAction(f));
  };

  useEffect(() => {
    if (!on || !window.BarcodeDetector) return;
    let stream: MediaStream | null = null, stop = false;
    const det = new window.BarcodeDetector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const found = await det.detect(video.current);
            const v = found[0]?.rawValue;
            if (v && (v !== last.current.v || Date.now() - last.current.t > 4000)) { last.current = { v, t: Date.now() }; navigator.vibrate?.(60); send(v); }
          } catch { /* frame not ready */ }
          setTimeout(tick, 350);
        };
        tick();
      } catch { setLog((l) => ["⚠ Camera not allowed — type the employee codes instead.", ...l]); setOn(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      {supported && (on
        ? <><video ref={video} muted playsInline style={{ width: "100%", maxWidth: 360, borderRadius: 10, background: "#000" }} />
            <button type="button" className="btn secondary small" onClick={() => setOn(false)}>Stop the camera</button></>
        : <button type="button" className="btn" onClick={() => setOn(true)}>Scan ID cards with the camera</button>)}
      {supported === false && <p className="muted" style={{ margin: 0, fontSize: 13 }}>This browser cannot read QR codes; type the employee code (Chrome on Android can scan).</p>}
      <form onSubmit={(e) => { e.preventDefault(); const v = codeRef.current?.value.trim(); if (v) { send(v); codeRef.current!.value = ""; } }} style={{ display: "flex", gap: 8 }}>
        <input ref={codeRef} placeholder="Employee code, e.g. KMR-0042" aria-label="Employee code" style={{ flex: 1 }} />
        <button className="btn secondary" disabled={pending}>Mark present</button>
      </form>
      {log.length > 0 && <ul className="scanlog">{log.map((l, i) => <li key={i} className={l.startsWith("⚠") ? "bad" : ""}>{l}</li>)}</ul>}
    </div>
  );
}
