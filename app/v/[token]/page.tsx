import { p } from "@/lib/base-path";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantById, logoUrl } from "@/lib/tenant";
import { getSession } from "@/lib/auth";
import { signedDocUrl } from "@/lib/storage";
import { fullName, fmtDate, one } from "@/components/ui";

export const metadata = { title: "ID card verification" };
export const dynamic = "force-dynamic";

// Public page opened by scanning the ID card QR code. Shows only what a
// security guard or visitor needs — never salary, bank, PF or address details.
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createAdminClient();
  const { data: emp } = /^[0-9a-f]{32}$/i.test(token)
    ? await db.from("employees")
        .select("id,tenant_id,first_name,last_name,employee_code,status,blood_group,photo_path,emergency_contact_name,emergency_contact_phone,designation:designations(name),department:departments(name),id_cards(status,valid_until)")
        .eq("verify_token", token).maybeSingle()
    : { data: null };

  const tenant = emp ? await tenantById(emp.tenant_id) : null;
  const valid = !!emp && !!tenant;
  const card = valid ? ((emp!.id_cards as { status: string; valid_until: string | null }[]) ?? []).find((c) => c.status === "active") : null;
  const expired = !!card?.valid_until && new Date(card.valid_until) < new Date();
  const ok = valid && emp!.status === "active" && !!card && !expired;
  const photo = valid ? await signedDocUrl(emp!.photo_path, 600) : null;
  const session = valid ? await getSession() : null;
  const isOwner = !!session && session.user.employee_id === emp?.id;
  const logo = tenant ? logoUrl(tenant) : null;

  return (
    <>
      <div className="publichead"><div className="inner">{logo ? <img src={logo} alt="" /> : null}<b>{tenant?.legal_name || tenant?.name || "ID verification"}</b></div></div>
      <div className="publicwrap verify">
        <div className="card stack" style={{ alignItems: "center", textAlign: "center" }}>
          <div className="status" style={{ width: "100%", background: ok ? "var(--ok-bg)" : "var(--danger-bg)", color: ok ? "var(--ok)" : "var(--danger)" }}>
            {ok ? "✓ Valid employee ID" : !valid ? "✕ Card not recognised" : expired ? "✕ Card expired" : "✕ Not an active employee"}
          </div>
          {valid && (
            <>
              {photo && <img src={photo} alt="" style={{ width: 140, height: 170, objectFit: "cover", borderRadius: 8, border: "3px solid var(--brand)" }} />}
              <div>
                <h1 style={{ marginBottom: 2 }}>{fullName(emp!)}</h1>
                <div className="mono">{emp!.employee_code}</div>
                <div className="muted">{[one(emp!.designation)?.name, one(emp!.department)?.name].filter(Boolean).join(" · ")}</div>
              </div>
              <dl className="kv" style={{ textAlign: "left", width: "100%" }}>
                <dt>Blood group</dt><dd><b>{emp!.blood_group || "—"}</b></dd>
                <dt>Emergency contact</dt><dd>{emp!.emergency_contact_name || "—"}<br />{emp!.emergency_contact_phone ? <a href={`tel:${emp!.emergency_contact_phone}`}>{emp!.emergency_contact_phone}</a> : null}</dd>
                <dt>Card valid upto</dt><dd>{card?.valid_until ? fmtDate(card.valid_until) : "—"}</dd>
              </dl>
              {isOwner ? (
                <a className="btn block" href={p("/me")}>Open my portal</a>
              ) : (
                <small>This is a read-only verification page. Employees can sign in to see their attendance, salary and leave.</small>
              )}
            </>
          )}
          {!valid && <p className="muted">This QR code does not match any employee of this company. It may be from an old, replaced card.</p>}
        </div>
        {tenant?.phone && <p className="muted" style={{ textAlign: "center", marginTop: 12 }}>Questions? Call {tenant.name} at <a href={`tel:${tenant.phone}`}>{tenant.phone}</a></p>}
      </div>
    </>
  );
}
