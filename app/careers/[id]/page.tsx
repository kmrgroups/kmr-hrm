import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant, tenantById } from "@/lib/tenant";
import { PublicFrame } from "@/components/PublicFrame";
import { p } from "@/lib/base-path";
import { ApplyForm } from "./ApplyForm";

export const metadata = { title: "Apply" };
export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createAdminClient();
  // the role decides the company (many companies share one address on the KMR platform)
  const { data: r } = /^[0-9a-f-]{36}$/.test(id)
    ? await db.from("requisitions").select("id,tenant_id,title,status,location,exp_min,exp_max,department:departments(name),plant:plants(name),jd:job_descriptions(purpose,responsibilities,must_have,good_to_have,qualifications,experience,status)").eq("id", id).maybeSingle()
    : { data: null };
  const tenant = r ? await tenantById(r.tenant_id) : await getTenant();
  if (!r || r.status !== "open") return <PublicFrame tenant={tenant}><div className="card"><h1>This role is not open</h1><p>It may have been filled. <a href={p(tenant ? `/careers?co=${tenant.slug}` : "/careers")}>See the open roles</a>.</p></div></PublicFrame>;
  const jd = one(r.jd as unknown as { purpose: string | null; responsibilities: string[]; must_have: { name: string }[]; good_to_have: { name: string }[]; qualifications: string | null; experience: string | null; status: string });
  const where = r.location || one(r.plant as unknown as { name: string })?.name;
  return (
    <PublicFrame tenant={tenant}>
      <p><a href={p(`/careers?co=${tenant!.slug}`)}>← All open roles</a></p>
      <h1 style={{ marginBottom: 4 }}>{r.title}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{[one(r.department as unknown as { name: string })?.name, where, jd?.experience].filter(Boolean).join(" · ")}</p>
      {jd && <div className="card stack">
        {jd.purpose && <p style={{ margin: 0 }}>{jd.purpose}</p>}
        {jd.responsibilities?.length > 0 && <div><h3>What you will do</h3><ul>{jd.responsibilities.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        {jd.must_have?.length > 0 && <div><h3>What you need</h3><ul>{jd.must_have.map((x) => <li key={x.name}>{x.name}</li>)}</ul></div>}
        {jd.good_to_have?.length > 0 && <div><h3>Good to have</h3><ul>{jd.good_to_have.map((x) => <li key={x.name}>{x.name}</li>)}</ul></div>}
        {jd.qualifications && <p style={{ margin: 0 }}><b>Qualification:</b> {jd.qualifications}</p>}
      </div>}
      <div className="card"><h2>Apply</h2><ApplyForm roleId={r.id} company={tenant!.name} /></div>
    </PublicFrame>
  );
}
