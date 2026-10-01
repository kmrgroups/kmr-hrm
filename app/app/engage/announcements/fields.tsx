import { ANN_CATEGORIES } from "@/lib/engage/rules";

interface A { title?: string; body?: string; category?: string; audience?: string; department_id?: string | null; plant_id?: string | null; pinned?: boolean; needs_ack?: boolean; notify?: boolean; publish_on?: string | null; expires_on?: string | null }
type M = { departments: { id: string; name: string }[]; plants: { id: string; name: string }[] };

export function AnnouncementFields({ m, a = {} }: { m: M; a?: A }) {
  return <>
    <label className="field full">Title<input name="title" required maxLength={160} defaultValue={a.title ?? ""} /></label>
    <label className="field full">Message<textarea name="body" rows={8} required maxLength={5000} defaultValue={a.body ?? ""} /></label>
    <label className="field">Category<select name="category" defaultValue={a.category ?? "general"}>{Object.entries(ANN_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">For<select name="audience" defaultValue={a.audience ?? "all"}><option value="all">Everybody</option><option value="department">A department</option><option value="plant">A plant</option></select></label>
    <label className="field">Department (if for a department)<select name="department_id" defaultValue={a.department_id ?? ""}><option value="">—</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="field">Plant (if for a plant)<select name="plant_id" defaultValue={a.plant_id ?? ""}><option value="">—</option>{m.plants.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="field">Publish on <span className="help">blank = when you press Publish</span><input type="date" name="publish_on" defaultValue={a.publish_on ?? ""} /></label>
    <label className="field">Take off the board after <span className="help">optional</span><input type="date" name="expires_on" defaultValue={a.expires_on ?? ""} /></label>
    <label className="field check"><input type="checkbox" name="needs_ack" defaultChecked={a.needs_ack ?? false} /> Each person must acknowledge it</label>
    <label className="field check"><input type="checkbox" name="pinned" defaultChecked={a.pinned ?? false} /> Pin to the top</label>
    <label className="field check full"><input type="checkbox" name="notify" defaultChecked={a.notify ?? true} /> Send it by e-mail and WhatsApp when published</label>
  </>;
}
