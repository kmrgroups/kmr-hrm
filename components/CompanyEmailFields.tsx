"use client";
import { useState } from "react";
import type { Preset } from "@/lib/company-mail";

/** Pick the email provider → server and port fill themselves; only "Other" shows the technical fields. */
export function CompanyEmailFields({ presets, initial }: { presets: Preset[]; initial: { from_email: string; from_name: string; host: string; port: number; secure: boolean; username: string; saved: boolean } }) {
  const match = presets.find((p) => p.host && p.host === initial.host);
  const [key, setKey] = useState(initial.host ? (match?.key ?? "other") : "google");
  const p = presets.find((x) => x.key === key)!;
  const [host, setHost] = useState(initial.host || p.host);
  const [port, setPort] = useState(String(initial.port || p.port));
  const pick = (k: string) => { const n = presets.find((x) => x.key === k)!; setKey(k); if (n.host) setHost(n.host); setPort(String(n.port)); };
  return (
    <>
      <div className="field full">Your email provider
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {presets.map((x) => (
            <button type="button" key={x.key} onClick={() => pick(x.key)} className={`btn ${key === x.key ? "" : "secondary"}`} style={{ padding: "6px 12px" }}>{x.label}</button>
          ))}
        </div>
        <span className="help">{p.help}</span>
      </div>
      <div className="formgrid">
        <label className="field"><span>Send from (email) <span className="req">*</span></span><input name="from_email" type="email" required defaultValue={initial.from_email} placeholder="hr@yourcompany.com" /></label>
        <label className="field">Sender name<input name="from_name" defaultValue={initial.from_name} placeholder="e.g. DENO HR" /><span className="help">What employees see as “From”. Blank = company name.</span></label>
        <label className="field">Login (username)<input name="username" defaultValue={initial.username} placeholder="Usually the same email" /><span className="help">Leave blank to use the email above.</span></label>
        <label className="field"><span>Password {key === "google" || key === "zoho" ? "(App password)" : ""} {!initial.saved && <span className="req">*</span>}</span>
          <input name="password" type="password" autoComplete="new-password" required={!initial.saved} placeholder={initial.saved ? "Saved — leave blank to keep it" : ""} />
          <span className="help">Stored encrypted. Nobody at KMR can read it.</span></label>
        <label className="field" style={key === "other" ? undefined : { display: "none" }}>Mail server (SMTP)<input name="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.yourprovider.com" /></label>
        <label className="field" style={key === "other" ? undefined : { display: "none" }}>Port<input name="port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /><span className="help">465 (SSL) or 587 (STARTTLS)</span></label>
      </div>
    </>
  );
}
