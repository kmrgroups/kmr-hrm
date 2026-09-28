"use client";
import { useEffect, useState } from "react";

/** "← <company> · KMR Apps" — the standard back link, placed in the footer bar of every KMR tool (never over the screen). */
export function PortalBack() {
  const [portal, setPortal] = useState<{ slug: string; name?: string } | null>(null);
  useEffect(() => { try { setPortal(JSON.parse(localStorage.getItem("kmr-portal") || "null")); } catch { /* none */ } }, []);
  if (!portal?.slug) return null;
  return <a className="kmr-back-link" href={`/it/app/${encodeURIComponent(portal.slug)}`}>← {portal.name ? `${portal.name} · ` : ""}KMR Apps</a>;
}
