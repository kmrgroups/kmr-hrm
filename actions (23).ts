"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentOrigin } from "@/lib/tenant";
import { addDays, isDate, istToday } from "@/lib/attendance/time";
import { fmtDays, leaveYearOf } from "@/lib/leave/rules";
import { cancelLeave, loadBalances, startMonthOf, validateLeave } from "@/lib/leave/service";
import { notifyApprover } from "@/lib/workflow/notify";
import { fmtDate, fullName } from "@/components/ui";
import type { ActionState } from "@/app/app/employees/actions";

async function me() {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (!s.user.employee_id) throw new Error("Your login is not linked to an employee record. Please contact HR.");
  return { ...s, employeeId: s.user.employee_id };
}

export async function applyLeave(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant, employeeId } = await me();
    const half = String(form.get("half_day") ?? "none");
    const input = {
      employeeId, leaveTypeId: String(form.get("leave_type_id") ?? ""),
      from: String(form.get("from_date") ?? ""), to: String(form.get("to_date") || form.get("from_date") || ""),
      half: (["first_half", "second_half"].includes(half) ? half : "none") as "none" | "first_half" | "second_half",
      reason: String(form.get("reason") ?? "").trim().slice(0, 300) || null,
    };
    if (!isDate(input.from) || !isDate(input.to)) return { error: "Choose the dates." };
    if (!input.reason) return { error: "Please add a short reason." };
    const v = await validateLeave(tenant, input, false);
    if ("error" in v) return { error: v.error };

    const supabase = await createClient();   // row-level security: own, pending only
    const { data: req, error } = await supabase.from("leave_requests").insert({
      tenant_id: tenant.id, employee_id: employeeId, leave_type_id: input.leaveTypeId, from_date: input.from, to_date: input.to,
      half_day: input.half, days: v.days, reason: input.reason, created_by: user.id,
    }).select("id").single();
    if (error) return { error: error.message };

    const db = createAdminClient();
    const { data: emp } = await db.from("employees").select("first_name,last_name,employee_code").eq("id", employeeId).single();
    const bal = v.type.requires_balance ? (await loadBalances(db, tenant.id, [employeeId], leaveYearOf(input.from, startMonthOf(tenant)))).get(employeeId)?.get(v.type.id) : null;
    const dates = input.from === input.to ? fmtDate(input.from) + (input.half !== "none" ? ` (${input.half === "first_half" ? "first" : "second"} half)` : "") : `${fmtDate(input.from)} – ${fmtDate(input.to)}`;
    await notifyApprover(tenant, employeeId, "leave_applied", {
      employee: emp ? fullName(emp) : user.full_name, employee_code: emp?.employee_code ?? "", leave_type: v.type.name, dates,
      days: fmtDays(v.days), reason: input.reason, balance: bal ? fmtDays(bal.balance) : "not applicable", link: `${await currentOrigin()}/app/approvals`,
    }, { type: "leave_request", id: req.id });
    revalidatePath("/me/leave");
    return { ok: `Applied for ${fmtDays(v.days)} day(s) of ${v.type.name}. Your manager has been notified.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function cancelMyLeave(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, user, employeeId } = await me();
    const id = String(form.get("id") ?? "");
    const db = createAdminClient();
    const { data: req } = await db.from("leave_requests").select("employee_id,status,from_date").eq("id", id).eq("tenant_id", tenant.id).single();
    if (!req || req.employee_id !== employeeId) return { error: "Request not found." };
    if (req.status === "approved" && req.from_date <= istToday()) return { error: "Leave that has started can only be cancelled by HR." };
    await cancelLeave(tenant, id, user.id);
    revalidatePath("/me/leave");
    return { ok: "Cancelled." };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function requestCorrection(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant, employeeId } = await me();
    const date = String(form.get("work_date") ?? "");
    const inT = String(form.get("in_time") ?? "") || null;
    const outT = String(form.get("out_time") ?? "") || null;
    const reason = String(form.get("reason") ?? "").trim();
    const window = tenant.settings?.employee_can_regularise_days ?? 30;
    const today = istToday();
    if (!isDate(date) || date > today) return { error: "Choose a date up to today." };
    if (window === 0) return { error: "Attendance corrections are handled by HR. Please contact them." };
    if (date < addDays(today, -window)) return { error: `Corrections are allowed for the last ${window} days only. Please contact HR.` };
    if (!inT && !outT) return { error: "Enter the in time, the out time, or both." };
    if (reason.length < 3) return { error: "Please explain what happened, e.g. forgot to punch out." };
    const supabase = await createClient();
    const { data: open } = await supabase.from("regularisation_requests").select("id").eq("employee_id", employeeId).eq("work_date", date).eq("status", "pending").limit(1);
    if (open?.length) return { error: "You already have a pending correction for that day." };
    const { data: req, error } = await supabase.from("regularisation_requests").insert({
      tenant_id: tenant.id, employee_id: employeeId, work_date: date, in_time: inT, out_time: outT, reason: reason.slice(0, 500), created_by: user.id,
    }).select("id").single();
    if (error) return { error: error.message };
    const { data: emp } = await createAdminClient().from("employees").select("first_name,last_name,employee_code").eq("id", employeeId).single();
    await notifyApprover(tenant, employeeId, "regularisation_applied", {
      employee: emp ? fullName(emp) : user.full_name, employee_code: emp?.employee_code ?? "", date: fmtDate(date),
      in_time: inT ?? "—", out_time: outT ?? "—", reason, link: `${await currentOrigin()}/app/approvals`,
    }, { type: "regularisation", id: req.id });
    revalidatePath("/me/attendance");
    return { ok: "Correction sent to your manager." };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function cancelCorrection(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenant, employeeId } = await me();
    await createAdminClient().from("regularisation_requests").update({ status: "cancelled" })
      .eq("id", String(form.get("id") ?? "")).eq("tenant_id", tenant.id).eq("employee_id", employeeId).eq("status", "pending");
    revalidatePath("/me/attendance");
    return { ok: "Cancelled." };
  } catch (e) { return { error: (e as Error).message }; }
}
