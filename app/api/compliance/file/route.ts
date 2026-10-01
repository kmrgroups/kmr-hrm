import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signedDocUrl } from "@/lib/storage";

const isId = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);

/**
 * GET ?task=<id> → the proof attached to a compliance occurrence (HR, payroll)
 * GET ?version=<id> → the PDF of a document revision (row-level security: HR any; others an approved revision open to them)
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = new URL(req.url), task = url.searchParams.get("task"), version = url.searchParams.get("version");
  const db = await createClient();
  let path: string | null = null;
  if (isId(task)) {
    if (!hasRole(s.user, [...HR_ROLES, "payroll"])) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    const { data } = await db.from("compliance_tasks").select("evidence_path").eq("id", task).maybeSingle();
    path = data?.evidence_path ?? null;
  } else if (isId(version)) {
    const { data } = await db.from("document_versions").select("file_path").eq("id", version).maybeSingle();
    path = data?.file_path ?? null;
  }
  if (!path || !path.startsWith(`${s.tenant.id}/`)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const signed = await signedDocUrl(path, 120);
  return signed ? NextResponse.redirect(signed) : NextResponse.json({ error: "Not found." }, { status: 404 });
}
