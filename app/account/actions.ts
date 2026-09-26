"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export interface FormState { ok?: string; error?: string }

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Please sign in again." };
  const pw = String(form.get("password") || "");
  const confirm = String(form.get("confirm") || "");
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return { error: "Use at least 8 characters with letters and numbers." };
  }
  if (pw !== confirm) return { error: "The two passwords do not match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  await createAdminClient().from("app_users").update({ must_change_password: false }).eq("id", session.user.id);
  await logAudit({ tenantId: session.tenant.id, actorId: session.user.id, action: "password.changed", entity: "app_users", entityId: session.user.id });
  revalidatePath("/account");
  return { ok: "Password updated." };
}

export async function removePasskey(id: string) {
  const session = await getSession();
  if (!session) return;
  const supabase = await createClient();
  await supabase.from("passkeys").delete().eq("id", id).eq("user_id", session.user.id);
  await logAudit({ tenantId: session.tenant.id, actorId: session.user.id, action: "passkey.removed", entity: "passkeys", entityId: id });
  revalidatePath("/account");
}
