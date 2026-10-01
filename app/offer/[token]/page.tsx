import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant";
import { PublicFrame } from "@/components/PublicFrame";
import { p } from "@/lib/base-path";
import { inr, rupeesInWords } from "@/lib/payroll/compute";
import { offerByToken } from "@/lib/recruit/links";
import type { Breakup } from "@/lib/recruit/offer";
import { OfferReply } from "./OfferReply";

export const metadata = { title: "Your offer" };
export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function OfferLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await offerByToken(token);
  if (!found) return <PublicFrame tenant={await getTenant()}><div className="card"><h1>Link not valid</h1><p>This offer link is not valid. Please use the latest message from the company, or contact them.</p></div></PublicFrame>;
  const { offer: o, tenant } = found;
  if (!o.viewed_at) await createAdminClient().from("offers").update({ viewed_at: new Date().toISOString() }).eq("id", o.id);
  const cand = one(one(o.application as unknown as { candidate: { full_name: string } })?.candidate);
  const role = one(o.designation as unknown as { name: string })?.name ?? "the role";
  const bk = o.breakup as Breakup;
  return (
    <PublicFrame tenant={tenant}>
      <div className="card stack">
        <h1 style={{ margin: 0 }}>{o.status === "accepted" ? "Welcome aboard!" : "Your offer"}</h1>
        <p style={{ margin: 0 }}>Dear {cand?.full_name}, {tenant.legal_name || tenant.name} offers you the position of <b>{role}</b>.</p>
        <dl className="kv">
          <dt>Annual CTC</dt><dd><b>Rs. {inr(o.annual_ctc)}</b><div className="muted" style={{ fontSize: 12 }}>{rupeesInWords(o.annual_ctc)}</div></dd>
          <dt>Monthly gross</dt><dd>Rs. {inr(o.monthly_gross)}</dd>
          <dt>Take-home</dt><dd>about Rs. {inr(bk.net_monthly)} a month, before income tax</dd>
          <dt>Date of joining</dt><dd>{day(o.date_of_joining)}</dd>
          <dt>Offer valid until</dt><dd>{day(o.valid_until)}</dd>
        </dl>
        <a className="btn secondary" style={{ alignSelf: "flex-start" }} href={p(`/api/offer/${token}`)} target="_blank" rel="noreferrer">Download the offer letter (PDF)</a>
        {o.status === "sent" ? <OfferReply token={token} name={cand?.full_name ?? ""} />
          : o.status === "accepted" ? <div className="alert ok">You accepted this offer{o.accepted_name ? ` (signed as “${o.accepted_name}”)` : ""}. Check your e-mail and WhatsApp for the link to complete your joining formalities.</div>
          : o.status === "declined" ? <div className="alert error">You declined this offer. Thank you for letting us know.</div>
          : o.status === "expired" ? <div className="alert error">This offer has lapsed. Please contact the company if you are still interested.</div>
          : <div className="alert error">This offer is no longer active. Please contact the company.</div>}
      </div>
    </PublicFrame>
  );
}
