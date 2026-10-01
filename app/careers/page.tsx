import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant, tenantBySlug } from "@/lib/tenant";
import { PublicFrame } from "@/components/PublicFrame";
import { p } from "@/lib/base-path";
import { recruitSettings } from "@/lib/recruit/service";

export const metadata = { title: "Careers" };
export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Public list of the company's open roles (only those HR chose to show) */
export default async function CareersPage({ searchParams }: { searchParams: Promise<{ co?: string }> }) {
  // many companies share one address on the KMR platform: the link carries the company (?co=…)
  const { co } = await searchParams;
  const tenant = co && /^[a-z0-9-]{2,40}$/.test(co) ? await tenantBySlug(co) : await getTenant();
  if (!tenant) return <PublicFrame tenant={null}><div className="card"><h1>Careers</h1><p>This page is not available.</p></div></PublicFrame>;
  const db = createAdminClient();
  const st = await recruitSettings(db, tenant.id);
  if (!st.careers_enabled) return <PublicFrame tenant={tenant}><div className="card"><h1>Careers</h1><p>{tenant.name} is not showing openings here at the moment.</p></div></PublicFrame>;
  const { data: roles } = await db.from("requisitions").select("id,title,location,exp_min,exp_max,headcount,department:departments(name),plant:plants(name)")
    .eq("tenant_id", tenant.id).eq("status", "open").eq("published", true).order("created_at", { ascending: false });
  return (
    <PublicFrame tenant={tenant}>
      <h1>Careers at {tenant.name}</h1>
      {st.careers_intro && <p style={{ whiteSpace: "pre-wrap" }}>{st.careers_intro}</p>}
      {!roles?.length ? <div className="card"><p>There are no open roles right now. Please check again soon.</p></div> : roles.map((r) => (
        <a key={r.id} className="card" href={p(`/careers/${r.id}`)} style={{ display: "block" }}>
          <h2 style={{ margin: 0 }}>{r.title}</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>{[one(r.department as unknown as { name: string })?.name, r.location || one(r.plant as unknown as { name: string })?.name,
            r.exp_min != null || r.exp_max != null ? `${r.exp_min ?? 0}–${r.exp_max ?? "+"} years` : null, r.headcount > 1 ? `${r.headcount} openings` : null].filter(Boolean).join(" · ")}</p>
        </a>))}
    </PublicFrame>
  );
}
