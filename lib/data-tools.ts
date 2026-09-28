import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, istToday } from "@/lib/attendance/time";

// Company data tools: JSON export / import, sample data, and the nightly backups kept for 7 days.
export const BACKUP_BUCKET = "hrm-backups";
export const KEEP_DAYS = 7;

export async function exportCompany(tenantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await createAdminClient().rpc("company_export", { p_tenant: tenantId });
  if (error) throw new Error(`Export failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Saves today's backup (India date) for one company and removes backups older than KEEP_DAYS. */
export async function saveNightlyBackup(tenantId: string, date = istToday()): Promise<number> {
  const db = createAdminClient();
  const json = JSON.stringify(await exportCompany(tenantId));
  const { error } = await db.storage.from(BACKUP_BUCKET).upload(`${tenantId}/${date}.json`, new Blob([json], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`Backup upload failed: ${error.message}`);
  const cutoff = addDays(date, -KEEP_DAYS);
  const old = (await listBackups(tenantId)).filter((b) => b.date < cutoff).map((b) => `${tenantId}/${b.date}.json`);
  if (old.length) await db.storage.from(BACKUP_BUCKET).remove(old);
  return json.length;
}

export async function listBackups(tenantId: string): Promise<{ date: string; size: number }[]> {
  const { data } = await createAdminClient().storage.from(BACKUP_BUCKET).list(tenantId, { limit: 60, sortBy: { column: "name", order: "desc" } });
  return (data ?? []).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
    .map((f) => ({ date: f.name.slice(0, 10), size: Number((f.metadata as { size?: number } | null)?.size ?? 0) }));
}

export async function readBackup(tenantId: string, date: string): Promise<Blob | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { data } = await createAdminClient().storage.from(BACKUP_BUCKET).download(`${tenantId}/${date}.json`);
  return data ?? null;
}
export { istToday };
