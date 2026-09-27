import { createAdminClient } from "@/lib/supabase/admin";
import { findInvite } from "@/lib/onboarding";
import { getTenant, logoUrl, tenantById } from "@/lib/tenant";
import { signedDocUrl } from "@/lib/storage";
import { fullName, fmtDate, one } from "@/components/ui";
import { Wizard, type WizardInitial } from "./Wizard";

export const metadata = { title: "Joining formalities" };
export const dynamic = "force-dynamic";

function Frame({ tenant, children }: { tenant: { name: string; legal_name: string | null; logo_path: string | null } | null; children: React.ReactNode }) {
  const logo = tenant ? logoUrl(tenant) : null;
  return (
    <>
      <div className="publichead">
        <div className="inner">
          {logo ? <img src={logo} alt="" /> : null}
          <b>{tenant?.legal_name || tenant?.name || "HR portal"}</b>
        </div>
      </div>
      <div className="publicwrap">{children}</div>
    </>
  );
}

export default async function OnboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findInvite(token);
  const tenant = found ? await tenantById(found.invite.tenant_id) : await getTenant();

  if (!found || !tenant || found.invite.tenant_id !== tenant.id) {
    return <Frame tenant={tenant}><div className="card"><h1>Link not valid</h1><p>This onboarding link is not valid. Please use the latest link sent to you by HR, or contact them for a new one.</p></div></Frame>;
  }
  const { invite } = found;
  if (!found.open) {
    const submitted = ["submitted", "approved"].includes(invite.status);
    return (
      <Frame tenant={tenant}>
        <div className="card">
          <h1>{submitted ? "Thank you — details submitted" : found.expired ? "This link has expired" : "This link is no longer active"}</h1>
          <p>{submitted
            ? "HR is reviewing your details. You will receive your employee ID and login details by email and WhatsApp once approved."
            : "Please ask HR to send you a new link. Anything you already filled in has been saved."}</p>
        </div>
      </Frame>
    );
  }

  const db = createAdminClient();
  const [{ data: emp }, { data: priv }, { data: docs }] = await Promise.all([
    db.from("employees").select("*, designation:designations(name), department:departments(name), plant:plants(name)").eq("id", invite.employee_id).single(),
    db.from("employee_private").select("pan,aadhaar_last4,uan,previous_pf_no,esi_ip_no,bank_name,bank_branch,account_holder,account_number,ifsc,tax_regime").eq("employee_id", invite.employee_id).maybeSingle(),
    db.from("employee_documents").select("id,doc_type,file_name,uploaded_at").eq("employee_id", invite.employee_id).order("uploaded_at"),
  ]);
  if (!emp) return <Frame tenant={tenant}><div className="card"><h1>Record not found</h1></div></Frame>;

  const initial: WizardInitial = {
    token,
    company: tenant.legal_name || tenant.name,
    name: fullName(emp),
    designation: one(emp.designation as { name: string } | null)?.name ?? null,
    department: one(emp.department as { name: string } | null)?.name ?? null,
    joiningDate: emp.date_of_joining ? fmtDate(emp.date_of_joining) : null,
    email: emp.email,
    mobile: emp.mobile,
    profile: emp.profile ?? {},
    privateData: priv ?? null,
    docs: docs ?? [],
    selfieUrl: await signedDocUrl(emp.photo_path, 3600),
    status: invite.status,
    sentBack: invite.sent_back_sections ?? [],
    hrComment: invite.hr_comment,
    step: invite.current_step ?? 0,
    expiresOn: fmtDate(invite.expires_at),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };

  return (
    <Frame tenant={tenant}>
      <Wizard initial={initial} />
    </Frame>
  );
}
