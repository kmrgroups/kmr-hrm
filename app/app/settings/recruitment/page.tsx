import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentOrigin } from "@/lib/tenant";
import { AppShell } from "@/components/AppShell";
import { ActionForm, CopyLink } from "@/components/ActionForm";
import { recruitSettings } from "@/lib/recruit/service";
import { saveRecruitSettings } from "../../recruitment/actions";
import { RecruitTabs } from "../../recruitment/ui";

export const metadata = { title: "Recruitment settings" };

export default async function RecruitSettingsPage() {
  const session = await requireRole(["hr_manager"]);
  const s = await recruitSettings(await createClient(), session.tenant.id);
  const origin = await currentOrigin();
  return (
    <AppShell session={session} active="/app/recruitment">
      <div className="pagehead"><div><h1>Recruitment settings</h1><p>Careers page, scoring, regret messages and the offer letter.</p></div></div>
      <RecruitTabs active="settings" />
      <ActionForm action={saveRecruitSettings} submitLabel="Save settings">
        <div className="grid two">
          <div className="card stack">
            <h2>Careers page</h2>
            <label className="check"><input type="checkbox" name="careers_enabled" defaultChecked={s.careers_enabled} /> Show our open roles on a public careers page</label>
            <CopyLink link={`${origin}/careers?co=${session.tenant.slug}`} />
            <label className="field">Introduction on the careers page<textarea name="careers_intro" rows={4} maxLength={2000} defaultValue={s.careers_intro ?? ""} placeholder="A few lines about the company, the plant and why people like working here." /></label>
            <label className="check"><input type="checkbox" name="req_approval" defaultChecked={s.req_approval} /> A manager's requisition waits for HR approval</label>
          </div>
          <div className="card stack">
            <h2>Scoring and regret messages</h2>
            <label className="field">“Suitable” from this score<input name="suitable_score" type="number" min={1} max={100} defaultValue={s.suitable_score} /></label>
            <label className="field">“Maybe” from this score (below it: not suitable)<input name="hold_score" type="number" min={0} max={99} defaultValue={s.hold_score} /></label>
            <label className="check"><input type="checkbox" name="regret_auto" defaultChecked={s.regret_auto} /> Send a courteous regret message to declined candidates</label>
            <label className="field">…after this many days<input name="regret_delay_days" type="number" min={0} max={30} defaultValue={s.regret_delay_days} /><span className="help">A short wait lets you change your mind; 0 = the next morning.</span></label>
          </div>
          <div className="card stack" style={{ gridColumn: "1 / -1" }}>
            <h2>Offer letter</h2>
            <label className="field">Offer valid for (days)<input name="offer_valid_days" type="number" min={1} max={60} defaultValue={s.offer_valid_days} /></label>
            <label className="check"><input type="checkbox" name="gratuity_in_ctc" defaultChecked={s.gratuity_in_ctc} /> Show gratuity (4.81% of basic) as part of the CTC</label>
            <label className="field">Signed by (name and title)<input name="offer_signatory" maxLength={120} defaultValue={s.offer_signatory ?? ""} placeholder="e.g. R. Kumar, Head – HR" /></label>
            <label className="field">Standard terms<textarea name="offer_terms" rows={8} maxLength={6000} defaultValue={s.offer_terms ?? ""} /></label>
          </div>
        </div>
      </ActionForm>
    </AppShell>
  );
}
