import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records a business action (e.g. "onboarding.approved") with the person who did it.
 * Row-level changes are also captured automatically by database triggers.
 */
export async function logAudit(entry: {
  tenantId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}) {
  await createAdminClient().from("audit_log").insert({
    tenant_id: entry.tenantId,
    actor_id: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    new_data: entry.data ?? null,
  });
}
