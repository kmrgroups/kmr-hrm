import { DOC_KINDS } from "@/lib/compliance/rules";

type M = { departments: { id: string; name: string }[]; plants: { id: string; name: string }[] };
interface D { doc_no?: string; title?: string; kind?: string; owner_department_id?: string | null; owner_name?: string | null; employee_access?: boolean; needs_ack?: boolean;
  audience?: string; department_id?: string | null; plant_id?: string | null; review_months?: number }

export function DocFields({ m, d = {}, edit = false }: { m: M; d?: D; edit?: boolean }) {
  return <>
    <label className="field full">Title<input name="title" required maxLength={160} defaultValue={d.title ?? ""} placeholder="e.g. Mobile phone policy" /></label>
    <label className="field">Type<select name="kind" defaultValue={d.kind ?? "policy"}>{Object.entries(DOC_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Doc. no. <span className="help">{edit ? "" : "blank = next free (HR-POL-01 …)"}</span><input name="doc_no" maxLength={40} defaultValue={d.doc_no ?? ""} /></label>
    <label className="field">Owner department<select name="owner_department_id" defaultValue={d.owner_department_id ?? ""}><option value="">—</option>{m.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="field">Owner <span className="help">a position, e.g. HR Manager</span><input name="owner_name" maxLength={120} defaultValue={d.owner_name ?? "HR Manager"} /></label>
    <label className="field">Review every (months)<input name="review_months" inputMode="numeric" defaultValue={d.review_months ?? 12} /></label>
    <label className="field">For<select name="audience" defaultValue={d.audience ?? "all"}><option value="all">Everybody</option><option value="department">A department</option><option value="plant">A plant</option></select></label>
    <label className="field">Department (if for a department)<select name="department_id" defaultValue={d.department_id ?? ""}><option value="">—</option>{m.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="field">Plant (if for a plant)<select name="plant_id" defaultValue={d.plant_id ?? ""}><option value="">—</option>{m.plants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="field check"><input type="checkbox" name="employee_access" defaultChecked={d.employee_access ?? true} /> People can read it in their portal</label>
    <label className="field check"><input type="checkbox" name="needs_ack" defaultChecked={d.needs_ack ?? (d.kind ?? "policy") === "policy"} /> Each person must acknowledge each revision</label>
  </>;
}
