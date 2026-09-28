import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { BRANDING_BUCKET } from "@/lib/buckets";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { Tenant } from "@/lib/types";

import { slugFromHost } from "@/lib/tenant-host";
import { BASE_PATH } from "@/lib/base-path";

const COLS = "id,slug,name,legal_name,logo_path,primary_color,accent_color,address,phone,email,website,emp_code_prefix,settings";

/** Cookie remembering which company's branding to show on the sign-in page */
export const COMPANY_COOKIE = "hrm_co";

export const tenantBySlug = unstable_cache(async (slug: string): Promise<Tenant | null> => {
  const { data } = await createAdminClient().from("tenants").select(COLS).eq("slug", slug).eq("active", true).maybeSingle();
  return (data as Tenant) ?? null;
}, ["tenant-by-slug"], { revalidate: 300, tags: ["tenant"] });

/** Company by id (for pages opened from onboarding / ID-card links, and for signed-in users). Cached 5 minutes. */
export const tenantById = unstable_cache(async (id: string): Promise<Tenant | null> => {
  const { data } = await createAdminClient().from("tenants").select(COLS).eq("id", id).eq("active", true).maybeSingle();
  return (data as Tenant) ?? null;
}, ["tenant-by-id"], { revalidate: 300, tags: ["tenant"] });

/** Company that owns a web address: a customer's own domain, or <slug>.APP_ROOT_DOMAIN. Null for shared addresses. */
const byHost = unstable_cache(async (host: string): Promise<Tenant | null> => {
  const { data: domain } = await createAdminClient().from("tenant_domains").select("tenant_id").eq("domain", host).maybeSingle();
  if (domain) return tenantById(domain.tenant_id);
  const slug = slugFromHost(host, env.rootDomain);
  return slug ? tenantBySlug(slug) : null;
}, ["tenant-by-host"], { revalidate: 300, tags: ["tenant"] });

/** Company owning this web address, if it is a company-specific one (e.g. hr.customer.com) */
export const hostTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const host = (h.get("x-forwarded-host") || h.get("host") || "").toLowerCase().split(":")[0];
  return byHost(host);
});

/** Company of the signed-in person (null when signed out) */
const signedInTenant = cache(async (): Promise<Tenant | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await createAdminClient().from("app_users").select("tenant_id").eq("id", user.id).maybeSingle();
  return data ? tenantById(data.tenant_id) : null;
});

/**
 * The company this request belongs to. Many companies share one address on the KMR platform, so:
 *   1. a company-specific address (their own domain) decides;
 *   2. otherwise the signed-in person's company;
 *   3. otherwise the company remembered from the last sign-in (sign-in page branding);
 *   4. otherwise DEFAULT_TENANT_SLUG.
 */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const own = await hostTenant();
  if (own) return own;
  const mine = await signedInTenant();
  if (mine) return mine;
  const remembered = (await cookies()).get(COMPANY_COOKIE)?.value;
  if (remembered && /^[a-z0-9-]{2,40}$/.test(remembered)) {
    const t = await tenantBySlug(remembered);
    if (t) return t;
  }
  return env.defaultTenantSlug ? tenantBySlug(env.defaultTenantSlug) : null;
});

export async function requireTenant(): Promise<Tenant> {
  const t = await getTenant();
  if (!t) throw new Error("No company is configured for this address.");
  return t;
}

/** Public URL of the tenant's logo (branding bucket is public) */
export function logoUrl(t: Pick<Tenant, "logo_path">): string | null {
  if (!t.logo_path) return null;
  if (/^https?:\/\//.test(t.logo_path)) return t.logo_path;      // logo pushed from KMR Apps › Administration
  return `${env.supabaseUrl}/storage/v1/object/public/${BRANDING_BUCKET}/${t.logo_path}`;
}

/**
 * Absolute base URL of the app for links in emails, WhatsApp and QR codes,
 * e.g. https://hr.customer.com or https://www.kmr-groups.com/it/hrm
 */
export async function currentOrigin(): Promise<string> {
  if (env.publicUrl) return env.publicUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${BASE_PATH}`;
}
