import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, randomToken, tempPassword } from "@/lib/tokens";
import { notify, type ChannelResult } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { DOCUMENT_TYPES, ONBOARDING_SECTIONS, type Employee, type Tenant } from "@/lib/types";
import { fullName, fmtDate, one } from "@/components/ui";

export const OPEN_INVITE_STATUSES = ["sent", "in_progress", "sent_back"] as const;

export interface InviteRow {
  id: string;
  tenant_id: string;
  employee_id: string;
  status: string;
  current_step: number;
  sent_back_sections: string[];
  hr_comment: string | null;
  expires_at: string;
  consent_at: string | null;
}

/** Looks up an onboarding link. Returns null if unknown; `open` says whether it can still be edited. */
export async function findInvite(token: string) {
  if (!token || token.length < 20) return null;
  const db = createAdminClient();
  const { data: invite } = await db.from("onboarding_invites").select("*").eq("token_hash", hashToken(token)).maybeSingle();
  if (!invite) return null;
  const expired = new Date(invite.expires_at).getTime() < Date.now();
  const open = !expired && (OPEN_INVITE_STATUSES as readonly string[]).includes(invite.status);
  return { invite: invite as InviteRow, expired, open };
}

/** Creates (or replaces) the onboarding link for an employee and sends it by email + WhatsApp. */
export async function sendOnboardingLink(opts: {
  tenant: Tenant;
  employeeId: string;
  actorId: string;
  actorName: string;
  origin: string;
  reminder?: boolean;
}): Promise<{ link: string; results: ChannelResult[] }> {
  const db = createAdminClient();
  const { data: emp } = await db
    .from("employees")
    .select("id,first_name,last_name,email,mobile,designation:designations(name)")
    .eq("id", opts.employeeId)
    .eq("tenant_id", opts.tenant.id)
    .single();
  if (!emp) throw new Error("Employee not found");

  const token = randomToken();
  const days = opts.tenant.settings?.onboarding_link_days ?? 7;
  const expires = new Date(Date.now() + days * 864e5);

  // One live link per employee: revoke older open links, keep their progress on the employee record.
  await db.from("onboarding_invites").update({ status: "revoked" })
    .eq("employee_id", emp.id).in("status", [...OPEN_INVITE_STATUSES]);

  const { data: prev } = await db.from("onboarding_invites").select("current_step,sent_back_sections,hr_comment,status")
    .eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { error } = await db.from("onboarding_invites").insert({
    tenant_id: opts.tenant.id,
    employee_id: emp.id,
    token_hash: hashToken(token),
    status: prev?.sent_back_sections?.length && prev.status === "revoked" ? "sent_back" : "sent",
    current_step: prev?.current_step ?? 0,
    sent_back_sections: prev?.status === "revoked" ? prev.sent_back_sections ?? [] : [],
    hr_comment: prev?.status === "revoked" ? prev.hr_comment : null,
    expires_at: expires.toISOString(),
    created_by: opts.actorId,
  });
  if (error) throw new Error(error.message);

  await db.from("employees").update({ status: "invited" }).eq("id", emp.id).in("status", ["invited", "inactive"]);

  const link = `${opts.origin}/onboard/${token}`;
  const designation = one(emp.designation as { name: string } | { name: string }[] | null)?.name ?? "our team member";
  const results = await notify({
    tenant: opts.tenant,
    event: opts.reminder ? "onboarding_reminder" : "onboarding_invite",
    to: { name: fullName(emp), email: emp.email, phone: emp.mobile },
    vars: { link, designation, expires_on: fmtDate(expires.toISOString()), hr_name: opts.actorName },
    related: { type: "employee", id: emp.id },
  });
  await logAudit({ tenantId: opts.tenant.id, actorId: opts.actorId, action: "onboarding.link_sent", entity: "employees", entityId: emp.id, data: { expires: expires.toISOString() } });
  return { link, results };
}

/** What is still missing before the employee can submit. Empty array = ready. */
export function missingItems(emp: Pick<Employee, "profile" | "photo_path">, hasPrivate: boolean, docTypes: string[]): string[] {
  const done = new Set(((emp.profile as Record<string, unknown>)?._done as string[]) ?? []);
  const missing: string[] = [];
  for (const s of ONBOARDING_SECTIONS) {
    if (s.key === "documents" || s.key === "selfie") continue;
    if (s.key === "statutory" ? !hasPrivate : !done.has(s.key)) missing.push(s.label);
  }
  for (const d of DOCUMENT_TYPES.filter((d) => d.required)) {
    if (!docTypes.includes(d.key)) missing.push(d.label);
  }
  if (!emp.photo_path) missing.push("Selfie");
  return missing;
}

/** HR approves: allocate code, activate, create login, issue ID card, send welcome. */
export async function approveOnboarding(opts: {
  tenant: Tenant;
  employeeId: string;
  actorId: string;
  origin: string;
  dateOfJoining?: string | null;
}) {
  const db = createAdminClient();
  const { data: emp } = await db.from("employees").select("*").eq("id", opts.employeeId).eq("tenant_id", opts.tenant.id).single();
  if (!emp) throw new Error("Employee not found");
  if (emp.status !== "submitted") throw new Error("Only a submitted onboarding can be approved.");
  if (!emp.email) throw new Error("The employee needs an email address to receive login details.");

  let code: string = emp.employee_code;
  if (!code) {
    const { data, error } = await db.rpc("next_employee_code", { p_tenant: opts.tenant.id, p_plant: emp.plant_id });
    if (error) throw new Error(error.message);
    code = data as string;
  }

  // Login account (email + temporary password; the employee sets their own on first sign-in)
  const password = tempPassword();
  const email = String(emp.email).toLowerCase();
  let userId: string | null = null;
  const { data: existingUser } = await db.from("app_users").select("id").eq("employee_id", emp.id).maybeSingle();
  if (existingUser) {
    userId = existingUser.id;
    await db.auth.admin.updateUserById(userId!, { password });
    await db.from("app_users").update({ must_change_password: true, active: true }).eq("id", userId);
  } else {
    const { data: created, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName(emp), tenant: opts.tenant.slug },
    });
    if (error) {
      throw new Error(/already/i.test(error.message)
        ? `A login already exists for ${email}. Use a different email or contact support.`
        : error.message);
    }
    userId = created.user.id;
    const { error: appErr } = await db.from("app_users").insert({
      id: userId, tenant_id: opts.tenant.id, role: "employee", full_name: fullName(emp),
      email, phone: emp.mobile, employee_id: emp.id, must_change_password: true,
    });
    if (appErr) {
      await db.auth.admin.deleteUser(userId);
      throw new Error(appErr.message);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  await db.from("employees").update({
    employee_code: code,
    status: "active",
    date_of_joining: opts.dateOfJoining || emp.date_of_joining || today,
  }).eq("id", emp.id);
  await db.from("onboarding_invites").update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: opts.actorId, sent_back_sections: [] })
    .eq("employee_id", emp.id).in("status", ["submitted"]);
  await db.from("employee_documents").update({ status: "approved" }).eq("employee_id", emp.id).eq("status", "uploaded");

  // ID card
  const years = opts.tenant.settings?.id_card_validity_years ?? 3;
  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + years);
  await db.from("id_cards").update({ status: "replaced" }).eq("employee_id", emp.id).eq("status", "active");
  await db.from("id_cards").insert({
    tenant_id: opts.tenant.id, employee_id: emp.id, valid_until: validUntil.toISOString().slice(0, 10),
    issued_by: opts.actorId, reason: "new",
  });

  const results = await notify({
    tenant: opts.tenant,
    event: "onboarding_approved",
    to: { name: fullName(emp), email, phone: emp.mobile },
    vars: { employee_code: code, login_url: `${opts.origin}/login`, username: email, temp_password: password },
    related: { type: "employee", id: emp.id },
  });
  await logAudit({ tenantId: opts.tenant.id, actorId: opts.actorId, action: "onboarding.approved", entity: "employees", entityId: emp.id, data: { employee_code: code } });
  return { code, results, password };
}

export async function sendBackOnboarding(opts: {
  tenant: Tenant;
  employeeId: string;
  actorId: string;
  actorName: string;
  origin: string;
  sections: string[];
  comment: string;
}) {
  const db = createAdminClient();
  const { data: emp } = await db.from("employees").select("id,status").eq("id", opts.employeeId).eq("tenant_id", opts.tenant.id).single();
  if (!emp || emp.status !== "submitted") throw new Error("Only a submitted onboarding can be sent back.");
  // Mark the submitted invite; sendOnboardingLink carries sections + comment into the new link.
  await db.from("onboarding_invites").update({
    status: "revoked", sent_back_sections: opts.sections, hr_comment: opts.comment,
    reviewed_at: new Date().toISOString(), reviewed_by: opts.actorId,
  }).eq("employee_id", emp.id).eq("status", "submitted");
  await db.from("employees").update({ status: "sent_back" }).eq("id", emp.id);

  const { link } = await sendOnboardingLinkSilently(opts);
  const labels = ONBOARDING_SECTIONS.filter((s) => opts.sections.includes(s.key)).map((s) => s.label).join(", ");
  const { data: e2 } = await db.from("employees").select("first_name,last_name,email,mobile").eq("id", emp.id).single();
  const results = await notify({
    tenant: opts.tenant,
    event: "onboarding_sent_back",
    to: { name: fullName(e2!), email: e2!.email, phone: e2!.mobile },
    vars: { link, sections: labels, comment: opts.comment || "-" },
    related: { type: "employee", id: emp.id },
  });
  await logAudit({ tenantId: opts.tenant.id, actorId: opts.actorId, action: "onboarding.sent_back", entity: "employees", entityId: emp.id, data: { sections: opts.sections, comment: opts.comment } });
  return { link, results };
}

/** New link carrying the send-back sections, without the standard invite message. */
async function sendOnboardingLinkSilently(opts: { tenant: Tenant; employeeId: string; actorId: string; origin: string }) {
  const db = createAdminClient();
  const token = randomToken();
  const days = opts.tenant.settings?.onboarding_link_days ?? 7;
  const { data: prev } = await db.from("onboarding_invites").select("current_step,sent_back_sections,hr_comment")
    .eq("employee_id", opts.employeeId).order("created_at", { ascending: false }).limit(1).single();
  await db.from("onboarding_invites").insert({
    tenant_id: opts.tenant.id, employee_id: opts.employeeId, token_hash: hashToken(token), status: "sent_back",
    current_step: 0, sent_back_sections: prev?.sent_back_sections ?? [], hr_comment: prev?.hr_comment ?? null,
    expires_at: new Date(Date.now() + days * 864e5).toISOString(), created_by: opts.actorId,
  });
  return { link: `${opts.origin}/onboard/${token}` };
}
