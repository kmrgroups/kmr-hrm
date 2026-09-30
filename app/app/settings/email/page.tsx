import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { CompanyEmailFields } from "@/components/CompanyEmailFields";
import { getMailbox, PRESETS } from "@/lib/company-mail";
import { disconnectCompanyEmail, saveCompanyEmail } from "./actions";

export const metadata = { title: "Company email" };
export const dynamic = "force-dynamic";

export default async function CompanyEmailPage() {
  const session = await requireRole(["hr_manager"]);
  const m = await getMailbox(session.tenant.id);
  return (
    <AppShell session={session} active="/app/settings/email">
      <div className="pagehead"><div><h1>Company email</h1>
        <p>Payslips, leave updates, onboarding links and sign-in codes are emailed to your employees from <b>your own company mailbox</b>. Your employees never see a KMR address.</p></div></div>

      <div className="card">
        <h2>Status</h2>
        {m ? (
          <p><span className={`badge ${m.last_error ? "warn" : "ok"}`}>{m.last_error ? "Connected — last email failed" : "Connected"}</span>{" "}
            Emails go out from <b>{m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}</b>
            {m.verified_at ? <> · tested {new Date(m.verified_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</> : null}</p>
        ) : (
          <p><span className="badge warn">Not connected</span> HR emails are <b>not being sent</b> yet. WhatsApp messages and the employee portal work as usual. Connect your mailbox below.</p>
        )}
        {m?.last_error && <p className="muted">Last error: {m.last_error}</p>}
      </div>

      <div className="card">
        <h2>{m ? "Change mailbox" : "Connect your mailbox"}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Use a mailbox like <b>hr@yourcompany.com</b>. When you click Connect, we sign in to it, send you a test email, and save it only if that works.</p>
        <ActionForm action={saveCompanyEmail} submitLabel={m ? "Test and save" : "Connect and send test email"} pendingLabel="Testing the mailbox…">
          <CompanyEmailFields presets={PRESETS} initial={{ from_email: m?.from_email ?? "", from_name: m?.from_name ?? "", host: m?.host ?? "", port: m?.port ?? 0, secure: m?.secure ?? false, username: m?.username ?? "", saved: !!m }} />
        </ActionForm>
      </div>

      {m && (
        <div className="card">
          <h2>Disconnect</h2>
          <p className="muted">Stops all HR emails until a mailbox is connected again. The saved password is deleted.</p>
          <ActionForm action={disconnectCompanyEmail} submitLabel="Disconnect mailbox" variant="danger" confirm="Stop sending HR emails and delete the saved mailbox login?" />
        </div>
      )}
    </AppShell>
  );
}
