import { redirect as kmrRedirect } from "next/navigation";
import { p } from "@/lib/base-path";
import { requireSession, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ROLE_LABELS } from "@/lib/types";
import { PasswordForm, PasskeyManager } from "./AccountForms";

export const metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  if ((process.env.KMR_LICENCE_CHECK || "on").toLowerCase() !== "off") kmrRedirect("/app");   // one login: password and sign-in live in KMR Apps
  const session = await requireSession();
  const { first } = await searchParams;
  const supabase = await createClient();
  const { data: passkeys } = await supabase
    .from("passkeys")
    .select("id,device_name,created_at,last_used_at,backed_up")
    .order("created_at", { ascending: false });
  const u = session.user;

  return (
    <AppShell session={session} active="/account">
      <div className="pagehead">
        <div>
          <h1>My account</h1>
          <p>{u.full_name} · {ROLE_LABELS[u.role]} · {u.email}</p>
        </div>
      </div>

      {(first || u.must_change_password) && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          Welcome! Please set your own password to continue. You can also turn on Face ID or fingerprint sign-in below.
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h2>Password</h2>
          <PasswordForm />
        </div>
        <div className="card">
          <h2>Face ID / fingerprint sign-in</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Sign in with your phone&apos;s Face ID, fingerprint, or Windows Hello instead of typing a password.
            Your face or fingerprint never leaves your device.
          </p>
          <PasskeyManager passkeys={passkeys ?? []} />
        </div>
      </div>
      {!u.must_change_password && (
        <p style={{ marginTop: 16 }}><a href={p(homeFor(u))}>← Back to portal</a></p>
      )}
    </AppShell>
  );
}
