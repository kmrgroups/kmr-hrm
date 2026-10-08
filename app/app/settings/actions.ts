"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { assertRole, ADMIN_ROLES, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRANDING_BUCKET } from "@/lib/storage";
import { currentOrigin } from "@/lib/tenant";
import { tempPassword } from "@/lib/tokens";
import { describeResults, notify } from "@/lib/notify";
import { isValidEmail, normalizeIndianMobile } from "@/lib/validators";
import { logAudit } from "@/lib/audit";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { DEFAULT_TEMPLATES, type NotificationEvent } from "@/lib/notify/templates";
import type { ActionState } from "@/app/app/employees/actions";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must look like #1F3A5F");
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const companySchema = z.object({
  name: z.string().trim().min(2, "Short name is required").max(60),
  legal_name: opt(160),
  address: opt(400),
  phone: opt(30),
  email: opt(120),
  website: opt(160),
  primary_color: hex,
  accent_color: hex,
  emp_code_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, "Code prefix: 2–6 letters or digits"),
  email_from: opt(120),
  email_reply_to: opt(120),
  hr_notify_email: opt(120),
  hr_notify_phone: opt(20),
  id_card_validity_years: z.coerce.number().int().min(1).max(10),
  id_card_signatory: opt(60),
  onboarding_link_days: z.coerce.number().int().min(1).max(30),
});

export async function saveCompany(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(ADMIN_ROLES);
    const parsed = companySchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    for (const e of [d.email, d.email_from, d.email_reply_to, d.hr_notify_email]) if (e && !isValidEmail(e)) return { error: `${e} is not a valid email` };

    const update: Record<string, unknown> = {
      name: d.name, legal_name: d.legal_name, address: d.address, phone: d.phone, email: d.email, website: d.website,
      primary_color: d.primary_color, accent_color: d.accent_color, emp_code_prefix: d.emp_code_prefix,
      settings: {
        ...tenant.settings,
        email_from: d.email_from ?? undefined, email_reply_to: d.email_reply_to ?? undefined,
        hr_notify_email: d.hr_notify_email ?? undefined, hr_notify_phone: d.hr_notify_phone ?? undefined,
        id_card_validity_years: d.id_card_validity_years, id_card_signatory: d.id_card_signatory ?? undefined,
        onboarding_link_days: d.onboarding_link_days,
      },
    };

    const logo = form.get("logo");
    if (logo instanceof File && logo.size > 0) {
      const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[logo.type];
      if (!ext) return { error: "Logo must be PNG, JPG, WEBP or SVG (PNG or JPG is best for printed ID cards)." };
      if (logo.size > 2 * 1024 * 1024) return { error: "Logo must be under 2 MB." };
      const path = `${tenant.id}/logo-${Date.now()}.${ext}`;
      const { error } = await createAdminClient().storage.from(BRANDING_BUCKET).upload(path, logo, { contentType: logo.type, upsert: true });
      if (error) return { error: `Logo upload failed: ${error.message}` };
      update.logo_path = path;
    }
    if (form.get("remove_logo") === "1") update.logo_path = null;

    const supabase = await createClient();
    const { error } = await supabase.from("tenants").update(update).eq("id", tenant.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "company.updated", entity: "tenants", entityId: tenant.id });
    revalidateTag("tenant");
    revalidatePath("/", "layout");
    return { ok: "Company settings saved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------- masters
const MASTER_TABLES = { plants: "plants", departments: "departments", designations: "designations" } as const;

export async function addMaster(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant } = await assertRole(HR_ROLES);
    const table = MASTER_TABLES[String(form.get("table")) as keyof typeof MASTER_TABLES];
    if (!table) return { error: "Unknown list" };
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Name is required" };
    const row: Record<string, unknown> = { tenant_id: tenant.id, name: name.slice(0, 100) };
    const code = String(form.get("code") || "").trim().toUpperCase();
    if (table === "plants") {
      if (!/^[A-Z0-9]{1,6}$/.test(code)) return { error: "Plant code: 1–6 letters or digits (used in employee codes)" };
      row.code = code;
      row.address = String(form.get("address") || "").trim() || null;
      row.state = String(form.get("state") || "").trim() || null;
    } else if (table === "departments") {
      row.code = code || null;
    } else {
      row.grade = String(form.get("grade") || "").trim() || null;
    }
    const supabase = await createClient();
    const { error } = await supabase.from(table).insert(row);
    if (error) return { error: /duplicate/.test(error.message) ? `${name} already exists.` : error.message };
    revalidatePath("/app/settings/masters");
    return { ok: `${name} added.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function toggleMaster(form: FormData) {
  await assertRole(HR_ROLES);
  const table = MASTER_TABLES[String(form.get("table")) as keyof typeof MASTER_TABLES];
  if (!table) return;
  const supabase = await createClient();
  await supabase.from(table).update({ active: form.get("active") === "1" }).eq("id", String(form.get("id")));
  revalidatePath("/app/settings/masters");
}

const USED_BY: Record<string, [string, string][]> = {
  plants: [["employees", "plant_id"], ["attendance_devices", "plant_id"], ["holidays", "plant_id"], ["incidents", "plant_id"], ["offers", "plant_id"], ["operations", "plant_id"], ["requisitions", "plant_id"], ["announcements", "plant_id"], ["documents", "plant_id"], ["surveys", "plant_id"]],
  departments: [["employees", "department_id"], ["positions", "department_id"], ["org_nodes", "department_id"], ["requisitions", "department_id"], ["offers", "department_id"], ["incidents", "department_id"], ["kpis", "department_id"], ["rr_roles", "department_id"], ["announcements", "department_id"], ["documents", "department_id"], ["surveys", "department_id"]],
  designations: [["employees", "designation_id"], ["job_descriptions", "designation_id"], ["kpis", "designation_id"], ["offers", "designation_id"], ["ojt_templates", "designation_id"], ["requisitions", "designation_id"], ["role_competencies", "designation_id"], ["rr_roles", "designation_id"]],
  positions: [["employees", "position_id"], ["job_descriptions", "position_id"], ["kpis", "position_id"], ["requisitions", "position_id"], ["role_competencies", "position_id"], ["rr_roles", "position_id"]],
};
const LABEL: Record<string, string> = { plants: "plant", departments: "department", designations: "designation", positions: "position" };
async function inUse(table: keyof typeof USED_BY, id: string): Promise<boolean> {
  const supabase = await createClient();
  for (const [t, col] of USED_BY[table]!) {
    const { count } = await supabase.from(t).select("id", { count: "exact", head: true }).eq(col, id);
    if (count) return true;
  }
  return false;
}
const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

/** Edit the name / code / grade etc. of a plant, department or designation */
export async function updateMaster(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const table = MASTER_TABLES[String(form.get("table")) as keyof typeof MASTER_TABLES];
    const id = String(form.get("id") || "");
    if (!table || !isUuid(id)) return { error: "Unknown item" };
    const name = String(form.get("name") || "").trim().slice(0, 100);
    if (name.length < 2) return { error: "Name is required" };
    const row: Record<string, unknown> = { name };
    const code = String(form.get("code") || "").trim().toUpperCase();
    if (table === "plants") {
      if (!/^[A-Z0-9]{1,6}$/.test(code)) return { error: "Plant code: 1–6 letters or digits" };
      row.code = code; row.state = String(form.get("state") || "").trim() || null; row.address = String(form.get("address") || "").trim() || null;
    } else if (table === "departments") row.code = code || null;
    else row.grade = String(form.get("grade") || "").trim() || null;
    const supabase = await createClient();
    const { data, error } = await supabase.from(table).update(row).eq("id", id).select("id").maybeSingle();
    if (error) return { error: /duplicate/.test(error.message) ? `${name} already exists.` : error.message };
    if (!data) return { error: "Item not found." };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "master.changed", entity: table, entityId: id, data: { name } });
    revalidatePath("/app/settings/masters");
    return { ok: `${name} saved.` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Delete only when nothing uses it; otherwise tell the user to Hide it instead */
export async function deleteMaster(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const key = String(form.get("table"));
    const id = String(form.get("id") || "");
    const table = key === "positions" ? "positions" : MASTER_TABLES[key as keyof typeof MASTER_TABLES];
    if (!table || !isUuid(id)) return { error: "Unknown item" };
    if (await inUse(table, id)) return { error: `This ${LABEL[table]} is used in employee or other records, so it cannot be deleted. Use Hide instead - it stays on old records and disappears from the dropdowns.` };
    const supabase = await createClient();
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "master.deleted", entity: table, entityId: id, data: {} });
    revalidatePath("/app/settings/masters");
    return { ok: "Deleted." };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Positions (Production Head, Calibration Incharge ...) - the list behind the Position dropdown on the employee record */
export async function savePosition(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await assertRole(HR_ROLES);
    const id = String(form.get("id") || "");
    const title = String(form.get("title") || "").trim().slice(0, 120);
    if (title.length < 2) return { error: "Enter the position name." };
    const dept = String(form.get("department_id") || "");
    const row = { title, role: String(form.get("role") || "").trim().slice(0, 160) || null, department_id: isUuid(dept) ? dept : null };
    const supabase = await createClient();
    const q = id && isUuid(id) ? supabase.from("positions").update(row).eq("id", id).select("id").maybeSingle() : supabase.from("positions").insert({ ...row, tenant_id: tenant.id, created_by: user.id }).select("id").single();
    const { data, error } = await q;
    if (error) return { error: /duplicate/.test(error.message) ? `${title} already exists for that department.` : error.message };
    if (!data) return { error: "Position not found." };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: id ? "master.changed" : "master.added", entity: "positions", entityId: data.id, data: { title } });
    revalidatePath("/app/settings/masters"); revalidatePath("/app/employees");
    return { ok: id ? `${title} saved.` : `${title} added. It now appears in the Position dropdown.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function togglePosition(form: FormData) {
  await assertRole(HR_ROLES);
  const supabase = await createClient();
  await supabase.from("positions").update({ active: form.get("active") === "1" }).eq("id", String(form.get("id")));
  revalidatePath("/app/settings/masters");
}

// ---------------------------------------------------------------- users
const STAFF_ROLES: Role[] = ["company_admin", "hr_manager", "hr_executive", "payroll", "manager", "interviewer"];

export async function createUser(_: ActionState, form: FormData): Promise<ActionState> {
  if ((process.env.KMR_LICENCE_CHECK || "on").toLowerCase() !== "off") return { error: "Staff users are managed in KMR Apps › Administration › Users & access." };
  try {
    const { user, tenant } = await assertRole(ADMIN_ROLES);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const full_name = String(form.get("full_name") || "").trim();
    const phone = normalizeIndianMobile(String(form.get("phone") || ""));
    const role = String(form.get("role")) as Role;
    const employee_id = String(form.get("employee_id") || "") || null;
    if (!full_name) return { error: "Name is required" };
    if (!isValidEmail(email)) return { error: "Enter a valid email" };
    if (!STAFF_ROLES.includes(role)) return { error: "Choose a role" };

    const db = createAdminClient();
    if (employee_id) {
      const { data: e } = await db.from("employees").select("id").eq("id", employee_id).eq("tenant_id", tenant.id).maybeSingle();
      if (!e) return { error: "Linked employee not found" };
      const { data: taken } = await db.from("app_users").select("id,email").eq("employee_id", employee_id).maybeSingle();
      if (taken) return { error: `That employee already has a login (${taken.email}). Change its role instead.` };
    }
    const password = tempPassword();
    const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
    if (error) return { error: /already/i.test(error.message) ? "A login with this email already exists." : error.message };
    const { error: e2 } = await db.from("app_users").insert({
      id: created.user.id, tenant_id: tenant.id, role, full_name, email, phone, employee_id, must_change_password: true,
    });
    if (e2) { await db.auth.admin.deleteUser(created.user.id); return { error: e2.message }; }

    const origin = await currentOrigin();
    const results = await notify({
      tenant, event: "user_invited", to: { name: full_name, email, phone },
      vars: { role: ROLE_LABELS[role], login_url: `${origin}/login`, username: email, temp_password: password },
    });
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "user.created", entity: "app_users", entityId: created.user.id, data: { role } });
    revalidatePath("/app/settings/users");
    const delivered = results.some((r) => r.status === "sent");
    return {
      ok: `User created. ${describeResults(results)}${delivered ? "" : ` — share this temporary password securely: ${password}`}`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateUser(form: FormData) {
  const { user, tenant } = await assertRole(ADMIN_ROLES);
  const id = String(form.get("id"));
  if (id === user.id) return; // cannot demote or deactivate yourself
  const patch: Record<string, unknown> = {};
  const role = form.get("role");
  if (role && [...STAFF_ROLES, "employee"].includes(String(role))) patch.role = String(role);
  if (form.has("active")) patch.active = form.get("active") === "1";
  const supabase = await createClient();
  await supabase.from("app_users").update(patch).eq("id", id).eq("tenant_id", tenant.id);
  await logAudit({ tenantId: tenant.id, actorId: user.id, action: "user.updated", entity: "app_users", entityId: id, data: patch });
  revalidatePath("/app/settings/users");
}

// ---------------------------------------------------------------- templates
export async function saveTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(["hr_manager"]);
    const event = String(form.get("event")) as NotificationEvent;
    if (!DEFAULT_TEMPLATES[event]) return { error: "Unknown message" };
    const supabase = await createClient();
    if (form.get("reset") === "1") {
      await supabase.from("notification_templates").delete().eq("tenant_id", tenant.id).eq("event", event);
      revalidatePath("/app/settings/templates");
      return { ok: "Restored the default wording." };
    }
    const rows = [
      {
        tenant_id: tenant.id, event, channel: "email",
        subject: String(form.get("subject") || "").slice(0, 200), body: String(form.get("email_body") || "").slice(0, 5000),
        active: form.get("email_on") === "1",
      },
      {
        tenant_id: tenant.id, event, channel: "whatsapp", subject: null,
        body: String(form.get("wa_body") || "").slice(0, 1000),
        wa_template: String(form.get("wa_template") || "").trim() || null,
        active: form.get("wa_on") === "1",
      },
    ];
    if (!rows[0].body || !rows[1].body) return { error: "Message text cannot be empty." };
    const { error } = await supabase.from("notification_templates").upsert(rows, { onConflict: "tenant_id,event,channel" });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "template.updated", entity: "notification_templates", data: { event } });
    revalidatePath("/app/settings/templates");
    return { ok: "Saved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
