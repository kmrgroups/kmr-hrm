import { requireRole, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { fetchAll } from "@/lib/attendance/service";
import { istToday } from "@/lib/attendance/time";
import { p } from "@/lib/base-path";
import { ppeFor, type PpeItem, type PpeIssue } from "@/lib/safety/rules";
import { masters, people, personLabel } from "@/app/app/qms/data";
import { SafetyTabs, dmy } from "../ui";
import { issuePpe, savePpeItem } from "../actions";

export const metadata = { title: "PPE" };

export default async function PpePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager"]);
  const hr = hasRole(session.user, HR_ROLES);
  const { v = "short" } = await searchParams;
  const db = await createClient();
  const today = istToday();
  const [{ data: items }, issues, ppl, m] = await Promise.all([
    db.from("ppe_items").select("id,name,life_months,departments,for_all,sizes,active").order("name"),
    fetchAll<PpeIssue & { id: string; qty: number; size: string | null; issued_by_name: string | null }>((a, b) => db.from("ppe_issues").select("id,employee_id,item_id,issued_on,next_due,qty,size,issued_by_name").order("issued_on", { ascending: false }).range(a, b)),
    people(db), masters(db),
  ]);
  const all = (items ?? []) as (PpeItem & { sizes: string | null })[];
  const rows = ppl.map((e) => ({ e, list: ppeFor(e, all, issues, today) })).map((r) => ({ ...r, bad: r.list.filter((x) => x.state !== "ok") }));
  const shown = v === "all" ? rows : rows.filter((r) => r.bad.length);
  const tone = { ok: "ok", due_soon: "warn", overdue: "danger", never: "danger" } as const;
  const word = { ok: "in date", due_soon: "due soon", overdue: "overdue", never: "never issued" } as const;

  return (
    <AppShell session={session} active="/app/safety">
      <div className="pagehead"><div><h1>PPE</h1><p>What each department must wear, what was issued to whom, and when it is due for replacement.{hr ? "" : " You see your team."}</p></div></div>
      <SafetyTabs active="ppe" hr={hr} />
      <div className="grid two">
        <div className="card">
          <h2>Issue PPE</h2>
          <ActionForm action={issuePpe} submitLabel="Record the issue" className="formgrid" resetOnSuccess>
            <label className="field full">To <span className="help">hold Ctrl / ⌘ to choose several</span><select name="employee_id" multiple required size={6}>{ppl.map((e) => <option key={e.id} value={e.id}>{personLabel(e)}</option>)}</select></label>
            <label className="field">PPE<select name="item_id" required defaultValue=""><option value="" disabled>Choose…</option>{all.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name} (replace after {x.life_months} months)</option>)}</select></label>
            <label className="field">Issued on<input type="date" name="issued_on" defaultValue={today} max={today} /></label>
            <label className="field">Size<input name="size" maxLength={20} /></label>
            <label className="field">Quantity<input name="qty" inputMode="numeric" defaultValue="1" /></label>
          </ActionForm>
        </div>
        <div className="card">
          <h2>PPE list</h2>
          <div className="tablewrap" style={{ border: 0 }}><table><tbody>{all.map((x) => (
            <tr key={x.id} style={{ opacity: x.active ? 1 : 0.5, verticalAlign: "top" }}><td><b>{x.name}</b><div className="muted" style={{ fontSize: 12 }}>replace after {x.life_months} months · for {x.for_all ? "everybody" : x.departments.length ? x.departments.map((d) => m.departments.find((y) => y.id === d)?.name ?? "?").join(", ") : <span className="badge warn">nobody yet — choose who needs it</span>}</div></td>
              <td>{hr && <details><summary className="btn small secondary" style={{ display: "inline-block" }}>Change</summary>
                <ActionForm action={savePpeItem} submitLabel="Save" className="stack" hidden={{ id: x.id }}>
                  <label className="field">Name<input name="name" defaultValue={x.name} maxLength={80} /></label>
                  <label className="field">Replace after (months)<input name="life_months" inputMode="numeric" defaultValue={x.life_months} /></label>
                  <label className="field">Sizes<input name="sizes" defaultValue={x.sizes ?? ""} maxLength={200} /></label>
                  <label className="field check"><input type="checkbox" name="for_all" defaultChecked={x.for_all} /> Everybody needs it</label>
                  <label className="field">…or these departments<select name="departments" multiple size={5} defaultValue={x.departments}>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                  <label className="field">In use<select name="active" defaultValue={x.active ? "on" : "off"}><option value="on">Yes</option><option value="off">No</option></select></label>
                </ActionForm></details>}</td></tr>))}</tbody></table></div>
          {hr && <details><summary className="btn small secondary" style={{ display: "inline-block", marginTop: 8 }}>Add PPE</summary>
            <ActionForm action={savePpeItem} submitLabel="Add" className="stack" resetOnSuccess>
              <label className="field">Name<input name="name" maxLength={80} required /></label>
              <label className="field">Replace after (months)<input name="life_months" inputMode="numeric" defaultValue="12" /></label>
              <label className="field check"><input type="checkbox" name="for_all" /> Everybody needs it</label>
              <label className="field">…or these departments<select name="departments" multiple size={5}>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            </ActionForm></details>}
        </div>
      </div>
      <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>People</h2>
          <div className="tabs" style={{ border: 0, margin: 0 }}>{[["short", "Missing or due"], ["all", "Everybody"]].map(([x, l]) => <a key={x} className={v === x ? "active" : ""} href={p(`/app/safety/ppe?v=${x}`)}>{l}</a>)}</div></div>
        {!shown.length ? <Empty>Everybody has the PPE they need, in date.</Empty> : <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Person</th><th>Department</th><th>PPE</th></tr></thead>
          <tbody>{shown.map(({ e, list }) => (
            <tr key={e.id}><td>{e.name} <span className="muted">{e.code}</span></td><td>{e.department ?? "—"}</td>
              <td>{list.map((x) => <span key={x.item.id} className={`badge ${tone[x.state]}`} style={{ marginRight: 4, marginBottom: 2 }} title={x.last ? `issued ${dmy(x.last.issued_on)}, due ${dmy(x.last.next_due)}` : ""}>{x.item.name}: {word[x.state]}{x.last && x.state !== "ok" ? ` (${dmy(x.last.next_due)})` : ""}</span>)}</td></tr>))}</tbody>
        </table></div>}
      </div>
    </AppShell>
  );
}
