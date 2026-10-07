"use server";
import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import type { ActionState } from "@/app/app/employees/actions";

/** the employee confirms he has read the current revision of a policy */
export async function acknowledgePolicy(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertUser();
    if (!s.user.employee_id) return { error: "This is for employees." };
    const vid = String(f.get("version_id") ?? "");
    if (!/^[0-9a-f-]{36}$/.test(vid)) return { error: "Not found." };
    const db = await createClient();
    const { error } = await db.from("document_acks").upsert({ tenant_id: s.tenant.id, version_id: vid, employee_id: s.user.employee_id }, { onConflict: "version_id,employee_id", ignoreDuplicates: true });
    if (error) return { error: error.message.includes("row-level") ? "This revision is no longer current — please reopen the page." : error.message };
    revalidatePath("/me/policies"); revalidatePath("/me");
    await setFlash({ ok: "Thank you — acknowledged." });
    return { ok: "Thank you — acknowledged.", flashed: true };
  } catch (e) { return { error: (e as Error).message }; }
}
