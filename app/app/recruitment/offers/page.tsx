import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty, fmtDate } from "@/components/ui";
import { p } from "@/lib/base-path";
import { inr } from "@/lib/payroll/compute";
import { RecruitTabs } from "../ui";

export const metadata = { title: "Offers" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const ST: Record<string, [string, string]> = { draft: ["Draft", "warn"], sent: ["With the candidate", "info"], accepted: ["Accepted", "ok"], declined: ["Declined", "danger"], expired: ["Expired", ""], withdrawn: ["Withdrawn", ""] };

export default async function OffersPage() {
  const session = await requireRole(HR_ROLES);
  const db = await createClient();
  const { data: offers } = await db.from("offers").select("id,ref_no,status,annual_ctc,date_of_joining,valid_until,sent_at,responded_at,designation:designations(name),application:applications(id,candidate:candidates(full_name))").order("created_at", { ascending: false }).limit(300);
  const sum = (s: string) => (offers ?? []).filter((o) => o.status === s).length;
  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>Offers</h1><p>Accepted offers create the new joiner and send the self-onboarding link automatically.</p></div></div>
      <RecruitTabs active="offers" />
      <div className="grid four">{([["Drafts", "draft"], ["With candidates", "sent"], ["Accepted", "accepted"], ["Declined", "declined"]] as [string, string][]).map(([l, s]) => <div key={s} className="card stat"><div className="label">{l}</div><div className="value">{sum(s)}</div></div>)}</div>
      <div className="card">
        {!offers?.length ? <Empty>No offers yet.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Offer</th><th>Candidate</th><th>Role</th><th className="num">CTC / year</th><th>Joining</th><th>Status</th></tr></thead>
            <tbody>{offers.map((o) => { const a = one(o.application as unknown as { id: string; candidate: { full_name: string } }); const [l, t] = ST[o.status];
              const late = o.status === "sent" && o.valid_until < new Date().toISOString().slice(0, 10);
              return <tr key={o.id}><td className="mono">{o.ref_no}</td><td><a href={p(`/app/recruitment/candidates/${a?.id}`)}><b>{one(a?.candidate)?.full_name}</b></a></td>
                <td>{one(o.designation as unknown as { name: string })?.name ?? "—"}</td><td className="num">{inr(o.annual_ctc)}</td><td>{fmtDate(o.date_of_joining)}</td>
                <td><span className={`badge ${late ? "danger" : t}`}>{late ? "Past its validity" : l}</span>{o.status === "sent" ? <div className="muted" style={{ fontSize: 12 }}>valid until {fmtDate(o.valid_until)}</div> : null}</td></tr>; })}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
