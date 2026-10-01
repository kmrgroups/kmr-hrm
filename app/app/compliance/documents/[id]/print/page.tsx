import { notFound } from "next/navigation";
import { requireRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PrintView } from "../../PrintView";

export const metadata = { title: "Print document" };

export default async function PrintDocument({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rev?: string }> }) {
  const session = await requireRole(HR_ROLES);
  const { id } = await params, { rev } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: d } = await db.from("documents").select("doc_no,title,kind,owner_name").eq("id", id).maybeSingle();
  if (!d) notFound();
  let q = db.from("document_versions").select("*").eq("document_id", id);
  q = rev && /^\d+$/.test(rev) ? q.eq("revision", Number(rev)) : q.eq("status", "approved");
  const { data: v } = await q.maybeSingle();
  if (!v) notFound();
  return <PrintView tenant={session.tenant} d={d} v={v} />;
}
