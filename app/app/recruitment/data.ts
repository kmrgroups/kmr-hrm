import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Opt } from "./ui";

/** designations, departments and plants for the pickers */
export async function masters(db: Awaited<ReturnType<typeof createClient>>) {
  const [d, dep, pl, pos, comp] = await Promise.all([
    db.from("designations").select("id,name").eq("active", true).order("name"),
    db.from("departments").select("id,name").eq("active", true).order("name"),
    db.from("plants").select("id,name").order("name"),
    db.from("positions").select("title,role").eq("active", true).order("title"),
    db.from("competencies").select("name,category").eq("active", true).order("category").order("name"),
  ]);
  return { desigs: (d.data ?? []) as Opt[], depts: (dep.data ?? []) as Opt[], plants: (pl.data ?? []) as Opt[],
    titles: [...new Set((pos.data ?? []).map((p) => p.title as string))], roles: [...new Set((pos.data ?? []).map((p) => p.role as string).filter(Boolean))],
    comps: (comp.data ?? []) as { name: string; category: string }[] };
}
