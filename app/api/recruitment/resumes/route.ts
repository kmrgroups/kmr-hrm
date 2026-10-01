import { NextResponse } from "next/server";
import { assertRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { intakeResume } from "@/lib/recruit/service";
import { MAX_RESUME_BYTES } from "@/lib/recruit/resume-text";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** HR uploads one resume for a requisition (the browser sends many, one after another). */
export async function POST(req: Request) {
  let session;
  try { session = await assertRole(HR_ROLES); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 403 }); }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file"), reqId = String(form?.get("requisition_id") ?? "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/.test(reqId)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > MAX_RESUME_BYTES) return NextResponse.json({ error: `${file.name}: larger than 4 MB — save it smaller (e.g. print to PDF).` }, { status: 413 });
  const db = await createClient();
  const { data: r } = await db.from("requisitions").select("id,status").eq("id", reqId).maybeSingle();
  if (!r) return NextResponse.json({ error: "Requisition not found." }, { status: 404 });
  if (["closed", "cancelled"].includes(r.status)) return NextResponse.json({ error: "This requisition is closed." }, { status: 409 });
  const out = await intakeResume(db, { tenantId: session.tenant.id, requisitionId: reqId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), source: "upload", createdBy: session.user.id });
  return NextResponse.json(out.ok ? out : { error: out.error }, { status: out.ok ? 200 : 400 });
}
