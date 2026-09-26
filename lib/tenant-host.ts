/**
 * Works out which company a request belongs to from the host name:
 *   1. an exact custom domain in tenant_domains (hr.customer.com)
 *   2. a subdomain of APP_ROOT_DOMAIN (deno.hrmsuite.in -> slug "deno")
 *   3. DEFAULT_TENANT_SLUG (localhost and preview deployments)
 */
export function slugFromHost(host: string, rootDomain: string): string | null {
  const h = host.toLowerCase().split(":")[0];
  if (!rootDomain || !h.endsWith("." + rootDomain)) return null;
  const sub = h.slice(0, -(rootDomain.length + 1));
  if (!sub || sub.includes(".") || sub === "www" || sub === "app") return null;
  return sub;
}

