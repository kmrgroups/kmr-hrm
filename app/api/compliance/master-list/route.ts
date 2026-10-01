import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { masterListPdf, type MasterRow } from "@/lib/compliance/service";

export const maxDuration = 60;

/** GET → Master list of documents (landscape PDF): the current revision of every document in use */
export async function GET() {
  const s = await getSession();
  if (!s || !hasRole(s.user, HR_ROLES)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const db = await createClient();
  const { data } = await db.from("documents").select("doc_no,title,kind,owner_name,document_versions(revision,status,effective_from,review_due)").eq("active", true).order("doc_no");
  const rows: MasterRow[] = (data ?? []).map((d) => {
    const vs = (d.document_versions ?? []) as { revision: number; status: string; effective_from: string | null; review_due: string | null }[];
    const cur = vs.find((v) => v.status === "approved");
    const draft = vs.find((v) => v.status === "draft");
    return { doc_no: d.doc_no, title: d.title, kind: d.kind, revision: cur?.revision ?? null, effective: cur?.effective_from ?? null, review_due: cur?.review_due ?? null, owner: d.owner_name,
      status: cur ? (draft ? `Approved (rev ${draft.revision} in draft)` : "Approved") : "Draft - not issued" };
  });
  const bytes = await masterListPdf(s.tenant, rows);
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="master-list-of-documents.pdf"' } });
}
