import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { Tenant } from "@/lib/types";

import { slugFromHost } from "@/lib/tenant-host";
import { BASE_PATH } from "@/lib/base-path";

export const getTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const host = (h.get("x-forwarded-host") || h.get("host") || "").toLowerCase().split(":")[0];
  const db = createAdminClient();
  const cols = "id,slug,name,legal_name,logo_path,primary_color,accent_color,address,phone,email,website,emp_code_prefix,settings";

  const { data: domain } = await db.from("tenant_domains").select("tenant_id").eq("domain", host).maybeSingle();
  if (domain) {
    const { data } = await db.from("tenants").select(cols).eq("id", domain.tenant_id).eq("active", true).maybeSingle();
    if (data) return data as Tenant;
  }
  const slug = slugFromHost(host, env.rootDomain) || env.defaultTenantSlug;
  if (!slug) return null;
  const { data } = await db.from("tenants").select(cols).eq("slug", slug).eq("active", true).maybeSingle();
  return (data as Tenant) ?? null;
});

export async function requireTenant(): Promise<Tenant> {
  const t = await getTenant();
  if (!t) throw new Error("No company is configured for this address.");
  return t;
}

/** Public URL of the tenant's logo (branding bucket is public) */
export function logoUrl(t: Pick<Tenant, "logo_path">): string | null {
  if (!t.logo_path) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/branding/${t.logo_path}`;
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
