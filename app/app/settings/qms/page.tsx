import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { saveQmsSettings } from "@/app/app/qms/actions";
import { qmsSettings } from "@/app/app/qms/data";

export const metadata = { title: "QMS settings" };

export default async function QmsSettingsPage() {
  const session = await requireRole(["hr_manager"]);
  const st = await qmsSettings(await createClient());
  return (
    <AppShell session={session} active="/app/settings/qms">
      <div className="pagehead"><div><h1>QMS settings</h1><p>The quality policy and objectives every person must know (IATF 7.3), the customer-specific requirements for awareness, and the rules for the skill matrix and training.</p></div></div>
      <div className="card">
        <ActionForm action={saveQmsSettings} submitLabel="Save" className="formgrid">
          <label className="field full">Quality policy<textarea name="quality_policy" rows={5} maxLength={3000} defaultValue={st.quality_policy ?? ""} /></label>
          <label className="field full">Quality objectives (one per line)<textarea name="objectives" rows={4} defaultValue={st.objectives.join("\n")} /></label>
          <label className="field full">Customer-specific requirements to make people aware of (one per line)<textarea name="csr" rows={4} defaultValue={st.csr.join("\n")} placeholder="Customer A: retain first-off parts for one shift" /></label>
          <label className="field">Qualified people needed per operation<input name="min_qualified" inputMode="numeric" defaultValue={st.min_qualified} /><span className="help">Level 3 or 4; an operation can ask for more</span></label>
          <label className="field">Check training effectiveness after<select name="eff_days" defaultValue={String(st.eff_days)}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select><span className="help">A programme can set its own</span></label>
          <label className="field">A new joiner for<input name="new_joiner_days" inputMode="numeric" defaultValue={st.new_joiner_days} /><span className="help">days — induction, safety induction and quality awareness are due</span></label>
        </ActionForm>
      </div>
    </AppShell>
  );
}
