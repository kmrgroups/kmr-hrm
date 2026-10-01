import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { Empty, fmtDate } from "@/components/ui";
import { p } from "@/lib/base-path";
import { lakh } from "@/lib/recruit/format";
import { RecruitTabs, ScoreBar, AppStatus } from "../ui";

export const metadata = { title: "Candidates" };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Everyone who ever applied — the company's talent pool, searchable */
export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { q } = await searchParams;
  const db = await createClient();
  let query = db.from("candidates").select("id,full_name,email,phone,location,total_exp,expected_ctc,skills,created_at,applications(id,status,score,requisition:requisitions(title))").order("created_at", { ascending: false }).limit(300);
  const term = (q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,location.ilike.%${term}%,current_company.ilike.%${term}%,resume_text.ilike.%${term}%`);
  const { data: cands } = await query;
  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>Candidates</h1><p>Everyone who applied — search by name, mobile, city, company or anything in their resume (e.g. “8D”, “Fanuc”, “SAP”).</p></div></div>
      <RecruitTabs active="cands" />
      <form className="toolbar" method="get"><input name="q" defaultValue={q ?? ""} placeholder="Search the talent pool…" /><button className="btn">Search</button>{q && <a className="btn secondary" href={p("/app/recruitment/candidates")}>Clear</a>}</form>
      <div className="card">
        {!cands?.length ? <Empty>{q ? "Nobody matches that search." : "No candidates yet."}</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Candidate</th><th className="num">Exp.</th><th className="num">Expects</th><th>Applied for</th><th>Added</th></tr></thead>
            <tbody>{cands.map((c) => <tr key={c.id}>
              <td><b>{c.full_name}</b><div className="muted" style={{ fontSize: 12 }}>{[c.phone, c.email, c.location].filter(Boolean).join(" · ")}</div></td>
              <td className="num">{c.total_exp != null ? `${c.total_exp} y` : "—"}</td><td className="num">{lakh(c.expected_ctc)}</td>
              <td>{(c.applications as unknown as { id: string; status: string; score: number | null; requisition: { title: string } | { title: string }[] }[]).map((a) =>
                <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}><a href={p(`/app/recruitment/candidates/${a.id}`)}>{one(a.requisition)?.title}</a><ScoreBar score={a.score} /><AppStatus status={a.status} /></div>)}</td>
              <td>{fmtDate(c.created_at)}</td></tr>)}</tbody>
          </table></div>)}
      </div>
    </AppShell>
  );
}
