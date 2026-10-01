import { MasterSelect, type Opt } from "./ui";
import { ROLE_SUGGESTIONS } from "@/lib/recruit/roles";
import { COMP_CATEGORIES } from "@/lib/qms/rules";

/** the fields of a requisition (new and edit): the position is Position + Role + Department */
export function RequisitionFields({ d, desigs, depts, plants, titles = [], roles = [], comps = [], role }: { d?: Record<string, unknown> | null; desigs: Opt[]; depts: Opt[]; plants: Opt[];
  titles?: string[]; roles?: string[]; comps?: { name: string; category: string }[]; role?: string | null }) {
  const v = (k: string) => (d?.[k] == null ? "" : String(d[k]));
  const l = (k: string) => (d?.[k] == null ? "" : String(Number(d[k]) / 1e5));
  const roleList = [...new Set([...roles, ...ROLE_SUGGESTIONS])];
  return (
    <>
      <label className="field">Position<input name="title" required maxLength={120} defaultValue={v("title")} list="req-positions" placeholder="e.g. Calibration Incharge, Production Head" />
        <span className="help">The job description is kept against Position + Role + Department and reused for the next opening</span></label>
      <datalist id="req-positions">{titles.map((t) => <option key={t} value={t} />)}</datalist>
      <label className="field">Role<input name="role" maxLength={160} defaultValue={role ?? ""} list="req-roles" placeholder="e.g. Shopfloor & manpower handling" /></label>
      <datalist id="req-roles">{roleList.map((t) => <option key={t} value={t} />)}</datalist>
      <MasterSelect name="department_id" label="Department" list={depts} value={v("department_id")} required />
      <MasterSelect name="designation_id" label="Designation (for the new joiner's record only)" list={desigs} value={v("designation_id")} />
      <MasterSelect name="plant_id" label="Plant" list={plants} value={v("plant_id")} />
      <label className="field">Number of posts<input name="headcount" type="number" min={1} max={500} defaultValue={v("headcount") || "1"} /></label>
      <label className="field">Experience from (years)<input name="exp_min" inputMode="decimal" defaultValue={v("exp_min")} placeholder="e.g. 3" /></label>
      <label className="field">Experience up to (years)<input name="exp_max" inputMode="decimal" defaultValue={v("exp_max")} placeholder="e.g. 6" /></label>
      <label className="field">Salary from (lakhs a year)<input name="ctc_min" inputMode="decimal" defaultValue={l("ctc_min")} placeholder="e.g. 4.5" /></label>
      <label className="field">Salary up to (lakhs a year)<input name="ctc_max" inputMode="decimal" defaultValue={l("ctc_max")} placeholder="e.g. 7" /><span className="help">Candidates asking for much more are flagged</span></label>
      <label className="field">Longest notice period accepted (days)<input name="notice_max_days" inputMode="numeric" defaultValue={v("notice_max_days")} placeholder="e.g. 60" /></label>
      <label className="field">Location<input name="location" maxLength={120} defaultValue={v("location")} placeholder="e.g. Hosur" /></label>
      <label className="field">Grade<input name="grade" maxLength={40} defaultValue={v("grade")} placeholder="optional" /></label>
      <label className="field">Needed by<input name="required_by" type="date" defaultValue={v("required_by")} /></label>
      <label className="field">Reason<select name="reason" defaultValue={v("reason") || "new"}><option value="new">New position</option><option value="replacement">Replacement</option><option value="project">Project / temporary</option></select></label>
      <label className="field">Replacing (if a replacement)<input name="replacement_for" maxLength={120} defaultValue={v("replacement_for")} /></label>
      {comps.length > 0 && !d && (
        <details className="field full"><summary style={{ cursor: "pointer", fontWeight: 600 }}>Competencies the position needs (optional)</summary>
          <p className="help" style={{ margin: "6px 0" }}>Ticked ones go into the job description as must-haves; the HRM adds the usual ones for the position and role.</p>
          {Object.entries(COMP_CATEGORIES).map(([cat, label]) => { const list = comps.filter((c) => c.category === cat); return list.length ? (
            <fieldset key={cat} className="chips" style={{ marginBottom: 8 }}><legend>{label}</legend>
              {list.map((c) => <label key={c.name} className="check"><input type="checkbox" name="competency" value={c.name} /> {c.name}</label>)}</fieldset>) : null; })}
        </details>)}
      <label className="field full">Notes for HR<textarea name="notes" rows={2} maxLength={2000} defaultValue={v("notes")} placeholder="Anything special about this opening (shift, customer, machines …)" /></label>
    </>
  );
}
