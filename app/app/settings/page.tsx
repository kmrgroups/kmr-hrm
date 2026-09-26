import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logoUrl } from "@/lib/tenant";
import { env } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { saveCompany } from "./actions";

export const metadata = { title: "Company & branding" };

export default async function CompanySettings() {
  const session = await requireRole(ADMIN_ROLES);
  const t = session.tenant;
  const s = t.settings ?? {};
  const supabase = await createClient();
  const { data: domains } = await supabase.from("tenant_domains").select("domain,is_primary,verified").order("is_primary", { ascending: false });
  const logo = logoUrl(t);

  return (
    <AppShell session={session} active="/app/settings">
      <div className="pagehead"><div><h1>Company &amp; branding</h1><p>Shown on the login page, emails, WhatsApp messages, onboarding forms and ID cards.</p></div></div>
      <ActionForm action={saveCompany} submitLabel="Save settings">
        <div className="card">
          <h2>Company</h2>
          <div className="formgrid">
            <label className="field"><span>Short name <span className="req">*</span></span><input name="name" defaultValue={t.name} required /><span className="help">e.g. DENO</span></label>
            <label className="field">Legal name<input name="legal_name" defaultValue={t.legal_name ?? ""} /><span className="help">e.g. DENO Manufacturing and Solutions India Pvt Ltd</span></label>
            <label className="field full">Address<textarea name="address" defaultValue={t.address ?? ""} /><span className="help">Printed on the back of ID cards</span></label>
            <label className="field">Phone<input name="phone" defaultValue={t.phone ?? ""} /></label>
            <label className="field">Email<input name="email" type="email" defaultValue={t.email ?? ""} /></label>
            <label className="field">Website<input name="website" defaultValue={t.website ?? ""} /></label>
            <label className="field">Employee code prefix<input name="emp_code_prefix" defaultValue={t.emp_code_prefix} maxLength={6} /><span className="help">Codes look like {t.emp_code_prefix}-PLANT-0001</span></label>
          </div>
        </div>
        <div className="card">
          <h2>Branding</h2>
          <div className="formgrid">
            <div className="field">Logo
              {logo ? <img src={logo} alt="" style={{ maxHeight: 60, maxWidth: 220, border: "1px solid var(--border)", borderRadius: 6, padding: 6, background: "#fff" }} /> : <span className="help">No logo yet</span>}
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              <span className="help">PNG with transparent background works best. Max 2 MB.</span>
              {logo && <label className="check" style={{ fontWeight: 400 }}><input type="checkbox" name="remove_logo" value="1" /> Remove logo</label>}
            </div>
            <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
              <label className="field">Primary colour<input type="color" name="primary_color" defaultValue={t.primary_color} /></label>
              <label className="field">Accent colour<input type="color" name="accent_color" defaultValue={t.accent_color} /></label>
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Notifications</h2>
          <div className="formgrid">
            <label className="field">Send emails from<input name="email_from" defaultValue={s.email_from ?? ""} placeholder={env.emailFrom || "hr@yourcompany.com"} /><span className="help">Must be a domain verified in Resend. Blank = platform default.</span></label>
            <label className="field">Reply-to email<input name="email_reply_to" defaultValue={s.email_reply_to ?? ""} /></label>
            <label className="field">HR alert email<input name="hr_notify_email" defaultValue={s.hr_notify_email ?? ""} /><span className="help">Gets &ldquo;onboarding submitted&rdquo; alerts. Blank = all HR managers.</span></label>
            <label className="field">HR alert WhatsApp<input name="hr_notify_phone" defaultValue={s.hr_notify_phone ?? ""} /></label>
            <label className="field">Onboarding link valid for (days)<input type="number" name="onboarding_link_days" min={1} max={30} defaultValue={s.onboarding_link_days ?? 7} /></label>
          </div>
        </div>
        <div className="card">
          <h2>ID cards</h2>
          <div className="formgrid">
            <label className="field">Validity (years)<input type="number" name="id_card_validity_years" min={1} max={10} defaultValue={s.id_card_validity_years ?? 3} /></label>
            <label className="field">Signatory line<input name="id_card_signatory" defaultValue={s.id_card_signatory ?? "Authorised Signatory"} /></label>
          </div>
        </div>
      </ActionForm>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Web addresses</h2>
        <p className="muted">Employees can reach this portal at any of these addresses. Each address has its own Face ID sign-in.</p>
        <ul className="timeline">
          {env.rootDomain && <li><span className="mono">{t.slug}.{env.rootDomain}</span><span className="badge ok">Included</span></li>}
          {(domains ?? []).map((d) => (
            <li key={d.domain}><span className="mono">{d.domain}</span><span className={`badge ${d.verified ? "ok" : "warn"}`}>{d.verified ? (d.is_primary ? "Primary" : "Active") : "Pending DNS"}</span></li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          To use your own address such as <span className="mono">hr.yourcompany.com</span>, add a DNS CNAME record pointing to
          <span className="mono"> cname.vercel-dns.com</span> and ask your platform administrator to register the domain.
        </p>
      </div>
    </AppShell>
  );
}
