import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resumeLink } from "@/lib/recruit/service";
import { p } from "@/lib/base-path";

export const dynamic = "force-dynamic";

/** Opens a candidate's resume: HR, or a panel member of one of the candidate's interviews (row-level security decides). */
export async function GET(_: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL(p("/login"), _.url));
  if (!hasRole(s.user, [...HR_ROLES, "manager", "interviewer"])) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { candidateId } = await params;
  const { data } = await (await createClient()).from("candidates").select("resume_path").eq("id", candidateId).maybeSingle();
  const url = await resumeLink(data?.resume_path ?? null, 120);
  if (!url) return NextResponse.json({ error: "No resume file for this candidate." }, { status: 404 });
  return NextResponse.redirect(url);
}
