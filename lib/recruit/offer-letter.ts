import "server-only";
// One place that builds an offer's letter, so the preview HR sees and the PDF the candidate gets are the same.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tenant } from "@/lib/types";
import { buildOfferPdf } from "./offer-pdf";
import { recruitSettings } from "./service";

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function offerLetterPdf(db: SupabaseClient, tenant: Tenant, offerId: string, date?: string): Promise<{ pdf: Uint8Array; ref: string; candidate: { full_name: string; email: string | null; phone: string | null } | null; role: string } | null> {
  const { data: o } = await db.from("offers").select("*, designation:designations(name), department:departments(name), plant:plants(name), manager:employees!offers_reporting_manager_id_fkey(first_name,last_name), application:applications(candidate:candidates(full_name,email,phone), requisition:requisitions(location))").eq("id", offerId).maybeSingle();
  if (!o) return null;
  const app = one(o.application as { candidate: { full_name: string; email: string | null; phone: string | null }; requisition: { location: string | null } } | null);
  const cand = one(app?.candidate);
  const mgr = one(o.manager as { first_name: string; last_name: string | null } | null);
  const st = await recruitSettings(db, tenant.id);
  const role = one(o.designation as { name: string } | null)?.name ?? "the role";
  const pdf = await buildOfferPdf(tenant, {
    ref_no: o.ref_no, date: date ?? (o.sent_at ?? new Date().toISOString()).slice(0, 10), candidate: cand?.full_name ?? "Candidate", email: cand?.email, phone: cand?.phone,
    role, department: one(o.department as { name: string } | null)?.name, plant: one(o.plant as { name: string } | null)?.name ?? one(app?.requisition)?.location,
    reporting_to: mgr ? `${mgr.first_name} ${mgr.last_name ?? ""}`.trim() : null, employment_type: o.employment_type, date_of_joining: o.date_of_joining, valid_until: o.valid_until,
    breakup: o.breakup, terms: o.terms, signatory: st.offer_signatory,
  });
  return { pdf, ref: o.ref_no, candidate: cand, role };
}
