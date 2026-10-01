import { notFound } from "next/navigation";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { ANN_CATEGORIES } from "@/lib/engage/rules";
import { isSampleRecipient } from "@/lib/notify/render";
import { masters, people } from "@/app/app/qms/data";
import { AiBadge } from "@/app/app/qms/ui";
import { EngageTabs, Bar, dayLabel, when } from "../../ui";
import { AnnouncementFields } from "../fields";
import { publishAnnouncement, saveAnnouncement, setAnnouncementStatus } from "../../actions";

export const metadata = { title: "Announcement" };
export const maxDuration = 60;

export default async function AnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ who?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { id } = await params, { who = "pending" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: a } = await db.from("announcements").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();
  const [m, ppl, reads, { data: sent }] = await Promise.all([
    masters(db), people(db),
    fetchAll<{ employee_id: string; read_at: string; acknowledged_at: string | null }>((x, y) => db.from("announcement_reads").select("employee_id,read_at,acknowledged_at").eq("announcement_id", id).range(x, y)),
    db.from("notifications").select("status").eq("related_id", id).eq("event", "announcement"),
  ]);
  const aud = ppl.filter((e) => a.audience === "all" || (a.audience === "department" ? e.department_id === a.department_id : e.plant_id === a.plant_id));
  const r = new Map(reads.map((x) => [x.employee_id, x]));
  const readN = aud.filter((e) => r.has(e.id)).length, ackN = aud.filter((e) => r.get(e.id)?.acknowledged_at).length;
  const sentN = (sent ?? []).filter((x) => x.status === "sent").length;
  const list = aud.filter((e) => who === "all" ? true : who === "done" ? (a.needs_ack ? r.get(e.id)?.acknowledged_at : r.has(e.id)) : !(a.needs_ack ? r.get(e.id)?.acknowledged_at : r.has(e.id)));
  const today = istToday(), live = a.status === "published" && !(a.publish_on && a.publish_on > today);

  return (
    <AppShell session={session} active="/app/engage">
      <div className="pagehead"><div><h1>{a.title}{a.ai_model && <AiBadge model={a.ai_model} draft={a.status === "draft"} />}</h1>
        <p>{ANN_CATEGORIES[a.category]} · {a.audience === "all" ? "Everybody" : a.audience === "department" ? m.departments.find((d) => d.id === a.department_id)?.name : m.plants.find((x) => x.id === a.plant_id)?.name}
          {" · "}{a.status === "draft" ? "Draft" : a.status === "archived" ? "Archived" : live ? `Published ${when(a.published_at)}` : `Appears on ${dayLabel(a.publish_on)}`}
          {a.expires_on ? ` · until ${dayLabel(a.expires_on)}` : ""}{a.created_by_name ? ` · by ${a.created_by_name}` : ""}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a.status === "draft" && <ActionForm action={publishAnnouncement} submitLabel={a.publish_on && a.publish_on > today ? "Schedule" : "Publish"} pendingLabel="Publishing…" variant="accent" className="inline" hidden={{ id }}
            confirm={a.notify ? "Publish and send it to everybody it is for?" : undefined} />}
          {a.status === "published" && <ActionForm action={setAnnouncementStatus} submitLabel={a.pinned ? "Unpin" : "Pin"} variant="secondary" className="inline" hidden={{ id, to: a.pinned ? "unpin" : "pin" }} />}
          {a.status === "published" && <ActionForm action={setAnnouncementStatus} submitLabel="Archive" variant="secondary" className="inline" hidden={{ id, to: "archived" }} confirm="Take it off the board?" />}
          {a.status === "draft" && <ActionForm action={setAnnouncementStatus} submitLabel="Delete" variant="danger" className="inline" hidden={{ id, to: "delete" }} confirm="Delete this draft?" />}
        </div></div>
      <EngageTabs active="ann" />
      {a.status === "draft" && a.ai_model && <div className="alert warn" style={{ marginBottom: 16 }}>The free AI drafted this from your points. Read every line and correct it before you publish — you publish it in the company&apos;s name.</div>}

      <div className="grid two">
        <div className="card">
          <h2>As people see it</h2>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
            <b>{a.title}</b><div style={{ whiteSpace: "pre-line", marginTop: 6 }}>{a.body}</div>
            {a.needs_ack && <div style={{ marginTop: 10 }}><span className="btn small">I have read this</span></div>}
          </div>
          {a.status !== "draft" && <div style={{ marginTop: 14 }}>
            <div>Read: <Bar pct={aud.length ? (readN / aud.length) * 100 : 0} /> {readN} of {aud.length}</div>
            {a.needs_ack && <div>Acknowledged: <Bar pct={aud.length ? (ackN / aud.length) * 100 : 0} tone={ackN / Math.max(1, aud.length) >= 0.8 ? "ok" : "warn"} /> {ackN} of {aud.length}</div>}
            {a.notify && <div className="muted" style={{ fontSize: 13 }}>{a.sample ? "Sample record — nothing is sent." : `${sentN} message${sentN === 1 ? "" : "s"} sent${a.notified_at ? "" : " so far"}.`}</div>}
          </div>}
        </div>
        <div className="card">
          <h2>Edit</h2>
          <ActionForm action={saveAnnouncement} submitLabel="Save" className="formgrid" hidden={{ id }}>
            <AnnouncementFields m={m} a={a} />
          </ActionForm>
        </div>
      </div>

      {a.status !== "draft" && <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>Who has {a.needs_ack ? "acknowledged" : "read"} it</h2>
          <div className="tabs" style={{ border: 0, margin: 0 }}>{[["pending", "Not yet"], ["done", a.needs_ack ? "Acknowledged" : "Read"], ["all", "Everybody"]].map(([k, l]) =>
            <a key={k} className={who === k ? "active" : ""} href={`?who=${k}`}>{l}</a>)}</div></div>
        {!list.length ? <Empty>Nobody.</Empty> : (
          <div className="tablewrap" style={{ border: 0 }}><table><thead><tr><th>Person</th><th>Department</th><th>Read</th>{a.needs_ack && <th>Acknowledged</th>}</tr></thead>
            <tbody>{list.slice(0, 500).map((e) => { const x = r.get(e.id); return (
              <tr key={e.id}><td>{e.name} <span className="muted">{e.code}</span>{isSampleRecipient(e.email) && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Sample</span>}</td><td>{e.department ?? "—"}</td>
                <td>{x ? when(x.read_at) : "—"}</td>{a.needs_ack && <td>{x?.acknowledged_at ? when(x.acknowledged_at) : <span className="badge warn">Pending</span>}</td>}</tr>); })}</tbody></table></div>)}
      </div>}
    </AppShell>
  );
}
