"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSeat } from "@/lib/licence";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentOrigin } from "@/lib/tenant";
import { approveOnboarding, sendBackOnboarding, sendOnboardingLink } from "@/lib/onboarding";
import { describeResults, notify } from "@/lib/notify";
import { isValidEmail, normalizeIndianMobile } from "@/lib/validators";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";

/** Result shown at the top of the page because the form that triggered it disappears. */
async function flash(state: ActionState): Promise<ActionState> {
  await setFlash({ ok: state.ok, link: state.link });
  return { ...state, flashed: true };
}
import { fullName } from "@/components/ui";

export interface ActionState { ok?: string; error?: string; link?: string; employeeId?: string; flashed?: boolean }

const uuidOrEmpty = z.string().uuid().or(z.literal("")).transform((v) => v || null);

const employeeSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(80),
  last_name: z.string().trim().max(80).optional().transform((v) => v || null),
  email: z.string().trim().toLowerCase().refine(isValidEmail, "Enter a valid email"),
  mobile: z.string().trim().refine((v) => !!normalizeIndianMobile(v), "Enter a valid 10-digit mobile").transform((v) => normalizeIndianMobile(v)!),
  designation_id: uuidOrEmpty,
  department_id: uuidOrEmpty,
  plant_id: uuidOrEmpty,
  reporting_manager_id: uuidOrEmpty,
  employment_type: z.enum(["permanent", "probation", "fixed_term", "trainee", "apprentice", "contract"]),
  category: z.enum(["staff", "workman", "management"]),
  date_of_joining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).transform((v) => v || null),
});

/** Adds a new joiner and sends the self-onboarding link on email + WhatsApp. */
export async function createEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    await assertSeat(tenant.id);
    const parsed = employeeSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const supabase = await createClient();

    const { data: dup } = await supabase.from("employees").select("id,first_name,status").eq("email", parsed.data.email).maybeSingle();
    if (dup) return { error: `${dup.first_name} already uses this email (status: ${dup.status}).` };

    const { data: emp, error } = await supabase.from("employees")
      .insert({ ...parsed.data, tenant_id: tenant.id, status: "invited", created_by: user.id })
      .select("id").single();
    if (error) return { error: error.message };

    const sendNow = form.get("send_link") !== "no";
    if (!sendNow) {
      revalidatePath("/app/employees");
      return { ok: "Employee added. Send the onboarding link when ready.", employeeId: emp.id };
    }
    const { link, results } = await sendOnboardingLink({
      tenant, employeeId: emp.id, actorId: user.id, actorName: user.full_name, origin: await currentOrigin(),
    });
    revalidatePath("/app/employees");
    return { ok: `Onboarding link sent. ${describeResults(results)}`, link, employeeId: emp.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateJobDetails(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertRole(HR_ROLES);
    const id = String(form.get("id"));
    const parsed = employeeSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (parsed.data.reporting_manager_id === id) return { error: "An employee cannot report to themselves." };
    const supabase = await createClient();
    const { error } = await supabase.from("employees").update(parsed.data).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath(`/app/employees/${id}`);
    return { ok: "Saved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function resendLink(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const id = String(form.get("id"));
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("status").eq("id", id).single();
    if (!emp || !["invited", "onboarding", "sent_back", "inactive"].includes(emp.status)) {
      return { error: "A link can only be sent before the form is submitted." };
    }
    const { link, results } = await sendOnboardingLink({
      tenant, employeeId: id, actorId: user.id, actorName: user.full_name, origin: await currentOrigin(),
      reminder: form.get("reminder") === "1",
    });
    revalidatePath(`/app/employees/${id}`);
    return { ok: `New link sent (the previous link no longer works). ${describeResults(results)}`, link };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function approve(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const id = String(form.get("id"));
    const doj = String(form.get("date_of_joining") || "") || null;
    const { code, results, password } = await approveOnboarding({ tenant, employeeId: id, actorId: user.id, origin: await currentOrigin(), dateOfJoining: doj });
    revalidatePath(`/app/employees/${id}`);
    revalidatePath("/app");
    const delivered = results.some((r) => r.status === "sent");
    return flash({
      ok: `Approved. Employee ID ${code} created, login and ID card issued. ${describeResults(results)}` +
        (delivered ? "" : ` — the message could not be delivered, so share this temporary password with the employee in person: ${password}`),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function sendBack(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const id = String(form.get("id"));
    const sections = form.getAll("sections").map(String);
    const comment = String(form.get("comment") || "").trim().slice(0, 500);
    if (!sections.length) return { error: "Choose at least one section to send back." };
    if (!comment) return { error: "Add a comment so the employee knows what to fix." };
    const { results, link } = await sendBackOnboarding({
      tenant, employeeId: id, actorId: user.id, actorName: user.full_name, origin: await currentOrigin(), sections, comment,
    });
    revalidatePath(`/app/employees/${id}`);
    return flash({ ok: `Sent back for correction. ${describeResults(results)}`, link });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setDocumentStatus(form: FormData) {
  const { user, tenant } = await assertRole(HR_ROLES);
  const docId = String(form.get("doc_id"));
  const status = String(form.get("status"));
  if (!["approved", "rejected", "uploaded"].includes(status)) return;
  const supabase = await createClient();
  const { data } = await supabase.from("employee_documents").update({ status }).eq("id", docId).select("employee_id").single();
  await logAudit({ tenantId: tenant.id, actorId: user.id, action: `document.${status}`, entity: "employee_documents", entityId: docId });
  if (data) revalidatePath(`/app/employees/${data.employee_id}`);
}

/** Deactivate (or reactivate) an employee: blocks login and marks the ID card QR as inactive. */
export async function setActive(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const id = String(form.get("id"));
    const active = form.get("active") === "1";
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("status,employee_code").eq("id", id).single();
    if (!emp) return { error: "Not found" };
    if (active && !emp.employee_code) return { error: "This employee has not completed onboarding." };
    await supabase.from("employees").update({ status: active ? "active" : "inactive" }).eq("id", id);
    await createAdminClient().from("app_users").update({ active }).eq("employee_id", id).eq("tenant_id", tenant.id);
    await createAdminClient().from("id_cards").update({ status: active ? "active" : "revoked" }).eq("employee_id", id).eq("status", active ? "revoked" : "active");
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: active ? "employee.reactivated" : "employee.deactivated", entity: "employees", entityId: id });
    revalidatePath(`/app/employees/${id}`);
    return flash({ ok: active ? "Employee reactivated." : "Employee deactivated. Login is blocked and the ID card shows as inactive." });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Re-issue the ID card (lost / damaged / details changed) */
export async function reissueCard(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const id = String(form.get("id"));
    const reason = String(form.get("reason") || "reissue").slice(0, 40);
    const db = createAdminClient();
    const { data: emp } = await db.from("employees").select("*").eq("id", id).eq("tenant_id", tenant.id).single();
    if (!emp || emp.status !== "active") return { error: "Only active employees can be issued a card." };
    const { data: last } = await db.from("id_cards").select("version").eq("employee_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
    await db.from("id_cards").update({ status: "replaced" }).eq("employee_id", id).eq("status", "active");
    // A new QR token invalidates the old printed card
    await db.from("employees").update({ verify_token: crypto.randomUUID().replace(/-/g, "") }).eq("id", id);
    const valid = new Date();
    valid.setFullYear(valid.getFullYear() + (tenant.settings?.id_card_validity_years ?? 3));
    await db.from("id_cards").insert({
      tenant_id: tenant.id, employee_id: id, version: (last?.version ?? 0) + 1, valid_until: valid.toISOString().slice(0, 10), issued_by: user.id, reason,
    });
    const origin = await currentOrigin();
    await notify({
      tenant, event: "id_card_issued", to: { name: fullName(emp), email: emp.email, phone: emp.mobile },
      vars: { employee_code: emp.employee_code, link: `${origin}/me` }, related: { type: "employee", id },
    });
    revalidatePath(`/app/employees/${id}`);
    return { ok: "New ID card issued. The old card's QR code no longer verifies." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
