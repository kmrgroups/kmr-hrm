import "server-only";
// The links sent to candidates: an interview's confirm / reschedule link and an offer's accept / decline link.
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { hashToken } from "@/lib/tokens";
import { tenantById } from "@/lib/tenant";

/** The interview's link code: the same every time (invitation and reminders), unguessable without the app's secret */
export function interviewToken(interviewId: string): string {
  return createHmac("sha256", env.appSecret).update(`interview:${interviewId}`).digest("hex");
}

export async function interviewByToken(token: string) {
  if (!token || token.length < 20) return null;
  const db = createAdminClient();
  const { data } = await db.from("interviews").select("*, application:applications(id, candidate:candidates(full_name,email,phone), requisition:requisitions(title))").eq("token_hash", hashToken(token)).maybeSingle();
  if (!data) return null;
  const tenant = await tenantById(data.tenant_id);
  return tenant ? { iv: data, tenant } : null;
}

export async function offerByToken(token: string) {
  if (!token || token.length < 20) return null;
  const db = createAdminClient();
  const { data } = await db.from("offers").select("*, designation:designations(name), application:applications(id, candidate:candidates(full_name,email,phone))").eq("token_hash", hashToken(token)).maybeSingle();
  if (!data) return null;
  const tenant = await tenantById(data.tenant_id);
  if (!tenant) return null;
  // an offer past its date lapses
  if (data.status === "sent" && data.valid_until < new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)) {
    await db.from("offers").update({ status: "expired" }).eq("id", data.id);
    await db.from("applications").update({ status: "selected" }).eq("id", data.application_id);
    data.status = "expired";
  }
  return { offer: data, tenant };
}
