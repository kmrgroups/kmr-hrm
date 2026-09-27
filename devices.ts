import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/tokens";

export interface Device { id: string; tenant_id: string; name: string }

export async function deviceByKey(key: string): Promise<Device | null> {
  if (!key || key.length < 20) return null;
  const { data } = await createAdminClient().from("attendance_devices").select("id,tenant_id,name")
    .eq("key_hash", hashToken(key)).eq("kind", "api").eq("active", true).maybeSingle();
  return data ?? null;
}

export async function deviceBySerial(sn: string): Promise<Device | null> {
  const serial = sn.trim().toUpperCase();
  if (!serial || serial.length > 40) return null;
  const { data } = await createAdminClient().from("attendance_devices").select("id,tenant_id,name")
    .eq("serial_no", serial).eq("kind", "adms").eq("active", true).maybeSingle();
  return data ?? null;
}

export async function touchDevice(id: string, req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  await createAdminClient().from("attendance_devices").update({ last_seen_at: new Date().toISOString(), last_ip: ip }).eq("id", id);
}
