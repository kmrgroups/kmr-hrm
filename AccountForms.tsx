"use client";
import { PasswordInput } from "@/components/PasswordInput";
import { p } from "@/lib/base-path";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { changePassword, removePasskey, type FormState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="stack">
      <label className="field">New password<PasswordInput name="password" autoComplete="new-password" minLength={8} required /></label>
      <label className="field">Confirm new password<PasswordInput name="confirm" autoComplete="new-password" minLength={8} required /></label>
      {state.error && <div className="alert error">{state.error}</div>}
      {state.ok && <div className="alert ok">{state.ok}</div>}
      <div><button className="btn" disabled={pending}>{pending ? "Saving…" : "Update password"}</button></div>
    </form>
  );
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

interface Passkey { id: string; device_name: string | null; created_at: string; last_used_at: string | null }

export function PasskeyManager({ passkeys }: { passkeys: Passkey[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [, startTransition] = useTransition();
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setMsg({});
    try {
      const opts = await fetch(p("/api/auth/passkey/register-options"), { method: "POST" }).then((r) => r.json());
      if (opts.error) throw new Error(opts.error);
      const att = await startRegistration({ optionsJSON: opts });
      const res = await fetch(p("/api/auth/passkey/register-verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: att, deviceName: guessDeviceName() }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setMsg({ ok: "Done. Next time, choose “Face ID” on the sign-in page." });
      router.refresh();
    } catch (e) {
      const m = (e as Error).message;
      setMsg({ error: /NotAllowed|cancel/i.test(m) ? "Cancelled." : /InvalidState|already/i.test(m) ? "This device is already registered." : m });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {passkeys.length > 0 ? (
        <ul className="timeline">
          {passkeys.map((p) => (
            <li key={p.id}>
              <span>
                <b>{p.device_name || "Device"}</b>
                <br />
                <small>Added {new Date(p.created_at).toLocaleDateString("en-IN")}{p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString("en-IN")}` : ""}</small>
              </span>
              <button className="btn secondary small" onClick={() => startTransition(() => removePasskey(p.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ fontSize: 14 }}>No devices set up yet.</p>
      )}
      {!supported && <div className="alert warn">This browser does not support Face ID / fingerprint sign-in.</div>}
      {msg.error && <div className="alert error">{msg.error}</div>}
      {msg.ok && <div className="alert ok">{msg.ok}</div>}
      <div><button className="btn" onClick={add} disabled={busy || !supported}>{busy ? "Waiting for your device…" : "Turn on for this device"}</button></div>
    </div>
  );
}
