"use client";
import { useEffect, useState } from "react";
import { p } from "@/lib/base-path";

/**
 * One login for every KMR app: the HRM has no login form of its own. It takes over the KMR Apps sign-in
 * (same Supabase session, stored by the portal on www.kmr-groups.com), or sends the person to their KMR Apps
 * page to sign in and brings them back.
 */
export function SsoBridge({ co, next, failed, signedOut }: { co: string; next: string; failed: string; signedOut: boolean }) {
  const [msg, setMsg] = useState("Signing you in…");
  useEffect(() => {
    let portal: { slug?: string } | null = null;
    try { portal = JSON.parse(localStorage.getItem("kmr-portal") || "null"); } catch { /* none */ }
    const home = portal?.slug ? `/it/app/${encodeURIComponent(portal.slug)}` : "/it/apps.html";
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) || "").filter((k) => /^sb-.+-auth-token$/.test(k));
    if (signedOut) { keys.forEach((k) => localStorage.removeItem(k)); location.replace(home); return; }
    if (failed) {
      setMsg(failed === "company" ? "This login belongs to a different company." : failed === "access" ? "Your login has not been added to the HRM yet — please ask your company's administrator." : "We couldn't sign you in automatically.");
      return;
    }
    let session: { access_token?: string; refresh_token?: string } | null = null;
    for (const k of keys) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); session = v?.currentSession ?? v; if (session?.refresh_token) break; } catch { /* skip */ } }
    if (!session?.refresh_token) { location.replace(`${home}?open=hrm`); return; }
    const f = document.createElement("form"); f.method = "POST"; f.action = p("/api/auth/handoff");
    Object.entries({ access_token: session.access_token || "", refresh_token: session.refresh_token, co, next }).forEach(([k, v]) => {
      const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v || ""; f.append(i);
    });
    document.body.append(f); f.submit();
  }, [co, next, failed, signedOut]);
  return (
    <div className="fz-form" style={{ textAlign: "center" }}>
      {!failed && <div className="spinner" style={{ width: 38, height: 38, borderRadius: "50%", border: "3px solid #e3e8ef", borderTopColor: "#7c3aed", margin: "0 auto 18px", animation: "spin .8s linear infinite" }} />}
      <h2 style={{ fontSize: 26 }}>{msg}</h2>
      {failed && <p className="fz-sub">Please continue from your company&apos;s KMR Apps page.</p>}
      {failed && <a className="btn block" href="/it/apps.html" style={{ marginTop: 12 }}>Go to KMR Apps</a>}
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
