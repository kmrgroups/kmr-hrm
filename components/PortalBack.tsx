"use client";
import { useEffect, useState } from "react";

/** "← KMR Apps": back to the customer's own KMR Apps screen (remembered when they opened the portal). */
export function PortalBack() {
  const [portal, setPortal] = useState<{ slug: string; name?: string } | null>(null);
  useEffect(() => { try { setPortal(JSON.parse(localStorage.getItem("kmr-portal") || "null")); } catch { /* none */ } }, []);
  if (!portal?.slug) return null;
  return (
    <a href={`/it/app/${encodeURIComponent(portal.slug)}`} className="nav" style={{ background: "linear-gradient(90deg, rgba(124,58,237,.35), rgba(219,39,119,.25))", color: "#fff", fontWeight: 700, marginBottom: 8 }}>
      ← {portal.name ? `${portal.name} · ` : ""}KMR Apps
    </a>
  );
}
