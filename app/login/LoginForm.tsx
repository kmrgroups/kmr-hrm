"use client";
import { p } from "@/lib/base-path";
import { useActionState, useEffect, useState } from "react";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { passwordLogin, sendOtp, type LoginState } from "./actions";

type Mode = "password" | "otp" | "passkey";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("password");
  const [pwState, pwAction, pwPending] = useActionState<LoginState, FormData>(passwordLogin, {});
  const [otpState, otpAction, otpPending] = useActionState<LoginState, FormData>(sendOtp, {});
  const [pkError, setPkError] = useState<string | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkSupported, setPkSupported] = useState(true);
  // controlled so it survives React resetting the form after a failed attempt
  const [email, setEmail] = useState("");

  useEffect(() => setPkSupported(browserSupportsWebAuthn()), []);

  async function passkeyLogin() {
    setPkError(null);
    setPkBusy(true);
    try {
      const opts = await fetch(p("/api/auth/passkey/login-options"), { method: "POST" }).then((r) => r.json());
      if (opts.error) throw new Error(opts.error);
      const assertion = await startAuthentication({ optionsJSON: opts });
      const res = await fetch(p("/api/auth/passkey/login-verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion, next }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      window.location.href = p(res.redirect);
    } catch (e) {
      const msg = (e as Error).message || "";
      setPkError(/NotAllowed|cancel|timed out/i.test(msg) ? "Face ID / fingerprint was cancelled. Try again." : msg);
    } finally {
      setPkBusy(false);
    }
  }

  return (
    <div>
      <div className="segmented" role="tablist">
        {(["password", "otp", "passkey"] as Mode[]).map((m) => (
          <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m)} role="tab" aria-selected={mode === m}>
            {m === "password" ? "Password" : m === "otp" ? "Email code" : "Face ID"}
          </button>
        ))}
      </div>

      {mode === "password" && (
        <form action={pwAction} className="stack">
          <input type="hidden" name="next" value={next} />
          <label className="field">Email<input name="email" type="email" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          {pwState.error && <div className="alert error">{pwState.error}</div>}
          <button className="btn block" disabled={pwPending}>{pwPending ? "Signing in…" : "Sign in"}</button>
          <button type="button" className="btn ghost small" onClick={() => setMode("otp")}>Forgot password? Sign in with an email code</button>
        </form>
      )}

      {mode === "otp" && (
        <form action={otpAction} className="stack">
          <input type="hidden" name="next" value={next} />
          <label className="field">Email
            <input name="email" type="email" autoComplete="username" required value={otpState.otpSentTo ?? email} onChange={(e) => setEmail(e.target.value)} readOnly={!!otpState.otpSentTo} />
          </label>
          {otpState.otpSentTo && (
            <label className="field">6-digit code
              <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
            </label>
          )}
          {otpState.info && <div className="alert info">{otpState.info}</div>}
          {otpState.error && <div className="alert error">{otpState.error}</div>}
          <button className="btn block" disabled={otpPending}>
            {otpPending ? "Please wait…" : otpState.otpSentTo ? "Verify and sign in" : "Send code"}
          </button>
        </form>
      )}

      {mode === "passkey" && (
        <div className="stack">
          <p className="muted" style={{ fontSize: 14, textAlign: "center" }}>
            Use Face ID, fingerprint or Windows Hello on this device. Turn it on first from <b>My account</b> after signing in with your password.
          </p>
          {!pkSupported && <div className="alert warn">This browser does not support Face ID / fingerprint sign-in.</div>}
          {pkError && <div className="alert error">{pkError}</div>}
          <button className="btn block" onClick={passkeyLogin} disabled={pkBusy || !pkSupported}>
            {pkBusy ? "Waiting for your device…" : "Sign in with Face ID / fingerprint"}
          </button>
        </div>
      )}
    </div>
  );
}
