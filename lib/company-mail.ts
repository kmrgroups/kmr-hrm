import "server-only";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * Each customer company sends its HR emails from its OWN mailbox (e.g. hr@theircompany.com) over SMTP.
 * KMR's email account is never used for a customer's internal mail. The password is encrypted with a key
 * derived from APP_SECRET and is only ever decrypted on the server at send time.
 */
export type Preset = { key: string; label: string; host: string; port: number; secure: boolean; help: string };
export const PRESETS: Preset[] = [
  { key: "google", label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 465, secure: true,
    help: "Turn on 2-Step Verification for the mailbox, then create an App password (Google Account › Security › App passwords) and paste it here." },
  { key: "microsoft", label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, secure: false,
    help: "Your IT admin must allow “Authenticated SMTP” for this mailbox (Microsoft 365 admin › Users › Mail › Manage email apps). Use the mailbox password or an app password." },
  { key: "zoho", label: "Zoho Mail", host: "smtppro.zoho.in", port: 465, secure: true,
    help: "Use smtp.zoho.in for free Zoho accounts. If 2-factor login is on, create an App-specific password in Zoho › Security." },
  { key: "godaddy", label: "GoDaddy (Professional Email)", host: "smtpout.secureserver.net", port: 465, secure: true, help: "Use the full email address and its password." },
  { key: "hostinger", label: "Hostinger", host: "smtp.hostinger.com", port: 465, secure: true, help: "Use the full email address and its password." },
  { key: "other", label: "Other mail server", host: "", port: 587, secure: false, help: "Ask your email provider or IT team for the SMTP server name and port." },
];

const key = () => crypto.createHash("sha256").update(`kmr-hrm-tenant-mail:${env.appSecret}`).digest();
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
export function decrypt(s: string): string {
  const [v, iv, tag, data] = s.split(":");
  if (v !== "v1") throw new Error("Unknown password format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export type Mailbox = { tenant_id: string; from_email: string; from_name: string | null; host: string; port: number; secure: boolean; username: string; password_enc: string; verified_at: string | null; last_error: string | null; updated_at: string };

export async function getMailbox(tenantId: string): Promise<Mailbox | null> {
  const { data } = await createAdminClient().from("tenant_mail").select("*").eq("tenant_id", tenantId).maybeSingle();
  return (data as Mailbox) ?? null;
}

function transport(m: Pick<Mailbox, "host" | "port" | "secure" | "username">, password: string) {
  return nodemailer.createTransport({
    host: m.host, port: m.port, secure: m.secure, requireTLS: !m.secure,
    auth: { user: m.username, pass: password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}

export type Outgoing = { to: string; subject: string; html: string; text: string; replyTo?: string | null; fromName: string; attachments?: { filename: string; content: Uint8Array }[] };

/** Sends through the company's own mailbox. "skipped" when the company has not connected one. */
export async function sendFromCompany(tenantId: string, o: Outgoing): Promise<{ status: "sent" | "failed" | "skipped"; error?: string; providerId?: string }> {
  const m = await getMailbox(tenantId);
  if (!m) return { status: "skipped", error: "company email not connected (Settings › Company email)" };
  try {
    const info = await transport(m, decrypt(m.password_enc)).sendMail({
      from: { name: m.from_name || o.fromName, address: m.from_email }, to: o.to, subject: o.subject, html: o.html, text: o.text,
      replyTo: o.replyTo || undefined,
      attachments: o.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
    });
    if (m.last_error) await createAdminClient().from("tenant_mail").update({ last_error: null }).eq("tenant_id", tenantId);
    return { status: "sent", providerId: info.messageId };
  } catch (e) {
    const error = friendly(e);
    await createAdminClient().from("tenant_mail").update({ last_error: error.slice(0, 400) }).eq("tenant_id", tenantId);
    return { status: "failed", error };
  }
}

/** Checks the login with the mail server, then sends a test message. Throws a plain-language error. */
export async function testMailbox(m: Pick<Mailbox, "host" | "port" | "secure" | "username" | "from_email" | "from_name">, password: string, to: string, company: string) {
  const t = transport(m, password);
  try {
    await t.verify();
    await t.sendMail({
      from: { name: m.from_name || company, address: m.from_email }, to,
      subject: `${company} HRM — email is connected`,
      text: `This test message confirms that ${company}'s HRM can send emails from ${m.from_email}. Employees will now receive payslips, leave updates and onboarding links from this address.`,
    });
  } catch (e) { throw new Error(friendly(e)); }
}

function friendly(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string };
  const msg = err?.message || String(e);
  if (err.code === "EAUTH" || err.responseCode === 535) return "The mail server refused the login — check the email/username and password (Gmail and Zoho need an App password).";
  if (err.code === "ETIMEDOUT" || err.code === "ECONNECTION" || err.code === "ESOCKET") return `Could not reach the mail server (${msg}). Check the server name and port.`;
  if (err.code === "EENVELOPE" || err.responseCode === 553 || err.responseCode === 550) return `The mail server would not send from this address: ${msg}`;
  if (/ENOTFOUND/.test(msg)) return "The mail server name was not found — check the spelling.";
  return msg.slice(0, 300);
}
