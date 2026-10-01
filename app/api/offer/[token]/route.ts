import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { offerByToken } from "@/lib/recruit/links";
import { offerLetterPdf } from "@/lib/recruit/offer-letter";
import { hireFromOffer } from "@/lib/recruit/hire";
import { currentOrigin } from "@/lib/tenant";
import { notify } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { inr } from "@/lib/payroll/compute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** the offer letter for the candidate holding the link */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await offerByToken(token);
  if (!found) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const r = await offerLetterPdf(createAdminClient(), found.tenant, found.offer.id);
  if (!r) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  return new NextResponse(Buffer.from(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Offer-${r.ref}.pdf"`, "cache-control": "no-store" } });
}

/** the candidate accepts (typed name as signature) or declines */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await offerByToken(token);
  if (!found) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const { offer: o, tenant } = found;
  if (o.status !== "sent") return NextResponse.json({ error: o.status === "expired" ? "This offer has lapsed." : "This offer has already been answered." }, { status: 410 });
  const body = await req.json().catch(() => ({})) as { action?: string; name?: string; reason?: string };
  const cand = one(one(o.application as unknown as { candidate: { full_name: string } })?.candidate);
  const origin = await currentOrigin();
  if (body.action === "accept") {
    const typed = String(body.name ?? "").trim();
    if (!cand || typed.toLowerCase() !== cand.full_name.trim().toLowerCase()) return NextResponse.json({ error: `Type your name exactly as “${cand?.full_name}”.` }, { status: 400 });
    const r = await hireFromOffer(tenant, o.id, typed, origin);
    return NextResponse.json({ ok: r.onboardingLink
      ? "Thank you, and welcome! We have sent you a link (e-mail and WhatsApp) to complete your joining formalities online — please do it before your joining date."
      : "Thank you, and welcome! HR will contact you about your joining formalities." });
  }
  if (body.action === "decline") {
    const db = createAdminClient(), reason = String(body.reason ?? "").trim().slice(0, 500) || null;
    await db.from("offers").update({ status: "declined", responded_at: new Date().toISOString(), decline_reason: reason }).eq("id", o.id);
    await db.from("applications").update({ status: "withdrawn" }).eq("id", o.application_id);
    await logAudit({ tenantId: tenant.id, actorId: null, action: "offer.declined", entity: "offers", entityId: o.id, data: { reason } });
    const s = tenant.settings ?? {};
    if (s.hr_notify_email || s.hr_notify_phone) await notify({ tenant, event: "offer_response", to: { name: "HR", email: s.hr_notify_email, phone: s.hr_notify_phone }, related: { type: "offers", id: o.id },
      vars: { candidate: cand?.full_name, response: "declined", role: one(o.designation as unknown as { name: string })?.name ?? "", ctc: `Rs. ${inr(o.annual_ctc)} a year`, note: reason ? `Reason: “${reason}”` : "", link: `${origin}/app/recruitment/candidates/${o.application_id}` } });
    return NextResponse.json({ ok: "Thank you for letting us know. We wish you all the best." });
  }
  return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 });
}
