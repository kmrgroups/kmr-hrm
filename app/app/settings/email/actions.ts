"use server";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt, getMailbox, testMailbox } from "@/lib/company-mail";
import { isValidEmail } from "@/lib/validators";
import { logAudit } from "@/lib/audit";
import type { ActionState } from "@/app/app/employees/actions";

const ROLES = ["hr_manager" as const];

/** Tests the mailbox (login + a test email to the person saving), then stores it. Nothing is saved if the test fails. */
export async function saveCompanyEmail(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(ROLES);
    const g = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
    const from_email = g("from_email").toLowerCase(), from_name = g("from_name", 80) || null, host = g("host").toLowerCase();
    const port = Number(g("port")), secure = port === 465 ? true : g("secure") === "on";
    const username = g("username") || from_email;
    let password = String(form.get("password") ?? "");
    if (!isValidEmail(from_email)) return { error: "Enter the email address to send from, e.g. hr@yourcompany.com." };
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { error: "Enter the mail server name, e.g. smtp.gmail.com." };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Enter the port (usually 465 or 587)." };
    const existing = await getMailbox(tenant.id);
    let password_enc: string;
    if (password) password_enc = encrypt(password);
    else if (existing && existing.host === host && existing.username === username) {
      password_enc = existing.password_enc;
      password = decrypt(existing.password_enc);   // keep the saved password when the field is left blank
    } else return { error: "Enter the mailbox password (or App password)." };

    const to = user.email || from_email;
    await testMailbox({ host, port, secure, username, from_email, from_name }, password, to, tenant.name);

    const { error } = await createAdminClient().from("tenant_mail").upsert({
      tenant_id: tenant.id, from_email, from_name, host, port, secure, username, password_enc,
      verified_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(), updated_by: user.id,
    });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "company_email.connected", entity: "tenant_mail", entityId: tenant.id, data: { from_email, host } });
    revalidatePath("/app/settings/email");
    return { ok: `Connected. A test email was sent to ${to}. From now on HR emails go out from ${from_email}.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function disconnectCompanyEmail(_: ActionState, _form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(ROLES);
    await createAdminClient().from("tenant_mail").delete().eq("tenant_id", tenant.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "company_email.disconnected", entity: "tenant_mail", entityId: tenant.id });
    revalidatePath("/app/settings/email");
    return { ok: "Disconnected. HR emails are paused until a mailbox is connected again (WhatsApp still works)." };
  } catch (e) { return { error: (e as Error).message }; }
}
