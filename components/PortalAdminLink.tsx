"use client";
import { useEffect, useState } from "react";

/** Link to the customer's KMR Apps › Administration (company details, logo, users for all apps) */
export function PortalAdminLink({ label = "Open KMR Apps › Administration" }: { label?: string }) {
  const [href, setHref] = useState("/it/apps.html");
  useEffect(() => { try { const p = JSON.parse(localStorage.getItem("kmr-portal") || "null"); if (p?.slug) setHref(`/it/app/${encodeURIComponent(p.slug)}#admin`); } catch { /* default */ } }, []);
  return <a className="btn" href={href}>{label}</a>;
}
