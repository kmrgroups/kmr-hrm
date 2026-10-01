import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantById } from "@/lib/tenant";
import { intakeResume } from "@/lib/recruit/service";
import { MAX_RESUME_BYTES } from "@/lib/recruit/resume-text";
import { notify } from "@/lib/notify";
import { normalizeIndianMobile, isValidEmail } from "@/lib/validators";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A candidate applies from the careers page (no sign-in) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return err("This role is not open.", 404);
  const form = await req.formData().catch(() => null);
  if (!form) return err("Please fill in the form.");
  if (String(form.get("website") ?? "")) return NextResponse.json({ ok: true });       // a robot filled in the hidden field
  const db = createAdminClient();
  const { data: r } = await db.from("requisitions").select("id,tenant_id,title,status").eq("id", id).maybeSingle();
  const tenant = r ? await tenantById(r.tenant_id) : null;
  if (!r || !tenant || r.status !== "open") return err("This role is not open any more.", 410);
  const name = String(form.get("full_name") ?? "").trim().slice(0, 120), email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  const phone = normalizeIndianMobile(String(form.get("phone") ?? ""));
  if (name.length < 2) return err("Please enter your full name.");
  if (!isValidEmail(email)) return err("Please check your e-mail address.");
  if (!phone) return err("Please enter a 10-digit Indian mobile number.");
  if (form.get("consent") !== "on") return err("Please tick the consent box.");
  const file = form.get("resume");
  if (!(file instanceof File) || !file.size) return err("Please attach your resume.");
  if (file.size > MAX_RESUME_BYTES) return err("Your resume is larger than 4 MB — please save a smaller copy.", 413);
  const num = (k: string) => { const v = Number(String(form.get(k) ?? "").replace(/[, ]/g, "")); return String(form.get(k) ?? "").trim() && Number.isFinite(v) ? v : null; };
  const lakhs = (k: string) => { const v = num(k); return v == null ? null : Math.round(v * (v < 200 ? 1e5 : 1)); };
  const out = await intakeResume(db, { tenantId: tenant.id, requisitionId: r.id, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), source: "careers",
    given: { full_name: name, email, phone, location: String(form.get("location") ?? "").trim().slice(0, 80) || null, total_exp: num("total_exp"), notice_days: num("notice_days"),
      current_ctc: lakhs("current_ctc"), expected_ctc: lakhs("expected_ctc"), consent: true } });
  if (!out.ok) return err(out.error ?? "We could not read that file — please try PDF or Word.");
  await notify({ tenant, event: "application_received", to: { name, email, phone }, related: { type: "applications", id: out.applicationId! }, vars: { role: r.title } });
  return NextResponse.json({ ok: true });
}
