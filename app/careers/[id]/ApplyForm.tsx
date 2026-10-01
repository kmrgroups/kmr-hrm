"use client";
import { useState } from "react";
import { p } from "@/lib/base-path";

export function ApplyForm({ roleId, company }: { roleId: string; company: string }) {
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; error?: string }>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const f = fd.get("resume");
    if (!(f instanceof File) || !f.size) return setState({ error: "Attach your resume." });
    if (f.size > 4 * 1024 * 1024) return setState({ error: "Your resume is larger than 4 MB — please save a smaller copy (e.g. print to PDF)." });
    setState({ busy: true });
    const res = await fetch(p(`/api/careers/${roleId}`), { method: "POST", body: fd }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : { error: "Network problem — please try again." };
    setState(res?.ok && j.ok ? { ok: true } : { error: j.error || "Something went wrong — please try again." });
  }
  if (state.ok) return <div className="alert ok">Thank you! Your application has been received. {company} will contact you on your e-mail or mobile if your profile matches.</div>;
  return (
    <form className="formgrid" onSubmit={submit}>
      <label className="field">Full name<input name="full_name" required maxLength={120} autoComplete="name" /></label>
      <label className="field">Mobile<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" /></label>
      <label className="field">E-mail<input name="email" type="email" required autoComplete="email" /></label>
      <label className="field">City<input name="location" maxLength={80} /></label>
      <label className="field">Total experience (years)<input name="total_exp" inputMode="decimal" /></label>
      <label className="field">Notice period (days)<input name="notice_days" inputMode="numeric" /></label>
      <label className="field">Current salary (lakhs a year)<input name="current_ctc" inputMode="decimal" /></label>
      <label className="field">Expected salary (lakhs a year)<input name="expected_ctc" inputMode="decimal" /></label>
      <label className="field full">Resume (PDF or Word, up to 4 MB)<input name="resume" type="file" required accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: -5000 }} aria-hidden="true" />
      <label className="check full"><input type="checkbox" name="consent" required /> I agree that {company} may store and use my resume and details to consider me for this and similar roles.</label>
      <div className="full"><button className="btn" disabled={state.busy}>{state.busy ? "Sending…" : "Send my application"}</button></div>
      {state.error && <div className="alert error full" role="alert">{state.error}</div>}
    </form>
  );
}
