"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ingestPunches, recomputeAttendance } from "@/lib/attendance/service";
import { normalizeAttendanceId, parseCsv } from "@/lib/attendance/parse";
import { addDays, isDate, istInstant, istToday, toMinutes } from "@/lib/attendance/time";
import type { ActionState } from "@/app/app/employees/actions";

const fail = (e: unknown): ActionState => ({ error: (e as Error).message });

/** CSV / TSV export from the biometric software */
export async function importPunches(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose the file exported from the biometric software." };
    if (file.size > 5 * 1024 * 1024) return { error: "The file is larger than 5 MB. Please export a shorter date range." };
    const { rows, errors } = parseCsv(await file.text());
    if (!rows.length) return { error: errors[0] ?? "No punches found in the file." };
    const r = await ingestPunches(tenant.id, rows, "csv", null, user.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "attendance.imported", entity: "attendance_punches", data: { file: file.name, rows: rows.length, new: r.inserted, unmatched: r.unmatched } });
    revalidatePath("/app/attendance", "layout");
    const parts = [`${rows.length} punches read, ${r.inserted} new`, `${rows.length - r.inserted} already stored`];
    if (r.unmatched) parts.push(`${r.unmatched} not matched to an employee (see the list below)`);
    if (errors.length) parts.push(`${errors.length} line(s) skipped: ${errors.slice(0, 2).join("; ")}`);
    return { ok: parts.join(" · ") + "." };
  } catch (e) { return fail(e); }
}

/** Re-runs the attendance rules for a date range (after changing shifts, holidays or rules) */
export async function recomputeRange(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const from = String(form.get("from") ?? ""), to = String(form.get("to") ?? from);
    if (!isDate(from) || !isDate(to) || to < from) return { error: "Choose a valid date range." };
    if (to > addDays(from, 62)) return { error: "Recalculate up to two months at a time." };
    const emp = String(form.get("employee_id") ?? "");
    const n = await recomputeAttendance(tenant.id, emp ? [emp] : "all", from, to);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "attendance.recalculated", entity: "attendance_days", entityId: emp || null, data: { from, to } });
    revalidatePath("/app/attendance", "layout");
    return { ok: `Recalculated ${n} day record(s).` };
  } catch (e) { return fail(e); }
}

/** HR adds a missing punch by hand (e.g. device was down) */
export async function addManualPunch(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const employeeId = String(form.get("employee_id") ?? "");
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const nextDay = form.get("next_day") === "1";
    if (!isDate(date) || !/^\d{2}:\d{2}$/.test(time)) return { error: "Enter the date and time of the punch." };
    if (date > istToday()) return { error: "Punches cannot be added for future dates." };
    const db = createAdminClient();
    const { data: emp } = await db.from("employees").select("id,attendance_id,employee_code").eq("id", employeeId).eq("tenant_id", tenant.id).single();
    if (!emp) return { error: "Employee not found." };
    const att = emp.attendance_id ?? emp.employee_code ?? `emp:${emp.id}`;
    if (!emp.attendance_id && !emp.employee_code) await db.from("employees").update({ attendance_id: att }).eq("id", emp.id);
    const at = new Date(istInstant(date, toMinutes(time) + (nextDay ? 1440 : 0))).toISOString();
    const r = await ingestPunches(tenant.id, [{ attendance_id: att, punched_at: at }], "manual", null, user.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "attendance.manual_punch", entity: "employees", entityId: emp.id, data: { at, reason: String(form.get("reason") ?? "") } });
    revalidatePath("/app/attendance", "layout");
    return r.inserted ? { ok: "Punch added and the day recalculated." } : { error: "That punch is already recorded." };
  } catch (e) { return fail(e); }
}

const settingsSchema = z.object({
  id: z.string().uuid(),
  attendance_id: z.string().trim().max(30).transform((v) => (v ? normalizeAttendanceId(v) : null)),
  shift_id: z.string().uuid().or(z.literal("")).transform((v) => v || null),
});

/** Device user ID, shift and weekly offs on the employee record */
export async function saveEmployeeAttendance(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES);
    const parsed = settingsSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const offs = form.getAll("weekly_offs").map(Number).filter((n) => n >= 0 && n <= 6);
    const db = createAdminClient();
    if (parsed.data.attendance_id) {
      const { data: clash } = await db.from("employees").select("first_name,last_name,employee_code").eq("tenant_id", tenant.id)
        .eq("attendance_id", parsed.data.attendance_id).neq("id", parsed.data.id).maybeSingle();
      if (clash) return { error: `Device ID ${parsed.data.attendance_id} already belongs to ${clash.first_name} ${clash.last_name ?? ""} (${clash.employee_code ?? "no code"}).` };
    }
    const { error } = await db.from("employees").update({ attendance_id: parsed.data.attendance_id, shift_id: parsed.data.shift_id, weekly_offs: offs })
      .eq("id", parsed.data.id).eq("tenant_id", tenant.id);
    if (error) return { error: error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "attendance.settings_changed", entity: "employees", entityId: parsed.data.id, data: { ...parsed.data, weekly_offs: offs } });
    // Earlier punches for this device ID are now linked (database trigger); recalculate the last 45 days.
    const today = istToday();
    await recomputeAttendance(tenant.id, [parsed.data.id], addDays(today, -45), today);
    revalidatePath(`/app/employees/${parsed.data.id}`);
    return { ok: "Attendance settings saved; the last 45 days were recalculated." };
  } catch (e) { return fail(e); }
}
