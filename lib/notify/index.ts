import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { sendFromCompany } from "@/lib/company-mail";
import { logoUrl } from "@/lib/tenant";
import { toWhatsAppNumber, isValidEmail } from "@/lib/validators";
import type { Tenant } from "@/lib/types";
import { DEFAULT_TEMPLATES, type MessageTemplate, type NotificationEvent } from "./templates";
import { fill, isSampleRecipient, toEmailHtml, toPlainText, type Vars } from "./render";

export interface Recipient {
  name?: string;
  email?: string | null;
  phone?: string | null;
}

export interface NotifyOptions {
  tenant: Tenant;
  event: NotificationEvent;
  to: Recipient;
  vars: Vars;
  channels?: ("email" | "whatsapp")[];
  related?: { type: string; id: string };
  attachments?: { filename: string; content: Uint8Array }[];
}

export interface ChannelResult {
  channel: "email" | "whatsapp";
  status: "sent" | "failed" | "skipped";
  error?: string;
}

/** Tenant override (if any) merged over the built-in template */
async function loadTemplate(tenantId: string, event: NotificationEvent): Promise<MessageTemplate & { emailOn: boolean; waOn: boolean }> {
  const base = DEFAULT_TEMPLATES[event];
  const { data } = await createAdminClient()
    .from("notification_templates")
    .select("channel,subject,body,wa_template,wa_params,active")
    .eq("tenant_id", tenantId)
    .eq("event", event);
  const email = data?.find((r) => r.channel === "email");
  const wa = data?.find((r) => r.channel === "whatsapp");
  return {
    subject: email?.subject || base.subject,
    email: email?.body || base.email,
    whatsapp: wa?.body || base.whatsapp,
    wa_template: wa?.wa_template || base.wa_template,
    wa_params: wa?.wa_params?.length ? wa.wa_params : base.wa_params,
    emailOn: email ? email.active : true,
    waOn: wa ? wa.active : true,
  };
}

/** HR emails go out from the customer company's own mailbox (Settings › Company email) — never from KMR's address. */
async function sendEmail(tenant: Tenant, to: string, subject: string, html: string, text: string, attachments?: NotifyOptions["attachments"]) {
  return sendFromCompany(tenant.id, {
    to, subject, html, text, attachments, fromName: tenant.name,
    replyTo: tenant.settings?.email_reply_to || tenant.settings?.hr_notify_email || tenant.email || null,
  });
}

async function sendWhatsApp(to: string, tpl: MessageTemplate, vars: Vars) {
  if (!env.waToken || !env.waPhoneId) return { status: "skipped" as const, error: "WhatsApp not configured" };
  const payload =
    env.waMode === "text"
      ? { messaging_product: "whatsapp", to, type: "text", text: { preview_url: true, body: toPlainText(tpl.whatsapp, vars) } }
      : {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: tpl.wa_template,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: tpl.wa_params.map((p) => ({ type: "text", text: String(vars[p] ?? "-").slice(0, 1000) || "-" })),
              },
            ],
          },
        };
  const res = await fetch(`https://graph.facebook.com/${env.waVersion}/${env.waPhoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.waToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { status: "failed" as const, error: body?.error?.message || `HTTP ${res.status}` };
  return { status: "sent" as const, providerId: body?.messages?.[0]?.id as string | undefined };
}

/**
 * Sends one business event to one person on email and WhatsApp, and records
 * every attempt in the notifications table. Never throws: a failed message
 * must not break the workflow that triggered it.
 */
export async function notify(opts: NotifyOptions): Promise<ChannelResult[]> {
  const { tenant, event, to } = opts;
  const channels = opts.channels ?? ["email", "whatsapp"];
  const vars: Vars = { company: tenant.name, name: to.name, ...opts.vars };
  const db = createAdminClient();
  const results: ChannelResult[] = [];

  let tpl: Awaited<ReturnType<typeof loadTemplate>>;
  try {
    tpl = await loadTemplate(tenant.id, event);
  } catch (e) {
    console.error("[notify] template load failed", e);
    return [];
  }

  const record = async (channel: "email" | "whatsapp", recipient: string, rawSubject: string | null, body: string, r: { status: string; error?: string; providerId?: string }) => {
    await db.from("notifications").insert({
      tenant_id: tenant.id,
      event,
      channel,
      recipient,
      subject: rawSubject && vars.otp ? rawSubject.split(String(vars.otp)).join("******") : rawSubject,
      // never keep passwords in the message log
      body: [vars.temp_password, vars.otp].filter(Boolean).reduce((b: string, secret) => b.split(String(secret)).join("********"), body),
      status: r.status,
      provider_id: r.providerId ?? null,
      error: r.error ?? null,
      related_type: opts.related?.type ?? null,
      related_id: opts.related?.id ?? null,
      sent_at: r.status === "sent" ? new Date().toISOString() : null,
    });
    if (r.status !== "sent") console.warn(`[notify] ${event} ${channel} to ${recipient}: ${r.status} ${r.error ?? ""}`);
  };

  // sample people (Grand Master › Sample data) have made-up e-mails and mobiles: nothing is ever sent to them,
  // on any channel — a made-up mobile number may belong to a real person
  if (isSampleRecipient(to.email)) {
    for (const ch of channels) {
      await record(ch, ch === "email" ? to.email! : to.phone ?? "-", null, `(${event} for sample data — not sent)`, { status: "skipped", error: "sample data" });
      results.push({ channel: ch, status: "skipped", error: "sample data — not sent" });
    }
    return results;
  }

  if (channels.includes("email") && tpl.emailOn && to.email && isValidEmail(to.email)) {
    const subject = fill(tpl.subject, vars);
    const text = toPlainText(tpl.email, vars);
    const html = toEmailHtml(tpl.email, vars, {
      company: tenant.legal_name || tenant.name,
      primaryColor: tenant.primary_color,
      logoUrl: logoUrl(tenant),
      address: tenant.address,
    });
    let r: { status: "sent" | "failed" | "skipped"; error?: string; providerId?: string };
    try {
      r = await sendEmail(tenant, to.email, subject, html, text, opts.attachments);
    } catch (e) {
      r = { status: "failed", error: (e as Error).message };
    }
    await record("email", to.email, subject, text, r);
    results.push({ channel: "email", status: r.status, error: r.error });
  }

  const waNumber = toWhatsAppNumber(to.phone);
  if (channels.includes("whatsapp") && tpl.waOn && waNumber) {
    const text = toPlainText(tpl.whatsapp, vars);
    let r: { status: "sent" | "failed" | "skipped"; error?: string; providerId?: string };
    try {
      r = await sendWhatsApp(waNumber, tpl, vars);
    } catch (e) {
      r = { status: "failed", error: (e as Error).message };
    }
    await record("whatsapp", waNumber, null, text, r);
    results.push({ channel: "whatsapp", status: r.status, error: r.error });
  }

  return results;
}

/** One-line summary for toasts, e.g. "Email sent · WhatsApp not configured" */
export function describeResults(results: ChannelResult[]): string {
  if (!results.length) return "No email or mobile number to notify";
  return results
    .map((r) => {
      const ch = r.channel === "email" ? "Email" : "WhatsApp";
      if (r.status === "sent") return `${ch} sent`;
      if (r.status === "skipped") return `${ch} not sent (${r.error})`;
      return `${ch} failed (${r.error})`;
    })
    .join(" · ");
}
