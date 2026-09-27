import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { fullName } from "@/components/ui";
import type { Tenant } from "@/lib/types";
import type { NotificationEvent } from "@/lib/notify/templates";

/**
 * Sends a request to the person who approves it: the employee's reporting manager if they have a
 * portal login with the manager role, otherwise HR (Company settings → HR alert email).
 * Leave and correction messages go by email until their WhatsApp templates are approved by Meta.
 */
export async function notifyApprover(tenant: Tenant, employeeId: string, event: NotificationEvent, vars: Record<string, string>, related: { type: string; id: string }) {
  const db = createAdminClient();
  const { data: emp } = await db.from("employees").select("reporting_manager_id").eq("id", employeeId).single();
  let to: { name: string; email: string | null } | null = null;
  if (emp?.reporting_manager_id) {
    const { data: mgrUser } = await db.from("app_users").select("full_name,email,role,active")
      .eq("employee_id", emp.reporting_manager_id).eq("tenant_id", tenant.id).eq("active", true).maybeSingle();
    if (mgrUser && ["manager", "hr_manager", "hr_executive", "company_admin"].includes(mgrUser.role)) to = { name: mgrUser.full_name, email: mgrUser.email };
  }
  if (!to && tenant.settings?.hr_notify_email) to = { name: "HR team", email: tenant.settings.hr_notify_email };
  if (!to?.email) return [];
  return notify({ tenant, event, to: { name: to.name, email: to.email }, vars, channels: ["email"], related });
}

export async function notifyEmployee(tenant: Tenant, employeeId: string, event: NotificationEvent, vars: Record<string, string>, related: { type: string; id: string }) {
  const db = createAdminClient();
  const { data: emp } = await db.from("employees").select("first_name,last_name,email").eq("id", employeeId).single();
  if (!emp?.email) return [];
  return notify({ tenant, event, to: { name: fullName(emp), email: emp.email }, vars, channels: ["email"], related });
}
