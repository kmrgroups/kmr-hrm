"use server";
import { revalidatePath } from "next/cache";
import { assertRole, HR_ROLES, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { currentOrigin } from "@/lib/tenant";
import { ingestPunches } from "@/lib/attendance/service";
import { istInstant, toMinutes } from "@/lib/attendance/time";
import { fmtDays } from "@/lib/leave/rules";
import { approveLeave, rejectLeave } from "@/lib/leave/service";
import { notifyEmployee } from "@/lib/workflow/notify";
import { fmtDate } from "@/components/ui";
import type { ActionState } from "@/app/app/employees/actions";

/** The signed-in user must be HR, or the manager of this employee (checked in the database). */
async function assertCanApprove(session: Session, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("can_approve_for", { emp: employeeId });
  if (error || !data) throw new Error("You cannot decide requests for this employee.");
  return session;
}

export async function decideLeave(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const session = await assertRole([...HR_ROLES, "manager"], "hrm.attendance-shifts-leave");
    const { user, tenant } = session;
    const id = String(form.get("id") ?? "");
    const decision = form.get("decision") === "approve" ? "approve" : "reject";
    const comment = String(form.get("comment") ?? "").trim() || null;
    if (decision === "reject" && !comment) return { error: "Please give a reason when rejecting." };
    const db = createAdminClient();
    const { data: req } = await db.from("leave_requests").select("employee_id,leave_type:leave_types(name)").eq("id", id).eq("tenant_id", tenant.id).single();
    if (!req) return { error: "Request not found." };
    await assertCanApprove(session, req.employee_id);
    const r = decision === "approve" ? await approveLeave(tenant, id, user.id, comment) : await rejectLeave(tenant, id, user.id, comment);
    const typeName = (Array.isArray(req.leave_type) ? req.leave_type[0] : req.leave_type)?.name ?? "Leave";
    const dates = r.from_date === r.to_date ? fmtDate(r.from_date) : `${fmtDate(r.from_date)} – ${fmtDate(r.to_date)}`;
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `leave.${decision === "approve" ? "approved" : "rejected"}`, entity: "leave_requests", entityId: id, data: { comment } });
    await notifyEmployee(tenant, req.employee_id, "leave_decided", {
      leave_type: typeName, dates, days: fmtDays(r.days), decision: decision === "approve" ? "approved" : "rejected",
      approver: user.full_name, comment: comment ? `Comment: ${comment}` : "", link: `${await currentOrigin()}/me/leave`,
    }, { type: "leave_request", id });
    revalidatePath("/app/approvals");
    return { ok: decision === "approve" ? "Leave approved." : "Leave rejected." };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function decideRegularisation(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const session = await assertRole([...HR_ROLES, "manager"], "hrm.attendance-shifts-leave");
    const { user, tenant } = session;
    const id = String(form.get("id") ?? "");
    const approve = form.get("decision") === "approve";
    const comment = String(form.get("comment") ?? "").trim() || null;
    if (!approve && !comment) return { error: "Please give a reason when rejecting." };
    const db = createAdminClient();
    const { data: req } = await db.from("regularisation_requests").select("*").eq("id", id).eq("tenant_id", tenant.id).single();
    if (!req || req.status !== "pending") return { error: "This request is no longer pending." };
    await assertCanApprove(session, req.employee_id);

    const { data: updated } = await db.from("regularisation_requests").update({ status: approve ? "approved" : "rejected", decided_by: user.id, decided_at: new Date().toISOString(), decision_comment: comment })
      .eq("id", id).eq("status", "pending").select("id");
    if (!updated?.length) return { error: "This request was already decided." };

    if (approve) {
      const { data: emp } = await db.from("employees").select("attendance_id,employee_code").eq("id", req.employee_id).single();
      let att = emp?.attendance_id ?? emp?.employee_code;
      if (!att) { att = `emp:${req.employee_id}`; await db.from("employees").update({ attendance_id: att }).eq("id", req.employee_id); }
      const inMin = req.in_time ? toMinutes(req.in_time) : null;
      let outMin = req.out_time ? toMinutes(req.out_time) : null;
      if (inMin !== null && outMin !== null && outMin <= inMin) outMin += 1440;          // night shift: out is next morning
      const rows = [inMin, outMin].filter((m): m is number => m !== null)
        .map((m) => ({ attendance_id: att!, punched_at: new Date(istInstant(req.work_date, m)).toISOString() }));
      await ingestPunches(tenant.id, rows, "regularisation", null, user.id);
    }
    await logAudit({ tenantId: tenant.id, actorId: user.id, action: `regularisation.${approve ? "approved" : "rejected"}`, entity: "regularisation_requests", entityId: id, data: { comment } });
    await notifyEmployee(tenant, req.employee_id, "regularisation_decided", {
      date: fmtDate(req.work_date), decision: approve ? "approved" : "rejected", approver: user.full_name,
      comment: comment ? `Comment: ${comment}` : "", link: `${await currentOrigin()}/me/attendance?month=${req.work_date.slice(0, 7)}`,
    }, { type: "regularisation", id });
    revalidatePath("/app/approvals");
    return { ok: approve ? "Correction approved; the day was recalculated." : "Correction rejected." };
  } catch (e) { return { error: (e as Error).message }; }
}
