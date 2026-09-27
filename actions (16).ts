"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { ActionState } from "@/app/app/employees/actions";

const PATH = "/app/settings/leave";
const bool = z.union([z.literal("1"), z.literal("on")]).optional().transform((v) => !!v);

const typeSchema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "Code: 1–6 letters or digits, e.g. CL"),
  name: z.string().trim().min(2, "Name is required").max(40),
  annual_quota: z.coerce.number().min(0).max(365),
  accrual: z.enum(["yearly", "monthly", "none"]),
  carry_forward_max: z.coerce.number().min(0).max(365),
  min_notice_days: z.coerce.number().int().min(0).max(90),
  max_days_per_request: z.string().trim().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (v > 0 && v <= 365), "Maximum per request must be between 1 and 365"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch("#2563EB"),
  sort_order: z.coerce.number().int().min(0).max(999).catch(100),
  requires_balance: bool, paid: bool, allow_half_day: bool, count_non_working: bool,
});

export async function saveLeaveType(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const parsed = typeSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { id, ...row } = parsed.data;
    if (!row.requires_balance && row.accrual !== "none") row.accrual = "none";
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("leave_types").update(row).eq("id", id)
      : await supabase.from("leave_types").insert({ ...row, tenant_id: tenant.id });
    if (error) return { error: /duplicate/.test(error.message) ? `Code ${row.code} is already used.` : error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: id ? "leave_type.updated" : "leave_type.created", entity: "leave_types", entityId: id || null, data: row });
    revalidatePath(PATH);
    return { ok: id ? `${row.name} updated. New credits use the new quota; existing credits are unchanged.` : `${row.name} added.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function toggleLeaveType(form: FormData) {
  const { tenant } = await assertRole(HR_ROLES);
  const supabase = await createClient();
  await supabase.from("leave_types").update({ active: form.get("active") === "1" }).eq("id", String(form.get("id"))).eq("tenant_id", tenant.id);
  revalidatePath(PATH);
}

export async function saveLeaveYear(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const m = Number(form.get("leave_year_start_month"));
    if (!(m >= 1 && m <= 12)) return { error: "Choose a month." };
    const db = createAdminClient();
    if (m !== (tenant.settings?.leave_year_start_month ?? 1)) {
      const { count } = await db.from("leave_ledger").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
      if (count) return { error: "The leave year cannot be changed after leave has been credited. Contact support to migrate balances." };
    }
    const { error } = await db.from("tenants").update({ settings: { ...tenant.settings, leave_year_start_month: m } }).eq("id", tenant.id);
    if (error) return { error: error.message };
    revalidateTag("tenant");
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "leave.year_changed", entity: "tenants", entityId: tenant.id, data: { start_month: m } });
    revalidatePath(PATH);
    return { ok: "Leave year saved." };
  } catch (e) { return { error: (e as Error).message }; }
}
