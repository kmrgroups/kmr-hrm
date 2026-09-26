import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRANDING_BUCKET, downloadDoc } from "@/lib/storage";
import { fmtDate, fullName, one } from "@/components/ui";
import type { Tenant } from "@/lib/types";
import type { IdCardData } from "@/lib/idcard";

function imgType(path: string | null | undefined): "png" | "jpg" | undefined {
  if (!path) return undefined;
  return /\.png$/i.test(path) ? "png" : /\.jpe?g$/i.test(path) ? "jpg" : undefined;
}

/** Everything needed to print ID cards for the given employees (active only, same tenant). */
export async function loadIdCardData(tenant: Tenant, employeeIds: string[], origin: string): Promise<IdCardData[]> {
  const db = createAdminClient();
  const { data: rows } = await db
    .from("employees")
    .select("id,first_name,last_name,employee_code,blood_group,photo_path,emergency_contact_name,emergency_contact_phone,verify_token,designation:designations(name),department:departments(name),id_cards(valid_until,status)")
    .eq("tenant_id", tenant.id)
    .eq("status", "active")
    .in("id", employeeIds.slice(0, 200));

  let logo: Uint8Array | null = null;
  if (tenant.logo_path && /\.(png|jpe?g)$/i.test(tenant.logo_path)) {
    const { data } = await db.storage.from(BRANDING_BUCKET).download(tenant.logo_path);
    if (data) logo = new Uint8Array(await data.arrayBuffer());
  }

  const cards: IdCardData[] = [];
  for (const e of rows ?? []) {
    const card = ((e.id_cards as { valid_until: string | null; status: string }[]) ?? []).find((c) => c.status === "active");
    const photo = e.photo_path ? await downloadDoc(e.photo_path) : null;
    cards.push({
      company: tenant.legal_name || tenant.name,
      companyAddress: tenant.address,
      companyPhone: tenant.phone,
      primaryColor: tenant.primary_color,
      accentColor: tenant.accent_color,
      logo, logoType: imgType(tenant.logo_path),
      photo, photoType: imgType(e.photo_path),
      name: fullName(e),
      employeeCode: e.employee_code ?? "",
      designation: one(e.designation)?.name,
      department: one(e.department)?.name,
      bloodGroup: e.blood_group,
      emergencyName: e.emergency_contact_name,
      emergencyPhone: e.emergency_contact_phone,
      validUntil: card?.valid_until ? fmtDate(card.valid_until) : null,
      verifyUrl: `${origin}/v/${e.verify_token}`,
      signatory: tenant.settings?.id_card_signatory ?? "Authorised Signatory",
    });
  }
  // keep the order the caller asked for
  return cards.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}
