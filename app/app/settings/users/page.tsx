import { p } from "@/lib/base-path";
import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { fullName } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { createUser, updateUser } from "../actions";

export const metadata = { title: "Users & roles" };

const ASSIGNABLE: Role[] = ["company_admin", "hr_manager", "hr_executive", "payroll", "manager", "interviewer", "employee"];

const ROLE_HELP: Partial<Record<Role, string>> = {
  company_admin: "Everything, including company settings and users",
  hr_manager: "All HR work, message templates and audit trail",
  hr_executive: "Day-to-day onboarding, employees and ID cards",
  payroll: "Employee list and bank / statutory details",
  manager: "Their own team (direct and indirect reports)",
  interviewer: "Interviews assigned to them (recruitment module)",
};

export default async function UsersPage() {
  const session = await requireRole(ADMIN_ROLES);
  const supabase = await createClient();
  const [{ data: users }, { data: employees }] = await Promise.all([
    supabase.from("app_users").select("id,full_name,email,phone,role,active,employee_id").order("role").order("full_name"),
    supabase.from("employees").select("id,first_name,last_name,employee_code").eq("status", "active").order("first_name").limit(2000),
  ]);
  const staff = (users ?? []).filter((u) => u.role !== "employee");
  const empCount = (users ?? []).filter((u) => u.role === "employee").length;

  return (
    <AppShell session={session} active="/app/settings/users">
      <div className="pagehead"><div><h1>Users &amp; roles</h1><p>{staff.length} staff users · {empCount} employee logins (created automatically at onboarding)</p></div></div>

      <div className="card">
        <h2>Add a staff user</h2>
        <ActionForm action={createUser} submitLabel="Create user and send login" resetOnSuccess>
          <div className="formgrid">
            <label className="field">Full name<input name="full_name" required /></label>
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Mobile (WhatsApp)<input name="phone" type="tel" /></label>
            <label className="field">Role
              <select name="role" defaultValue="hr_executive">
                {ASSIGNABLE.filter((r) => r !== "employee").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]} — {ROLE_HELP[r]}</option>)}
              </select>
            </label>
            <label className="field full">Link to employee record (optional)
              <select name="employee_id" defaultValue="">
                <option value="">Not an employee (e.g. consultant)</option>
                {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)} ({e.employee_code})</option>)}
              </select>
              <span className="help">Linking lets managers see their team and gives the person their own employee portal.</span>
            </label>
          </div>
        </ActionForm>
      </div>

      <div className="tablewrap" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                <td><b>{u.full_name}</b>{u.employee_id ? <div><small><a href={p(`/app/employees/${u.employee_id}`)}>employee record</a></small></div> : null}</td>
                <td className="mono">{u.email}</td>
                <td>
                  {u.id === session.user.id ? ROLE_LABELS[u.role as Role] + " (you)" : (
                    <form action={updateUser} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="id" value={u.id} />
                      <select name="role" defaultValue={u.role} style={{ width: "auto", minHeight: 34, padding: "4px 8px" }}>
                        {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button className="btn secondary small">Change</button>
                    </form>
                  )}
                </td>
                <td>{u.active ? <span className="badge ok">Active</span> : <span className="badge">Disabled</span>}</td>
                <td style={{ textAlign: "right" }}>
                  {u.id !== session.user.id && (
                    <form action={updateUser}>
                      <input type="hidden" name="id" value={u.id} /><input type="hidden" name="active" value={u.active ? "0" : "1"} />
                      <button className="btn ghost small">{u.active ? "Disable" : "Enable"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
