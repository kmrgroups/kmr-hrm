import { p } from "@/lib/base-path";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { AppShell } from "@/components/AppShell";
import { EmployeeFields } from "@/components/EmployeeFields";
import { ActionForm } from "@/components/ActionForm";
import { createEmployee } from "../actions";

export const metadata = { title: "Add new joiner" };

export default async function NewEmployeePage() {
  const session = await requireRole(HR_ROLES);
  const masters = await loadMasters();
  return (
    <AppShell session={session} active="/app/employees">
      <div className="pagehead">
        <div>
          <h1>Add new joiner</h1>
          <p>Enter the basics. The new joiner receives a secure link on email and WhatsApp to fill in everything else and upload documents.</p>
        </div>
      </div>
      <div className="card">
        <ActionForm action={createEmployee} submitLabel="Add and send onboarding link" pendingLabel="Sending…">
          <EmployeeFields masters={masters} />
          <label className="check"><input type="checkbox" name="send_link" value="no" /> Add now, send the link later</label>
        </ActionForm>
      </div>
      <p style={{ marginTop: 14 }}><a href={p("/app/employees")}>← All employees</a></p>
    </AppShell>
  );
}
