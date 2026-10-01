import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signedDocUrl } from "@/lib/storage";

const isId = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);

/** GET ?incident=<id> → its photo; ?medical=<id> → the certificate. Row-level security decides who may see the record. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = new URL(req.url), inc = url.searchParams.get("incident"), med = url.searchParams.get("medical");
  const db = await createClient();
  let path: string | null = null;
  if (isId(inc)) path = (await db.from("incidents").select("photo_path").eq("id", inc).maybeSingle()).data?.photo_path ?? null;
  else if (isId(med)) path = (await db.from("medical_checks").select("certificate_path").eq("id", med).maybeSingle()).data?.certificate_path ?? null;
  if (!path || !path.startsWith(`${s.tenant.id}/`)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const signed = await signedDocUrl(path, 120);
  return signed ? NextResponse.redirect(signed) : NextResponse.json({ error: "Not found." }, { status: 404 });
}
