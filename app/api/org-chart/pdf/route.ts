import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/attendance/time";
import { loadOrg, chartItems, type OrgIssue } from "@/lib/org/data";
import { trimLevels, type OrgItem } from "@/lib/org/layout";
import { fingerprint } from "@/lib/org/model";
import { orgChartPdf } from "@/lib/org/pdf";

export const maxDuration = 60;
const isId = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);

/** GET ?[plant=][dept=][levels=][rev=N][download=1] -> landscape PDF (inline to view, attachment to download) */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !hasRole(s.user, HR_ROLES)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const u = new URL(req.url).searchParams;
  const db = await createClient();
  const org = await loadOrg(db);
  const latest = org.issues[0] ?? null;
  const revNo = u.get("rev") && /^\d{1,4}$/.test(u.get("rev")!) ? Number(u.get("rev")) : null;
  const plant = u.get("plant"), dept = u.get("dept");
  const plantId = isId(plant) && org.plants.some((x) => x.id === plant) ? plant : null;
  const deptId = isId(dept) && org.departments.some((x) => x.id === dept) ? dept : null;
  const levels = Math.max(0, Math.min(20, Number(u.get("levels")) || 0)) || null;

  let items: OrgItem[], title = org.settings.title, docNo = org.settings.doc_no, draft: boolean, issue: OrgIssue | null = latest, note: string | null = null;
  if (revNo != null) {
    issue = org.issues.find((i) => i.rev_no === revNo) ?? null;
    if (!issue) return NextResponse.json({ error: "Revision not found." }, { status: 404 });
    const { data } = await db.from("org_chart_issues").select("snapshot").eq("id", issue.id).maybeSingle();
    const snap = data?.snapshot as { items?: OrgItem[]; title?: string; doc_no?: string } | null;
    if (!snap?.items) return NextResponse.json({ error: "Revision data missing." }, { status: 404 });
    items = snap.items; title = snap.title ?? title; docNo = snap.doc_no ?? docNo; draft = false;
  } else {
    const all = chartItems(org);
    items = trimLevels(chartItems(org, { plantId, departmentId: deptId }), levels);
    let snapItems: OrgItem[] | null = null;
    if (latest) { const { data } = await db.from("org_chart_issues").select("snapshot").eq("id", latest.id).maybeSingle(); snapItems = (data?.snapshot as { items?: OrgItem[] } | null)?.items ?? null; }
    draft = !snapItems || fingerprint(snapItems) !== fingerprint(all) || !!(plantId || deptId || levels);
    if (plantId || deptId || levels) {
      const pn = org.plants.find((x) => x.id === plantId)?.name, dn = org.departments.find((x) => x.id === deptId)?.name;
      note = `Filtered view: ${[pn, dn, levels ? `top ${levels} levels` : null].filter(Boolean).join(", ")}.`;
    }
  }
  const bytes = await orgChartPdf({
    tenant: s.tenant, items, title, docNo, draft, printedOn: istToday(), scopeNote: note,
    rev: issue ? { no: issue.rev_no, date: issue.issued_on, preparedBy: issue.prepared_by, approvedBy: issue.approved_by } : null,
    history: org.issues.map((i) => ({ rev_no: i.rev_no, issued_on: i.issued_on, change_note: i.change_note })),
  });
  const name = `${docNo}-${revNo != null ? `rev${String(revNo).padStart(2, "0")}` : "current"}.pdf`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `${u.get("download") ? "attachment" : "inline"}; filename="${name}"`, "cache-control": "no-store" } });
}
