import type { Masters } from "@/lib/masters";

interface Values {
  first_name?: string; last_name?: string | null; email?: string | null; mobile?: string | null;
  designation_id?: string | null; department_id?: string | null; plant_id?: string | null; position_id?: string | null;
  reporting_manager_id?: string | null; employment_type?: string; category?: string; date_of_joining?: string | null;
}

const EMPLOYMENT_TYPES = [
  ["permanent", "Permanent"], ["probation", "Probation"], ["fixed_term", "Fixed term"],
  ["trainee", "Trainee"], ["apprentice", "Apprentice"], ["contract", "Contract"],
] as const;
const CATEGORIES = [["staff", "Staff"], ["workman", "Workman"], ["management", "Management"]] as const;

function Select({ name, label, options, value, placeholder }: {
  name: string; label: string; options: { id: string; name: string; extra?: string | null }[]; value?: string | null; placeholder: string;
}) {
  return (
    <label className="field">{label}
      <select name={name} defaultValue={value ?? ""}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.extra ? ` (${o.extra})` : ""}</option>)}
      </select>
    </label>
  );
}

export function EmployeeFields({ masters, v = {}, excludeId }: { masters: Masters; v?: Values; excludeId?: string }) {
  return (
    <div className="formgrid">
      <label className="field"><span>First name <span className="req">*</span></span><input name="first_name" required defaultValue={v.first_name} /></label>
      <label className="field">Last name<input name="last_name" defaultValue={v.last_name ?? ""} /></label>
      <label className="field"><span>Email <span className="req">*</span></span><input name="email" type="email" required defaultValue={v.email ?? ""} /><span className="help">Onboarding link and login are sent here</span></label>
      <label className="field"><span>Mobile (WhatsApp) <span className="req">*</span></span><input name="mobile" type="tel" required defaultValue={v.mobile ?? ""} placeholder="98450 12345" /></label>
      <Select name="designation_id" label="Designation" options={masters.designations} value={v.designation_id} placeholder="Select designation" />
      <Select name="department_id" label="Department" options={masters.departments} value={v.department_id} placeholder="Select department" />
      <Select name="position_id" label="Position (for R&R, competency mapping and KPIs)" options={masters.positions} value={v.position_id} placeholder="Select position" />
      <Select name="plant_id" label="Plant / location" options={masters.plants} value={v.plant_id} placeholder="Select plant" />
      <Select name="reporting_manager_id" label="Reporting manager" options={masters.managers.filter((m) => m.id !== excludeId)} value={v.reporting_manager_id} placeholder="Select manager" />
      <label className="field">Employment type
        <select name="employment_type" defaultValue={v.employment_type ?? "permanent"}>
          {EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="field">Category
        <select name="category" defaultValue={v.category ?? "staff"}>
          {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="field">Date of joining<input name="date_of_joining" type="date" defaultValue={v.date_of_joining ?? ""} /></label>
    </div>
  );
}
