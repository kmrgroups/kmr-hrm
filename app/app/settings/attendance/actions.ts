"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/tokens";
import { recomputeAttendance } from "@/lib/attendance/service";
import { addDays, istToday } from "@/lib/attendance/time";
import type { ActionState } from "@/app/app/employees/actions";

const PATH = "/app/settings/attendance";
const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const time = z.string().regex(/^\d{2}:\d{2}$/, "Times look like 09:00");
const mins = (min: number, max: number, label: string) => z.coerce.number().int().min(min, `${label}: at least ${min}`).max(max, `${label}: at most ${max}`);

const shiftSchema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, "Shift code: 1–4 letters or digits"),
  name: z.string().trim().min(2, "Shift name is required").max(40),
  start_time: time, end_time: time,
  break_minutes: mins(0, 240, "Break"),
  grace_in_minutes: mins(0, 120, "Late grace"),
  grace_out_minutes: mins(0, 120, "Early-leaving grace"),
  half_day_minutes: mins(60, 900, "Half day"),
  full_day_minutes: mins(60, 1200, "Full day"),
}).refine((s) => s.half_day_minutes < s.full_day_minutes, "Half-day hours must be less than full-day hours")
  .refine((s) => s.start_time !== s.end_time, "Start and end time cannot be the same");

export async function saveShift(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const parsed = shiftSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { id, ...row } = parsed.data;
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("shifts").update(row).eq("id", id)
      : await supabase.from("shifts").insert({ ...row, tenant_id: tenant.id });
    if (error) return { error: /duplicate/.test(error.message) ? `Shift code ${row.code} is already used.` : error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: id ? "shift.updated" : "shift.created", entity: "shifts", entityId: id || null, data: row });
    revalidatePath(PATH);
    return { ok: id ? "Shift updated. Recalculate attendance on the Attendance page if past days should use the new timings." : `Shift ${row.code} added.` };
  } catch (e) { return fail(e); }
}

export async function toggleShift(form: FormData) {
  const { tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
  const supabase = await createClient();
  await supabase.from("shifts").update({ active: form.get("active") === "1" }).eq("id", String(form.get("id"))).eq("tenant_id", tenant.id);
  revalidatePath(PATH);
}

const holidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  name: z.string().trim().min(2, "Holiday name is required").max(60),
  plant_id: z.string().uuid().or(z.literal("")).transform((v) => v || null),
});

export async function addHoliday(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const parsed = holidaySchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from("holidays").insert({ ...parsed.data, tenant_id: tenant.id });
    if (error) return { error: /duplicate/.test(error.message) ? "There is already a holiday on that date." : error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "holiday.added", entity: "holidays", data: parsed.data });
    if (parsed.data.holiday_date <= istToday()) await recomputeAttendance(tenant.id, "all", parsed.data.holiday_date, parsed.data.holiday_date);
    revalidatePath(PATH);
    return { ok: `${parsed.data.name} added.` };
  } catch (e) { return fail(e); }
}

export async function deleteHoliday(form: FormData) {
  const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
  const supabase = await createClient();
  const { data } = await supabase.from("holidays").delete().eq("id", String(form.get("id"))).eq("tenant_id", tenant.id).select("holiday_date,name");
  if (data?.[0]) {
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "holiday.removed", entity: "holidays", data: data[0] });
    if (data[0].holiday_date <= istToday()) await recomputeAttendance(tenant.id, "all", data[0].holiday_date, data[0].holiday_date);
  }
  revalidatePath(PATH);
}

/** Copies last year's holiday list to next year with the same day and month (HR then fixes moving festivals) */
export async function copyHolidays(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const year = Number(form.get("year"));
    if (!(year > 2000 && year < 2100)) return { error: "Choose a year." };
    const supabase = await createClient();
    const { data: src } = await supabase.from("holidays").select("plant_id,holiday_date,name").gte("holiday_date", `${year - 1}-01-01`).lte("holiday_date", `${year - 1}-12-31`);
    if (!src?.length) return { error: `No holidays found in ${year - 1} to copy.` };
    const rows = src.filter((h) => h.holiday_date.slice(5) !== "02-29").map((h) => ({ tenant_id: tenant.id, plant_id: h.plant_id, name: h.name, holiday_date: `${year}${h.holiday_date.slice(4)}` }));
    const { data, error } = await supabase.from("holidays").upsert(rows, { onConflict: "tenant_id,plant_id,holiday_date", ignoreDuplicates: true }).select("id");
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "holiday.copied", entity: "holidays", data: { year, count: data?.length ?? 0 } });
    revalidatePath(PATH);
    return { ok: `${data?.length ?? 0} holidays copied to ${year}. Check festivals whose date changes every year.` };
  } catch (e) { return fail(e); }
}

const deviceSchema = z.object({
  name: z.string().trim().min(2, "Give the device a name, e.g. Main gate").max(60),
  kind: z.enum(["api", "adms"]),
  serial_no: z.string().trim().toUpperCase().max(40).optional().transform((v) => v || null),
  plant_id: z.string().uuid().or(z.literal("")).transform((v) => v || null),
});

export async function addDevice(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const parsed = deviceSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.kind === "adms" && !d.serial_no) return { error: "Enter the device serial number (Menu → System info on the device)." };
    const key = d.kind === "api" ? `hrm_${randomToken(24)}` : null;
    const supabase = await createClient();
    const { error } = await supabase.from("attendance_devices").insert({ ...d, tenant_id: tenant.id, key_hash: key ? hashToken(key) : null });
    if (error) return { error: /serial_no/.test(error.message) ? "A device with this serial number is already registered." : error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "device.added", entity: "attendance_devices", data: { name: d.name, kind: d.kind, serial_no: d.serial_no } });
    revalidatePath(PATH);
    return key
      ? { ok: `Device added. Its API key is shown only now — copy it into the bridge software: ${key}` }
      : { ok: `Device added. Set its cloud server (ADMS) address as shown below; punches appear here within a minute.` };
  } catch (e) { return fail(e); }
}

export async function toggleDevice(form: FormData) {
  const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
  const supabase = await createClient();
  const active = form.get("active") === "1";
  await supabase.from("attendance_devices").update({ active }).eq("id", String(form.get("id"))).eq("tenant_id", tenant.id);
  await logAudit({ tenantId: tenant.id, actorId: user.id, action: active ? "device.enabled" : "device.disabled", entity: "attendance_devices", entityId: String(form.get("id")) });
  revalidatePath(PATH);
}

export async function saveAttendanceOptions(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const ot = Number(form.get("ot_min_minutes"));
    const reg = Number(form.get("employee_can_regularise_days"));
    if (!(ot >= 0 && ot <= 240)) return { error: "Minimum overtime must be between 0 and 240 minutes." };
    if (!(reg >= 0 && reg <= 90)) return { error: "Correction window must be between 0 and 90 days." };
    // HR owns these two policy values; company branding stays admin-only (so only these keys are merged).
    const { error } = await createAdminClient().from("tenants").update({ settings: { ...tenant.settings, ot_min_minutes: ot, employee_can_regularise_days: reg } }).eq("id", tenant.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "attendance.options_changed", entity: "tenants", entityId: tenant.id, data: { ot, reg } });
    revalidateTag("tenant");
    if (ot !== (tenant.settings?.ot_min_minutes ?? 30)) await recomputeAttendance(tenant.id, "all", addDays(istToday(), -31), istToday());
    revalidatePath(PATH);
    return { ok: "Options saved." };
  } catch (e) { return fail(e); }
}
