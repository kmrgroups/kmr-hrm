import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { fullName, fmtDate, Empty, one } from "@/components/ui";
import { BatchPrint } from "./BatchPrint";

export const metadata = { title: "ID cards" };

export default async function IdCardsPage({ searchParams }: { searchParams: Promise<{ dept?: string; since?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { dept = "", since = "" } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("employees")
    .select("id,employee_code,first_name,last_name,date_of_joining,department:departments(name),id_cards(issued_at,valid_until,status,version)")
    .eq("status", "active")
    .order("employee_code")
    .limit(1000);
  if (dept) q = q.eq("department_id", dept);
  const [{ data: rows }, { data: depts }] = await Promise.all([q, supabase.from("departments").select("id,name").order("name")]);

  const list = (rows ?? []).map((e) => {
    const card = ((e.id_cards as { issued_at: string; valid_until: string | null; status: string; version: number }[]) ?? []).find((c) => c.status === "active");
    return {
      id: e.id, code: e.employee_code ?? "", name: fullName(e), dept: one(e.department)?.name ?? "—",
      issued: card?.issued_at ?? null, validUntil: card?.valid_until ?? null, version: card?.version ?? 0,
    };
  }).filter((r) => !since || (r.issued && r.issued.slice(0, 10) >= since));

  return (
    <AppShell session={session} active="/app/id-cards">
      <div className="pagehead">
        <div><h1>ID cards</h1><p>Select employees and download one print-ready PDF (CR80 card size, front and back on separate pages).</p></div>
      </div>
      <form className="toolbar" method="get">
        <select name="dept" defaultValue={dept}>
          <option value="">All departments</option>
          {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="row" style={{ gap: 6, fontSize: 14 }}>Issued since <input type="date" name="since" defaultValue={since} style={{ minWidth: 0 }} /></label>
        <button className="btn secondary">Filter</button>
      </form>
      {list.length ? (
        <BatchPrint rows={list.map((r) => ({ ...r, issued: r.issued ? fmtDate(r.issued) : "—", validUntil: r.validUntil ? fmtDate(r.validUntil) : "—" }))} />
      ) : <div className="tablewrap"><Empty>No active employees.</Empty></div>}
    </AppShell>
  );
}
