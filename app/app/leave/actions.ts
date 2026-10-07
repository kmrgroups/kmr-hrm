"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { currentOrigin } from "@/lib/tenant";
import { istToday } from "@/lib/attendance/time";
import { leaveYearOf, fmtDays } from "@/lib/leave/rules";
import { applyCredits, approveLeave, closeLeaveYear, loadLeaveTypes, startMonthOf, validateLeave } from "@/lib/leave/service";
import { notifyEmployee } from "@/lib/workflow/notify";
import { fmtDate } from "@/components/ui";
import type { ActionState } from "@/app/app/employees/actions";

const fail = (e: unknown): ActionState => ({ error: (e as Error).message });

export async function runCredits(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const year = Number(form.get("year"));
    const n = await applyCredits(tenant.id, year, istToday(), user.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "leave.credits_applied", entity: "leave_ledger", data: { year, entries: n } });
    revalidatePath("/app/leave");
    return { ok: n ? `${n} credit(s) added.` : "Everyone already has the credits due so far." };
  } catch (e) { return fail(e); }
}

export async function closeYear(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(["hr_manager"], "hrm.attendance-shifts-leave");
    const year = Number(form.get("year"));
    if (year >= leaveYearOf(istToday(), startMonthOf(tenant))) return { error: "Only a finished leave year can be closed." };
    const r = await closeLeaveYear(tenant.id, year, user.id);
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "leave.year_closed", entity: "leave_ledger", data: { year, ...r } });
    revalidatePath("/app/leave");
    return { ok: `Year closed: ${r.carried} balance(s) carried forward, ${r.lapsed} lapsed.` };
  } catch (e) { return fail(e); }
}

const adjustSchema = z.object({
  employee_id: z.string().uuid("Choose an employee"),
  leave_type_id: z.string().uuid("Choose a leave type"),
  kind: z.enum(["adjustment", "opening"]),
  days: z.coerce.number().refine((v) => v !== 0 && Math.abs(v) <= 365 && Math.round(v * 2) === v * 2, "Days must be a non-zero multiple of 0.5"),
  note: z.string().trim().min(3, "Add a note explaining the change").max(200),
});

/** Opening balance (when moving from another system), comp-off grant or correction */
export async function adjustBalance(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const parsed = adjustSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const year = Number(form.get("year")) || leaveYearOf(istToday(), startMonthOf(tenant));
    const db = createAdminClient();
    const { data: emp } = await db.from("employees").select("id").eq("id", d.employee_id).eq("tenant_id", tenant.id).single();
    if (!emp) return { error: "Employee not found." };
    { const { data: lt } = await db.from("leave_types").select("id").eq("id", d.leave_type_id).eq("tenant_id", tenant.id).maybeSingle(); if (!lt) return { error: "Leave type not found." }; }
    const { error } = await db.from("leave_ledger").insert({ tenant_id: tenant.id, employee_id: d.employee_id, leave_type_id: d.leave_type_id, leave_year: year,
      kind: d.kind, days: d.days, note: d.note, created_by: user.id, period: d.kind === "opening" ? `opening-${year}` : null });
    if (error) return { error: /duplicate/.test(error.message) ? "An opening balance is already set for this person and leave type. Use an adjustment instead." : error.message };
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "leave.balance_adjusted", entity: "employees", entityId: d.employee_id, data: { ...d, year } });
    revalidatePath("/app/leave");
    return { ok: `${d.days > 0 ? "Added" : "Deducted"} ${fmtDays(Math.abs(d.days))} day(s).` };
  } catch (e) { return fail(e); }
}

/**
 * Opening balances from a CSV: first column employee code, then one column per leave code.
 *   Employee Code,CL,SL,EL
 *   KMR-0001,4,6,22.5
 */
export async function importOpeningBalances(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a CSV file." };
    const year = Number(form.get("year"));
    const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { error: "The file needs a header row and at least one employee." };
    const head = lines[0].split(",").map((h) => h.trim().toUpperCase());
    const db = createAdminClient();
    const types = await loadLeaveTypes(db, tenant.id, false);
    const cols = head.slice(1).map((h) => types.find((t) => t.code === h));
    const unknown = head.slice(1).filter((h, i) => !cols[i]);
    if (unknown.length) return { error: `Unknown leave code(s) in the header: ${unknown.join(", ")}. Use the codes from Leave policy.` };
    const { data: emps } = await db.from("employees").select("id,employee_code").eq("tenant_id", tenant.id).not("employee_code", "is", null).limit(20000);
    const byCode = new Map((emps ?? []).map((e) => [String(e.employee_code).toUpperCase(), e.id]));
    const rows: Record<string, unknown>[] = [];
    const missing: string[] = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(",").map((c) => c.trim());
      const id = byCode.get(cells[0].toUpperCase());
      if (!id) { missing.push(cells[0]); continue; }
      cols.forEach((t, i) => {
        const v = Number(cells[i + 1]);
        if (t && cells[i + 1] !== "" && Number.isFinite(v) && v !== 0) rows.push({ tenant_id: tenant.id, employee_id: id, leave_type_id: t.id, leave_year: year, kind: "opening", days: v, period: `opening-${year}`, note: "Opening balance (import)", created_by: user.id });
      });
    }
    let added = 0, skipped = 0;
    for (const r of rows) {
      const { error } = await db.from("leave_ledger").insert(r);
      if (error) { if (/duplicate/.test(error.message)) skipped++; else return { error: error.message }; } else added++;
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "leave.opening_imported", entity: "leave_ledger", data: { year, added, skipped, missing: missing.length } });
    revalidatePath("/app/leave");
    const parts = [`${added} opening balance(s) set`];
    if (skipped) parts.push(`${skipped} already had an opening balance (unchanged)`);
    if (missing.length) parts.push(`employee code(s) not found: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}`);
    return { ok: parts.join(" · ") + "." };
  } catch (e) { return fail(e); }
}

/** HR records leave for someone (e.g. workmen without portal access, or after the fact). Approved straight away. */
export async function recordLeave(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await assertRole(HR_ROLES, "hrm.attendance-shifts-leave");
    const input = {
      employeeId: String(form.get("employee_id") ?? ""), leaveTypeId: String(form.get("leave_type_id") ?? ""),
      from: String(form.get("from_date") ?? ""), to: String(form.get("to_date") || form.get("from_date") || ""),
      half: (["first_half", "second_half"].includes(String(form.get("half_day"))) ? form.get("half_day") : "none") as "none",
      reason: String(form.get("reason") ?? "").trim() || null,
    };
    if (!input.employeeId) return { error: "Choose an employee." };
    const v = await validateLeave(tenant, input, true);
    if ("error" in v) return { error: v.error };
    const db = createAdminClient();
    const { data: req, error } = await db.from("leave_requests").insert({ tenant_id: tenant.id, employee_id: input.employeeId, leave_type_id: input.leaveTypeId,
      from_date: input.from, to_date: input.to, half_day: input.half, days: v.days, reason: input.reason, created_by: user.id }).select("id").single();
    if (error) return { error: error.message };
    await approveLeave(tenant, req.id, user.id, "Recorded by HR");
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: "leave.recorded", entity: "leave_requests", entityId: req.id, data: { ...input, days: v.days } });
    const dates = input.from === input.to ? fmtDate(input.from) : `${fmtDate(input.from)} – ${fmtDate(input.to)}`;
    await notifyEmployee(tenant, input.employeeId, "leave_decided", { leave_type: v.type.name, dates, days: fmtDays(v.days), decision: "approved", approver: user.full_name, comment: "", link: `${await currentOrigin()}/me/leave` }, { type: "leave_request", id: req.id });
    revalidatePath("/app/leave");
    return { ok: `${v.type.name} recorded: ${dates} (${fmtDays(v.days)} day(s)).` };
  } catch (e) { return fail(e); }
}
