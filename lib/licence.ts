import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Licence from the KMR Console. On the KMR platform every company's access to the HRM is controlled there
 * (trial / pilot / active / suspended / expired). A dedicated copy without a Console sets KMR_LICENCE_CHECK=off.
 *
 * Cached for 60 seconds, so a change in the Console takes effect within a minute.
 */
export interface Licence { ok: boolean; status: string; validUntil: string | null; seats: number | null; message: string | null; features: string[] | null }

const OPEN: Licence = { ok: true, status: "unchecked", validUntil: null, seats: null, message: null, features: null };

const lookup = unstable_cache(async (tenantId: string): Promise<Licence> => {
  const { data, error } = await createAdminClient().schema("console").rpc("licence_status", { p_product: "hrm", p_ref: tenantId });
  if (error) {
    // Console unreachable or not installed: do not lock companies out because of our own outage.
    console.error("[licence] check failed, allowing access:", error.message);
    return OPEN;
  }
  // the features on the company's quotation / paid invoice (null = no list set: every feature)
  let features: string[] | null = null;
  try {
    const f = await createAdminClient().schema("console").from("licences").select("features").eq("product_code", "hrm").eq("product_ref", tenantId).maybeSingle();
    if (!f.error && f.data && Array.isArray((f.data as { features: string[] | null }).features)) features = (f.data as { features: string[] }).features;
  } catch { /* feature list unreachable: do not lock the company out */ }
  const row = (Array.isArray(data) ? data[0] : data) as { status: string; valid_until: string | null; seats: number | null } | null;
  if (!row) return { ok: false, status: "none", validUntil: null, seats: null, message: "This company does not have an HRM licence.", features: null };
  const expired = row.valid_until !== null && row.valid_until < new Date().toISOString().slice(0, 10);
  const ok = ["trial", "pilot", "active"].includes(row.status) && !expired;
  const message = ok ? null
    : expired ? `Your company's HRM ${row.status === "trial" ? "trial" : "licence"} ended on ${row.valid_until}.`
    : row.status === "suspended" ? "Your company's HRM access is suspended."
    : `Your company's HRM licence is ${row.status}.`;
  return { ok, status: expired ? "expired" : row.status, validUntil: row.valid_until, seats: row.seats, message, features };
}, ["hrm-licence"], { revalidate: 60, tags: ["licence"] });

export async function licenceFor(tenantId: string): Promise<Licence> {
  if ((process.env.KMR_LICENCE_CHECK || "on").toLowerCase() === "off") return OPEN;
  return lookup(tenantId);
}

/** Throws when adding one more active employee would exceed the licence's employee limit. */
export async function assertSeat(tenantId: string): Promise<void> {
  const l = await licenceFor(tenantId);
  if (!l.seats) return;
  const { count } = await createAdminClient().from("employees").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).in("status", ["draft", "invited", "submitted", "active"]);
  if ((count ?? 0) >= l.seats) throw new Error(`Your licence covers ${l.seats} employees, and that limit is reached. Contact KMR to raise it.`);
}
