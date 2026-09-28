"use client";
import { useEffect, useState } from "react";

/** The standard "← KMR Apps" button (same look in every KMR tool): back to the customer's KMR Apps page. */
export function PortalBack() {
  const [portal, setPortal] = useState<{ slug: string; name?: string } | null>(null);
  useEffect(() => { try { setPortal(JSON.parse(localStorage.getItem("kmr-portal") || "null")); } catch { /* none */ } }, []);
  if (!portal?.slug) return null;
  return (
    <a href={`/it/app/${encodeURIComponent(portal.slug)}`} style={{ position: "fixed", left: 14, bottom: 56, zIndex: 50, display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 999, background: "linear-gradient(90deg,#7C3AED,#DB2777)", color: "#fff", font: '700 13.5px "Segoe UI", Arial, sans-serif', textDecoration: "none", boxShadow: "0 10px 26px -8px rgba(124,58,237,.6)" }}>
      ← {portal.name ? `${portal.name} · ` : ""}KMR Apps
    </a>
  );
}
