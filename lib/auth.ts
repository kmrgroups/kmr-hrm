import "server-only";
import { cache } from "react";
import { verifiedUserId } from "@/lib/verified-user";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { licenceFor } from "@/lib/licence";
import type { AppUser, Role, Tenant } from "@/lib/types";

export const HR_ROLES: Role[] = ["company_admin", "platform_admin", "hr_manager", "hr_executive"];
export const ADMIN_ROLES: Role[] = ["company_admin", "platform_admin"];

export interface Session {
  user: AppUser;
  tenant: Tenant;
}

/** The signed-in user's profile, only if it belongs to the company of this domain. */
export const getSession = cache(async (): Promise<Session | null> => {
  const uid = await verifiedUserId();
  if (!uid) return null;
  const supabase = await createClient();
  const user = { id: uid };
  const tenant = await getTenant();
  if (!tenant) return null;
  const { data: appUser } = await supabase
    .from("app_users")
    .select("id,tenant_id,role,full_name,email,phone,employee_id,must_change_password,active")
    .eq("id", user.id)
    .maybeSingle();
  if (!appUser || !appUser.active) return null;
  // A user of company A must not use company B's domain.
  if (appUser.tenant_id !== tenant.id && appUser.role !== "platform_admin") return null;
  return { user: appUser as AppUser, tenant };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.user.role !== "platform_admin" && !(await licenceFor(s.tenant.id)).ok) redirect("/suspended");
  return s;
}

export function hasRole(user: AppUser, roles: Role[]): boolean {
  return roles.includes(user.role) || user.role === "company_admin" || user.role === "platform_admin";
}

export function isHr(user: AppUser) {
  return hasRole(user, HR_ROLES);
}

/** For pages: redirects employees to their portal. */
export async function requireRole(roles: Role[]): Promise<Session> {
  const s = await requireSession();
  if (!hasRole(s.user, roles)) redirect("/me");
  return s;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertRole(roles: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (!hasRole(s.user, roles)) throw new Error("You do not have permission for this action.");
  // Sample-data demo (portal "Try with sample data"): explore only — real work needs a subscription
  if (process.env.HRM_DEMO_EMAIL && s.user.email === process.env.HRM_DEMO_EMAIL.toLowerCase()) {
    throw new Error("Sample data only — take a subscription to work with your company's own data: www.kmr-groups.com/it/?buy=hrm");
  }
  if (s.user.role !== "platform_admin") {
    const l = await licenceFor(s.tenant.id);
    if (!l.ok) throw new Error(`${l.message} Please contact KMR Group of Companies.`);
  }
  return s;
}

/** Where a user lands after signing in */
export function homeFor(user: AppUser): string {
  if (user.must_change_password) return "/account?first=1";
  return isHr(user) || hasRole(user, ["payroll", "manager"]) ? "/app" : "/me";
}
