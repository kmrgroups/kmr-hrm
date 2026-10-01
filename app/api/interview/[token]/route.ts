import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { interviewByToken } from "@/lib/recruit/links";
import { notify } from "@/lib/notify";
import { currentOrigin } from "@/lib/tenant";
import { fmtWhen } from "@/lib/recruit/format";

export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** The candidate confirms the interview or asks for another time */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await interviewByToken(token);
  if (!found) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const { iv, tenant } = found;
  if (["cancelled", "done", "no_show"].includes(iv.status) || new Date(iv.starts_at).getTime() < Date.now()) return NextResponse.json({ error: "This interview can no longer be changed here." }, { status: 410 });
  const body = await req.json().catch(() => ({})) as { action?: string; note?: string };
  const action = body.action === "reschedule" ? "reschedule" : body.action === "confirm" ? "confirm" : null;
  if (!action) return NextResponse.json({ error: "Choose an option." }, { status: 400 });
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const db = createAdminClient();
  await db.from("interviews").update({ status: action === "confirm" ? "confirmed" : "reschedule_requested", candidate_note: action === "reschedule" ? note : iv.candidate_note }).eq("id", iv.id);
  // tell whoever scheduled it, and the company's HR inbox
  const a = one(iv.application as unknown as { id: string; candidate: { full_name: string }; requisition: { title: string } });
  const { data: who } = iv.created_by ? await db.from("app_users").select("full_name,email").eq("id", iv.created_by).maybeSingle() : { data: null };
  const s = tenant.settings ?? {}, to = [who?.email, s.hr_notify_email].filter((v, i, x) => v && x.indexOf(v) === i) as string[];
  const origin = await currentOrigin();
  for (const email of to) await notify({ tenant, event: "interview_update", channels: ["email"], to: { name: who?.full_name ?? "HR", email }, related: { type: "interviews", id: iv.id },
    vars: { candidate: one(a?.candidate)?.full_name, update: action === "confirm" ? "confirmed" : "asked for another time", when: fmtWhen(iv.starts_at), role: one(a?.requisition)?.title,
      note: note ? `Their note: “${note}”` : "", link: `${origin}/app/recruitment/candidates/${a?.id}` } });
  return NextResponse.json({ ok: action === "confirm" ? "Thank you — your attendance is confirmed. See you then!" : "Thank you — we will contact you with a new time." });
}
