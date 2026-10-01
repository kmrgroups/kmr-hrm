import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Opt } from "./ui";

/** designations, departments and plants for the pickers */
export async function masters(db: Awaited<ReturnType<typeof createClient>>) {
  const [d, dep, pl] = await Promise.all([
    db.from("designations").select("id,name").eq("active", true).order("name"),
    db.from("departments").select("id,name").eq("active", true).order("name"),
    db.from("plants").select("id,name").order("name"),
  ]);
  return { desigs: (d.data ?? []) as Opt[], depts: (dep.data ?? []) as Opt[], plants: (pl.data ?? []) as Opt[] };
}
