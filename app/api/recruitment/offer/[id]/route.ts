import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { offerLetterPdf } from "@/lib/recruit/offer-letter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The offer letter PDF as the candidate gets it (HR only) */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !hasRole(s.user, HR_ROLES)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const r = await offerLetterPdf(await createClient(), s.tenant, id);
  if (!r) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  return new NextResponse(Buffer.from(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Offer-${r.ref}.pdf"`, "cache-control": "no-store" } });
}
