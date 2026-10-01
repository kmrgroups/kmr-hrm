import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { p } from "@/lib/base-path";
import { aiConfigured } from "@/lib/ai/gateway";
import { istToday } from "@/lib/attendance/time";
import { ANN_CATEGORIES } from "@/lib/engage/rules";
import { masters } from "@/app/app/qms/data";
import { EngageTabs, dayLabel } from "../ui";
import { AnnouncementFields } from "./fields";
import { aiAnnouncement, saveAnnouncement } from "../actions";

export const metadata = { title: "Announcements" };
export const maxDuration = 60;

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { s = "live" } = await searchParams;
  const db = await createClient();
  const today = istToday();
  const [m, { data: list }, { data: st }] = await Promise.all([
    masters(db),
    db.from("announcements").select("id,title,category,audience,department_id,plant_id,pinned,needs_ack,status,publish_on,expires_on,published_at,ai_model,sample,announcement_reads(count)")
      .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(300),
    db.from("qms_settings").select("ai_enabled").maybeSingle(),
  ]);
  const ai = aiConfigured() && st?.ai_enabled !== false;
  const rows = (list ?? []).filter((a) => s === "all" ? true : s === "draft" ? a.status === "draft" : s === "archived" ? a.status === "archived" || (a.expires_on && a.expires_on < today)
    : a.status === "published" && !(a.expires_on && a.expires_on < today));
  const aud = (a: { audience: string; department_id: string | null; plant_id: string | null }) => a.audience === "all" ? "Everybody"
    : a.audience === "department" ? m.departments.find((d) => d.id === a.department_id)?.name ?? "A department" : m.plants.find((x) => x.id === a.plant_id)?.name ?? "A plant";

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>Announcements</h1><p>News for everybody, a department or a plant — on each person&apos;s portal, by e-mail and WhatsApp. Ask people to acknowledge what they must read (safety, policy).</p></div></div>
      <EngageTabs active="ann" />
      <div className="tabs" style={{ marginBottom: 12 }}>{[["live", "On the board"], ["draft", "Drafts"], ["archived", "Archived / expired"], ["all", "All"]].map(([k, l]) =>
        <a key={k} className={s === k ? "active" : ""} href={p(`/app/engage/announcements?s=${k}`)}>{l}</a>)}</div>

      <div className="card">
        {!rows.length ? <Empty>Nothing here.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Announcement</th><th>For</th><th>Status</th><th className="num">Read by</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}>
                <td><a href={p(`/app/engage/announcements/${a.id}`)}><b>{a.title}</b></a>
                  <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}><span className="badge">{ANN_CATEGORIES[a.category]}</span>{a.pinned && <span className="badge info">Pinned</span>}
                    {a.needs_ack && <span className="badge warn">Acknowledge</span>}{a.ai_model && <span className="badge" title={a.ai_model}>AI-drafted</span>}{a.sample && <span className="badge">Sample</span>}</div></td>
                <td>{aud(a)}</td>
                <td>{a.status === "published" ? (a.publish_on && a.publish_on > today ? <span className="badge info">From {dayLabel(a.publish_on)}</span> : <span className="badge ok">Published {dayLabel(a.published_at?.slice(0, 10) ?? a.publish_on)}</span>)
                  : a.status === "draft" ? <span className="badge warn">Draft</span> : <span className="badge">Archived</span>}
                  {a.expires_on && <div className="muted" style={{ fontSize: 12 }}>until {dayLabel(a.expires_on)}</div>}</td>
                <td className="num">{(a.announcement_reads as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
              </tr>))}</tbody>
          </table></div>)}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>New announcement</h2>
          <ActionForm action={saveAnnouncement} submitLabel="Save as draft" className="formgrid">
            <AnnouncementFields m={m} />
          </ActionForm>
        </div>
        <div className="card">
          <h2>Let the AI write it</h2>
          {!ai ? <p className="muted" style={{ margin: 0 }}>Set up the free AI in QMS › AI &amp; review to have announcements drafted from your points.</p> : <>
            <p className="muted" style={{ marginTop: 0 }}>Write the points; the free AI turns them into a short, clear notice. It becomes a draft — check every line before publishing. It adds no facts of its own.</p>
            <ActionForm action={aiAnnouncement} submitLabel="Draft it with AI" pendingLabel="Writing…" className="formgrid">
              <label className="field full">The points<textarea name="points" rows={6} required placeholder={"e.g. Plant closed on 11 Oct for Ayudha Pooja\nMachines to be cleaned on 10 Oct, 2nd shift\nPooja at 10 AM, sweets after"} /></label>
              <label className="field">Category<select name="category" defaultValue="general">{Object.entries(ANN_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field">For<select name="audience" defaultValue="all"><option value="all">Everybody</option><option value="department">A department</option><option value="plant">A plant</option></select></label>
              <label className="field">Department<select name="department_id" defaultValue=""><option value="">—</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label className="field">Plant<select name="plant_id" defaultValue=""><option value="">—</option>{m.plants.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label className="field check full"><input type="checkbox" name="needs_ack" /> Each person must acknowledge it</label>
            </ActionForm></>}
        </div>
      </div>
    </AppShell>
  );
}
