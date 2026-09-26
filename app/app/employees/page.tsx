import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, fullName, fmtDate, Empty, Avatar, one } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { STATUS_LABELS, type EmployeeStatus } from "@/lib/types";

export const metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; dept?: string }> }) {
  const session = await requireRole([...HR_ROLES, "manager", "payroll"]);
  const { q = "", status = "", dept = "" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("employees")
    .select("id,employee_code,first_name,last_name,status,date_of_joining,mobile,designation:designations(name),department:departments(name),plant:plants(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status === "pending") query = query.in("status", ["invited", "onboarding", "submitted", "sent_back"]);
  else if (status) query = query.eq("status", status);
  if (dept) query = query.eq("department_id", dept);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ").trim();
    query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,employee_code.ilike.%${safe}%,mobile.ilike.%${safe}%`);
  }
  const [{ data: rows }, { data: depts }] = await Promise.all([
    query,
    supabase.from("departments").select("id,name").order("name"),
  ]);
  const hr = hasRole(session.user, HR_ROLES);

  return (
    <AppShell session={session} active="/app/employees">
      <div className="pagehead">
        <div>
          <h1>Employees</h1>
          <p>{rows?.length ?? 0} shown</p>
        </div>
        {hr && <a className="btn" href={p("/app/employees/new")}><Icon name="plus" /> Add new joiner</a>}
      </div>

      <form className="toolbar" method="get">
        <input name="q" placeholder="Search name, code or mobile" defaultValue={q} />
        <select name="status" defaultValue={status}>
          <option value="">All statuses</option>
          <option value="pending">Onboarding (all stages)</option>
          {(Object.keys(STATUS_LABELS) as EmployeeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select name="dept" defaultValue={dept}>
          <option value="">All departments</option>
          {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button className="btn secondary">Filter</button>
      </form>

      <div className="tablewrap">
        {rows?.length ? (
          <table>
            <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Plant</th><th>Joined</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const des = one(e.designation);
                const dep = one(e.department);
                const pl = one(e.plant);
                return (
                  <tr key={e.id}>
                    <td>
                      <a href={p(`/app/employees/${e.id}`)} className="namecell">
                        <Avatar name={fullName(e)} />
                        <span><b>{fullName(e)}</b><div className="sub">{des?.name ?? "—"}</div></span>
                      </a>
                    </td>
                    <td className="mono">{e.employee_code ?? "—"}</td>
                    <td>{dep?.name ?? "—"}</td>
                    <td>{pl?.name ?? "—"}</td>
                    <td>{fmtDate(e.date_of_joining)}</td>
                    <td><StatusBadge status={e.status as EmployeeStatus} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>No employees match. {hr && <a href={p("/app/employees/new")}>Add a new joiner</a>}</Empty>
        )}
      </div>
    </AppShell>
  );
}
