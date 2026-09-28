"use server";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { recomputeAttendance } from "@/lib/attendance/service";
import { addDays, istToday } from "@/lib/attendance/time";
import { saveNightlyBackup } from "@/lib/data-tools";
import type { ActionState } from "@/app/app/employees/actions";

const fail = (e: unknown): ActionState => ({ error: (e as Error).message });

export async function loadSampleData(_: ActionState): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(["hr_manager"]);
    const { data, error } = await createAdminClient().rpc("demo_load", { p_tenant: tenant.id });
    if (error) return { error: error.message };
    await recomputeAttendance(tenant.id, "all", addDays(istToday(), -31), addDays(istToday(), -1));
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "data.sample_loaded", entity: "tenants", entityId: tenant.id });
    revalidatePath("/app", "layout");
    return { ok: `Sample data loaded: ${data} employees in two plants with a month of attendance, leave balances and pending requests.` };
  } catch (e) { return fail(e); }
}

export async function flushSampleData(_: ActionState): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(["hr_manager"]);
    const { data, error } = await createAdminClient().rpc("demo_flush", { p_tenant: tenant.id });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "data.sample_flushed", entity: "tenants", entityId: tenant.id });
    revalidatePath("/app", "layout");
    return { ok: `Sample data removed (${data} sample employees and everything linked to them). Your real data is untouched.` };
  } catch (e) { return fail(e); }
}

export async function importCompanyJson(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(["hr_manager"]);
    if (form.get("confirm") !== tenant.name) return { error: `Type the company name "${tenant.name}" exactly to confirm the restore.` };
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a backup (.json) file." };
    if (file.size > 60 * 1024 * 1024) return { error: "The file is larger than 60 MB." };
    let json: unknown;
    try { json = JSON.parse(await file.text()); } catch { return { error: "That file is not valid JSON." }; }
    await saveNightlyBackup(tenant.id, `${istToday()}`);      // safety copy of the current data first
    const { data, error } = await createAdminClient().rpc("company_import", { p_tenant: tenant.id, p_data: json });
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "data.restored", entity: "tenants", entityId: tenant.id, data: { file: file.name, rows: data } });
    revalidatePath("/app", "layout");
    const d = data as Record<string, number>;
    return { ok: `Restored: ${d.employees ?? 0} employees, ${d.attendance_punches ?? 0} punches, ${d.leave_ledger ?? 0} leave entries. A copy of the data before the restore was saved under today's backup.` };
  } catch (e) { return fail(e); }
}
