"use client";
import { useEffect, useState } from "react";
import { CopyLink } from "./ActionForm";
import { clearFlash } from "./flash-actions";

export function Flash({ msg }: { msg: { ok?: string; error?: string; link?: string } | null }) {
  const [shown, setShown] = useState(msg);
  useEffect(() => {
    // Clearing the cookie re-renders the page with msg = null; keep showing the last message.
    if (msg) {
      setShown(msg);
      clearFlash();
    }
  }, [msg]);
  if (!shown) return null;
  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      {shown.error && <div className="alert error" role="alert">{shown.error}</div>}
      {shown.ok && <div className="alert ok" role="status">{shown.ok}</div>}
      {shown.link && <CopyLink link={shown.link} />}
    </div>
  );
}
