import "server-only";
// Compliance register and document control on the server: the occurrences of each item (from the due-date rules),
// the daily reminder e-mail to whoever looks after them, policy publication to the people it is for, the master list PDF.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { istToday } from "@/lib/attendance/time";
import { landscapeSheet, pdfDate } from "@/lib/qms/sheet-pdf";
import { rgb } from "pdf-lib";
import { baseUrl, audiencePeople, sendToPeople } from "@/lib/engage/send";
import type { Tenant } from "@/lib/types";
import { addDaysIso, dueDates, periodLabel, DOC_KINDS, type Item } from "./rules";

/** creates the open occurrences of every active item from 5 weeks back to 2 months ahead (existing ones are kept) */
export async function ensureTasks(tenantId: string, today = istToday()): Promise<number> {
  const db = createAdminClient();
  const { data: items } = await db.from("compliance_items").select("id,code,kind,frequency,due_months,due_day,valid_until,renew_days,remind_days,start_on,active,sample").eq("tenant_id", tenantId).eq("active", true);
  const rows: { tenant_id: string; item_id: string; due_on: string; sample: boolean }[] = [];
  for (const it of (items ?? []) as (Item & { sample: boolean })[]) {
    for (const d of dueDates(it, addDaysIso(today, -35), addDaysIso(today, 60))) rows.push({ tenant_id: tenantId, item_id: it.id, due_on: d, sample: it.sample });
  }
  if (!rows.length) return 0;
  const { data } = await db.from("compliance_tasks").upsert(rows, { onConflict: "item_id,due_on", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}

async function hrManagers(db: SupabaseClient, tenantId: string): Promise<{ name: string; email: string }[]> {
  const { data } = await db.from("app_users").select("full_name,email,role").eq("tenant_id", tenantId).eq("active", true).in("role", ["hr_manager", "company_admin"]);
  const hr = (data ?? []).filter((u) => u.role === "hr_manager");
  return (hr.length ? hr : data ?? []).filter((u) => u.email).map((u) => ({ name: u.full_name, email: u.email }));
}

/**
 * Daily (nightly job): occurrences for every company; one e-mail per person who looks after something, listing what
 * falls due within its reminder days, what became overdue, and documents whose review is due within 30 days.
 */
export async function complianceDaily(db: SupabaseClient): Promise<{ tasks: number; digests: number }> {
  const today = istToday();
  const { data: tenants } = await db.from("tenants").select("*").eq("active", true);
  let tasks = 0, digests = 0;
  for (const tenant of (tenants ?? []) as Tenant[]) {
    tasks += await ensureTasks(tenant.id, today);
    const { data: open } = await db.from("compliance_tasks").select("id,due_on,reminded_at,overdue_notified_at,item:compliance_items!inner(title,frequency,kind,remind_days,owner_email,owner_name,active)")
      .eq("tenant_id", tenant.id).eq("status", "open").eq("sample", false).lte("due_on", addDaysIso(today, 90)).limit(1000);
    type Row = { id: string; due_on: string; reminded_at: string | null; overdue_notified_at: string | null; item: { title: string; frequency: string; kind: string; remind_days: number; owner_email: string | null; owner_name: string | null; active: boolean } };
    const rows = ((open ?? []) as unknown as Row[]).filter((r) => r.item.active);
    const soon = rows.filter((r) => !r.reminded_at && r.due_on >= today && addDaysIso(r.due_on, -r.item.remind_days) <= today);
    const late = rows.filter((r) => !r.overdue_notified_at && r.due_on < today);
    const { data: reviews } = await db.from("document_versions").select("id,review_due,document:documents!inner(doc_no,title,active,sample)")
      .eq("tenant_id", tenant.id).eq("status", "approved").is("review_notified_at", null).lte("review_due", addDaysIso(today, 30)).limit(200);
    const docs = ((reviews ?? []) as unknown as { id: string; review_due: string; document: { doc_no: string; title: string; active: boolean; sample: boolean } }[]).filter((d) => d.document.active && !d.document.sample);
    if (!soon.length && !late.length && !docs.length) continue;
    const base = await baseUrl(db, tenant);
    const managers = await hrManagers(db, tenant.id);
    // who gets what: an item's owner e-mail, else the HR managers; documents go to the HR managers
    const box = new Map<string, { name: string; lines: string[] }>();
    const put = (to: { name: string; email: string }[], line: string) => { for (const p of to) { const b = box.get(p.email.toLowerCase()) ?? { name: p.name, lines: [] }; b.lines.push(line); box.set(p.email.toLowerCase(), b); } };
    const ownerOf = (r: Row) => r.item.owner_email ? [{ name: r.item.owner_name ?? "Sir / Madam", email: r.item.owner_email }] : managers;
    const d = (s: string) => pdfDate(s);
    for (const r of late) put(ownerOf(r), `OVERDUE since ${d(r.due_on)}: ${r.item.title} (${periodLabel(r.item, r.due_on)})`);
    for (const r of soon) put(ownerOf(r), `Due ${d(r.due_on)}: ${r.item.title} (${periodLabel(r.item, r.due_on)})`);
    for (const x of docs) put(managers, `Review ${x.review_due < today ? "OVERDUE since" : "due"} ${d(x.review_due)}: ${x.document.doc_no} ${x.document.title}`);
    for (const [email, b] of box) {
      const over = b.lines.filter((l) => l.startsWith("OVERDUE")).length;
      await notify({ tenant, event: "compliance_digest", to: { name: b.name, email }, channels: ["email"],
        vars: { headline: over ? `${over} overdue, ${b.lines.length - over} more to do` : `${b.lines.length} coming up`, list: b.lines.map((l) => `• ${l}`).join("\n"), link: `${base ?? ""}/app/compliance` } });
      digests++;
    }
    const now = new Date().toISOString();
    if (soon.length) await db.from("compliance_tasks").update({ reminded_at: now }).in("id", soon.map((r) => r.id));
    if (late.length) await db.from("compliance_tasks").update({ overdue_notified_at: now }).in("id", late.map((r) => r.id));
    if (docs.length) await db.from("document_versions").update({ review_notified_at: now }).in("id", docs.map((x) => x.id));
  }
  return { tasks, digests };
}

/** a policy (or any document people must acknowledge) to everybody it is for */
export async function sendPolicy(tenant: Tenant, doc: { id: string; title: string; audience: string; department_id: string | null; plant_id: string | null },
  v: { id: string; revision: number; effective_from: string | null; change_note: string | null }, link: string) {
  const people = await audiencePeople(createAdminClient(), tenant.id, doc);
  return sendToPeople(tenant, "policy_published", { type: "document_versions", id: v.id }, people,
    () => ({ title: doc.title, revision: `revision ${v.revision}`, effective: v.effective_from ? pdfDate(v.effective_from) : "today", change: v.change_note ? `What changed: ${v.change_note}` : "", link }));
}

export interface MasterRow { doc_no: string; title: string; kind: string; revision: number | null; effective: string | null; review_due: string | null; owner: string | null; status: string }
/** Master list of documents (landscape PDF) */
export async function masterListPdf(tenant: Tenant, rows: MasterRow[], today = istToday()): Promise<Uint8Array> {
  const s = await landscapeSheet(tenant, { title: "Master list of documents", docNo: "HR-ML-01", rev: "Live", date: today, clauses: "ISO 9001:2015 7.5.3  ·  IATF 16949:2016 7.5.3.2" });
  const cols = [["Doc. no.", 80], ["Title", 250], ["Type", 85], ["Rev.", 32], ["Effective", 65], ["Review due", 65], ["Owner", 120], ["Status", 85]] as const;
  const M = 28, rowH = 15;
  let y = s.newPage();
  const head = () => { let x = M; s.page.drawRectangle({ x: M, y: y - 4, width: 841.89 - 2 * M, height: rowH, color: rgb(0.93, 0.95, 0.97) }); for (const [h, w] of cols) { s.T(h, x + 3, y, 7.5, s.b); x += w; } y -= rowH; };
  head();
  for (const r of rows) {
    if (y < 50) { y = s.newPage(); head(); }
    const late = r.review_due && r.review_due < today && r.status === "Approved";
    const vals = [r.doc_no, r.title, DOC_KINDS[r.kind] ?? r.kind, r.revision == null ? "-" : String(r.revision), r.effective ? pdfDate(r.effective) : "-", r.review_due ? pdfDate(r.review_due) : "-", r.owner ?? "-", late ? "Review overdue" : r.status];
    let x = M;
    vals.forEach((v, i) => { const w = cols[i]![1]; const t = s.wrap(v, 7.5, w - 6)[0] ?? ""; s.T(t, x + 3, y, 7.5, i === 0 ? s.b : s.r, i === 7 && late ? rgb(0.75, 0.15, 0.1) : undefined); x += w; });
    s.page.drawLine({ start: { x: M, y: y - 4 }, end: { x: 841.89 - M, y: y - 4 }, thickness: 0.3, color: rgb(0.75, 0.78, 0.82) });
    y -= rowH;
  }
  y -= 18; if (y < 60) y = s.newPage();
  s.T(`${rows.length} documents. Obsolete revisions are kept in the HRM with who approved them and when.`, M, y, 7.5, s.r, rgb(0.4, 0.43, 0.48));
  s.T("Prepared by: ____________________", M, y - 30, 8); s.T("Approved by: ____________________", 400, y - 30, 8);
  return s.pdf.save();
}
