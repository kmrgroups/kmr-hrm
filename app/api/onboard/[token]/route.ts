import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { findInvite, missingItems } from "@/lib/onboarding";
import { SECTION_SCHEMAS, fieldErrors, type FormSection } from "@/lib/onboarding-schema";
import { ALLOWED_UPLOAD_TYPES, DOCS_BUCKET, MAX_UPLOAD_BYTES, docPath } from "@/lib/storage";
import { DOCUMENT_TYPES } from "@/lib/types";
import { notify } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { currentOrigin, getTenant } from "@/lib/tenant";
import { fullName } from "@/components/ui";

type Body =
  | { action: "save"; section: FormSection; data: unknown; step?: number }
  | { action: "upload-url"; doc_type: string; mime: string; size: number; file_name: string }
  | { action: "confirm-upload"; doc_type: string; path: string; mime: string; size: number; file_name: string }
  | { action: "delete-doc"; id: string }
  | { action: "submit"; consent: boolean };

const err = (message: string, status = 400, extra: object = {}) => NextResponse.json({ error: message, ...extra }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findInvite(token);
  if (!found) return err("This link is not valid.", 404);
  if (!found.open) return err(found.expired ? "This link has expired. Please ask HR for a new one." : "This form has already been submitted.", 410);
  const { invite } = found;

  // A link must be used on its own company's portal
  const tenant = await getTenant();
  if (!tenant || tenant.id !== invite.tenant_id) return err("This link is not valid here.", 404);

  const db = createAdminClient();
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return err("Bad request");

  // When HR has sent the form back, only the flagged sections can change.
  const locked = (section: string) => invite.status === "sent_back" && !invite.sent_back_sections.includes(section);

  const { data: emp } = await db.from("employees").select("*").eq("id", invite.employee_id).single();
  if (!emp) return err("Employee record missing", 404);

  if (invite.status === "sent") {
    await db.from("onboarding_invites").update({ status: "in_progress" }).eq("id", invite.id);
    await db.from("employees").update({ status: "onboarding" }).eq("id", emp.id).eq("status", "invited");
  }

  switch (body.action) {
    case "save": {
      const schema = SECTION_SCHEMAS[body.section];
      if (!schema) return err("Unknown section");
      if (locked(body.section)) return err("HR has not asked for changes in this section.");
      const parsed = schema.safeParse(body.data);
      if (!parsed.success) return err("Please correct the highlighted fields.", 422, { fields: fieldErrors(parsed.error) });
      const data = parsed.data as Record<string, unknown>;
      const profile = { ...(emp.profile ?? {}) } as Record<string, unknown>;
      const done = new Set<string>((profile._done as string[]) ?? []);

      if (body.section === "statutory") {
        const d = data as Record<string, string>;
        const { data: existing } = await db.from("employee_private").select("aadhaar_last4").eq("employee_id", emp.id).maybeSingle();
        const last4 = d.aadhaar ? d.aadhaar.replace(/\D/g, "").slice(-4) : existing?.aadhaar_last4;
        if (!last4) return err("Please correct the highlighted fields.", 422, { fields: { aadhaar: "Aadhaar number is required" } });
        const { error } = await db.from("employee_private").upsert({
          employee_id: emp.id, tenant_id: emp.tenant_id, pan: d.pan, aadhaar_last4: last4,
          uan: d.uan ?? null, previous_pf_no: d.previous_pf_no ?? null, esi_ip_no: d.esi_ip_no ?? null,
          bank_name: d.bank_name, bank_branch: d.bank_branch ?? null, account_holder: d.account_holder,
          account_number: d.account_number, ifsc: d.ifsc, tax_regime: d.tax_regime,
        });
        if (error) return err(error.message, 500);
      } else {
        profile[body.section] = data;
      }
      done.add(body.section);
      profile._done = [...done];

      const update: Record<string, unknown> = { profile };
      if (body.section === "personal") {
        const p = data as { first_name: string; last_name?: string; date_of_birth: string; gender: string; blood_group: string; mobile: string; emergency_contacts: { name: string; relation: string; phone: string }[] };
        Object.assign(update, {
          first_name: p.first_name, last_name: p.last_name ?? null, date_of_birth: p.date_of_birth, gender: p.gender,
          blood_group: p.blood_group, mobile: p.mobile,
          emergency_contact_name: `${p.emergency_contacts[0].name} (${p.emergency_contacts[0].relation})`,
          emergency_contact_phone: p.emergency_contacts[0].phone,
        });
      }
      const { error } = await db.from("employees").update(update).eq("id", emp.id);
      if (error) return err(error.message, 500);
      if (typeof body.step === "number") await db.from("onboarding_invites").update({ current_step: body.step }).eq("id", invite.id);
      return NextResponse.json({ ok: true });
    }

    case "upload-url": {
      const isSelfie = body.doc_type === "selfie";
      if (!isSelfie && !DOCUMENT_TYPES.some((d) => d.key === body.doc_type)) return err("Unknown document type");
      if (locked(isSelfie ? "selfie" : "documents")) return err("HR has not asked for changes in this section.");
      const ext = ALLOWED_UPLOAD_TYPES[body.mime];
      if (!ext) return err("Only JPG, PNG, WEBP or PDF files are allowed.");
      if (!body.size || body.size > MAX_UPLOAD_BYTES) return err("Files must be smaller than 10 MB.");
      const { count } = await db.from("employee_documents").select("id", { count: "exact", head: true }).eq("employee_id", emp.id);
      if ((count ?? 0) >= 40) return err("Too many files uploaded. Remove some and try again.");
      const path = docPath(emp.tenant_id, emp.id, ext);
      const { data, error } = await db.storage.from(DOCS_BUCKET).createSignedUploadUrl(path);
      if (error || !data) return err("Upload could not be started. Please try again.", 500);
      return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
    }

    case "confirm-upload": {
      const prefix = `${emp.tenant_id}/${emp.id}/`;
      if (!body.path?.startsWith(prefix) || body.path.includes("..")) return err("Invalid file");
      // make sure the file really arrived
      const folder = prefix.slice(0, -1);
      const name = body.path.slice(prefix.length);
      const { data: listed } = await db.storage.from(DOCS_BUCKET).list(folder, { search: name });
      if (!listed?.some((f) => f.name === name)) return err("Upload not found. Please try again.");
      const isSelfie = body.doc_type === "selfie";
      if (isSelfie) {
        await db.from("employee_documents").delete().eq("employee_id", emp.id).eq("doc_type", "selfie");
        await db.from("employees").update({ photo_path: body.path }).eq("id", emp.id);
      }
      const { data: row, error } = await db.from("employee_documents").insert({
        tenant_id: emp.tenant_id, employee_id: emp.id, doc_type: body.doc_type, file_path: body.path,
        file_name: String(body.file_name || "").slice(0, 150), mime_type: body.mime, size_bytes: body.size,
      }).select("id,doc_type,file_name,uploaded_at").single();
      if (error) return err(error.message, 500);
      return NextResponse.json({ ok: true, doc: row });
    }

    case "delete-doc": {
      const { data: doc } = await db.from("employee_documents").select("id,file_path,doc_type,status").eq("id", body.id).eq("employee_id", emp.id).maybeSingle();
      if (!doc) return err("Not found", 404);
      if (locked(doc.doc_type === "selfie" ? "selfie" : "documents")) return err("HR has not asked for changes in this section.");
      await db.storage.from(DOCS_BUCKET).remove([doc.file_path]);
      await db.from("employee_documents").delete().eq("id", doc.id);
      return NextResponse.json({ ok: true });
    }

    case "submit": {
      if (!body.consent) return err("Please accept the declaration to submit.");
      const [{ data: priv }, { data: docs }] = await Promise.all([
        db.from("employee_private").select("employee_id").eq("employee_id", emp.id).maybeSingle(),
        db.from("employee_documents").select("doc_type").eq("employee_id", emp.id),
      ]);
      const missing = missingItems(emp, !!priv, (docs ?? []).map((d) => d.doc_type));
      if (missing.length) return err(`Please complete: ${missing.join(", ")}`, 422, { missing });

      const h = await headers();
      const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || null;
      await db.from("onboarding_invites").update({
        status: "submitted", submitted_at: new Date().toISOString(), consent_at: new Date().toISOString(), consent_ip: ip,
      }).eq("id", invite.id);
      await db.from("employees").update({ status: "submitted" }).eq("id", emp.id);
      await logAudit({ tenantId: emp.tenant_id, actorId: null, action: "onboarding.submitted", entity: "employees", entityId: emp.id, data: { ip } });

      // Tell HR: the configured HR contact, otherwise every HR manager
      const origin = await currentOrigin();
      const { data: designation } = emp.designation_id
        ? await db.from("designations").select("name").eq("id", emp.designation_id).maybeSingle() : { data: null };
      const { data: department } = emp.department_id
        ? await db.from("departments").select("name").eq("id", emp.department_id).maybeSingle() : { data: null };
      const vars = {
        employee_name: fullName(emp), designation: designation?.name ?? "-", department: department?.name ?? "-",
        document_count: (docs ?? []).length, link: `${origin}/app/employees/${emp.id}`,
      };
      const recipients: { email?: string | null; phone?: string | null; name?: string }[] = [];
      if (tenant.settings?.hr_notify_email || tenant.settings?.hr_notify_phone) {
        recipients.push({ email: tenant.settings.hr_notify_email, phone: tenant.settings.hr_notify_phone, name: "HR" });
      } else {
        const { data: hrs } = await db.from("app_users").select("full_name,email,phone")
          .eq("tenant_id", emp.tenant_id).in("role", ["hr_manager", "company_admin"]).eq("active", true).limit(5);
        for (const u of hrs ?? []) recipients.push({ email: u.email, phone: u.phone, name: u.full_name });
      }
      await Promise.all(recipients.map((to) => notify({ tenant, event: "onboarding_submitted", to, vars, related: { type: "employee", id: emp.id } })));
      return NextResponse.json({ ok: true });
    }

    default:
      return err("Unknown action");
  }
}
