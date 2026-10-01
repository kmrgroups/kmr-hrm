import "server-only";
// Candidate accepts the offer → the new joiner is created (employee, salary from the offer) and gets the
// self-onboarding link automatically. Called from the public offer link after its token is checked.
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOnboardingLink } from "@/lib/onboarding";
import { assertSeat } from "@/lib/licence";
import { notify } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { normalizeIndianMobile } from "@/lib/validators";
import { inr } from "@/lib/payroll/compute";
import type { Tenant } from "@/lib/types";
import type { Breakup } from "./offer";

export interface HireResult { employeeId: string | null; onboardingLink: string | null; note: string | null }

export async function hireFromOffer(tenant: Tenant, offerId: string, acceptedName: string, origin: string): Promise<HireResult> {
  const db = createAdminClient();
  const { data: o } = await db.from("offers").select("*, application:applications(id, requisition_id, candidate:candidates(*))").eq("id", offerId).eq("tenant_id", tenant.id).single();
  if (!o) throw new Error("Offer not found");
  const app = Array.isArray(o.application) ? o.application[0] : o.application;
  const cand = Array.isArray(app?.candidate) ? app.candidate[0] : app?.candidate;
  const { data: req } = await db.from("requisitions").select("title,position_id").eq("id", app.requisition_id).maybeSingle();
  const now = new Date().toISOString();
  await db.from("offers").update({ status: "accepted", responded_at: now, accepted_name: acceptedName.slice(0, 120) }).eq("id", offerId);
  await db.from("applications").update({ status: "joined" }).eq("id", app.id);

  let employeeId: string | null = null, link: string | null = null, note: string | null = null;
  try {
    // the same person already on the company's books (e.g. rejoining): reuse that record
    const { data: same } = cand?.email ? await db.from("employees").select("id,status").eq("tenant_id", tenant.id).eq("email", cand.email).maybeSingle() : { data: null };
    if (same && same.status !== "exited") {
      employeeId = same.id; note = "This person is already an employee record; the offer was linked to it.";
      if (req?.position_id) await db.from("employees").update({ position_id: req.position_id }).eq("id", same.id).is("position_id", null);
    }
    else {
      await assertSeat(tenant.id);
      const parts = String(cand?.full_name || acceptedName).trim().split(/\s+/);
      const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
      const last = parts.length > 1 ? parts[parts.length - 1] : null;
      const { data: emp, error } = await db.from("employees").insert({
        tenant_id: tenant.id, status: "invited", first_name: first.slice(0, 60), last_name: last?.slice(0, 60) ?? null,
        email: cand?.email ?? null, mobile: normalizeIndianMobile(cand?.phone ?? "") ?? cand?.phone ?? null,
        designation_id: o.designation_id, department_id: o.department_id, plant_id: o.plant_id, reporting_manager_id: o.reporting_manager_id, position_id: req?.position_id ?? null,
        employment_type: o.employment_type, category: o.category, date_of_joining: o.date_of_joining, created_by: o.created_by,
      }).select("id").single();
      if (error) throw new Error(error.message);
      employeeId = emp.id;
      // the salary from the offer, ready for the first payroll
      const bk = o.breakup as Breakup;
      await db.from("salary_structures").insert({
        tenant_id: tenant.id, employee_id: employeeId, effective_from: o.date_of_joining, monthly_gross: o.monthly_gross,
        components: (bk.earnings ?? []).filter((e) => e.code !== "OT" && e.code !== "ADJ").map((e) => ({ code: e.code, name: e.name, amount: e.monthly })),
        pf_applicable: o.pf_applicable, notes: `From offer ${o.ref_no}`, created_by: o.created_by,
      });
    }
    await db.from("offers").update({ employee_id: employeeId }).eq("id", offerId);
    if (employeeId) {
      const r = await sendOnboardingLink({ tenant, employeeId, actorId: o.created_by ?? "00000000-0000-0000-0000-000000000000", actorName: "Offer accepted", origin });
      link = r.link;
    }
  } catch (e) {
    note = `The offer is accepted, but the new joiner could not be created automatically: ${(e as Error).message} Please add them under Employees.`;
  }
  await logAudit({ tenantId: tenant.id, actorId: null, action: "offer.accepted", entity: "offers", entityId: offerId, data: { employeeId, note } });
  const s = tenant.settings ?? {};
  if (s.hr_notify_email || s.hr_notify_phone) {
    await notify({ tenant, event: "offer_response", to: { name: "HR", email: s.hr_notify_email, phone: s.hr_notify_phone }, related: { type: "offers", id: offerId },
      vars: { candidate: cand?.full_name, response: "accepted", role: req?.title ?? "", ctc: `Rs. ${inr(o.annual_ctc)} a year`,
        note: employeeId ? `The self-onboarding link has been sent to them automatically.${note ? " " + note : ""}` : note ?? "", link: `${origin}/app/recruitment/candidates/${app.id}` } });
  }
  return { employeeId, onboardingLink: link, note };
}
