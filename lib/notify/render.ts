// Pure rendering helpers (no I/O) — unit tested in tests/notify.test.ts

export type Vars = Record<string, string | number | null | undefined>;

/** Sample people (Grand Master › Sample data) use addresses under demo.kmr.test / kmr-demo.test: nothing is sent to them */
export function isSampleRecipient(email: string | null | undefined): boolean {
  return !!email && /@([a-z0-9-]+\.)*(demo\.kmr\.test|kmr-demo\.test)$/i.test(email.trim());
}

export function fill(text: string, vars: Vars): string {
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const BUTTON = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;

/** WhatsApp / SMS: buttons become "Label: url" */
export function toPlainText(text: string, vars: Vars): string {
  return fill(text, vars).replace(BUTTON, (_, label: string, url: string) => `${label.trim()}: ${url.trim()}`);
}

export interface Branding {
  company: string;
  primaryColor: string;
  logoUrl: string | null;
  address?: string | null;
}

function safeColor(c: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : "#1F3A5F";
}

/** Branded, mobile-friendly HTML email built from a plain-text template */
export function toEmailHtml(text: string, vars: Vars, b: Branding): string {
  const color = safeColor(b.primaryColor);
  const filled = fill(text, vars);
  const blocks = filled.split(/\n{2,}/).map((block) => {
    const btn = block.trim().match(/^\[\[([^|\]]+)\|([^\]]+)\]\]$/);
    if (btn) {
      const url = btn[2].trim();
      if (!/^https?:\/\//.test(url)) return "";
      return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">${escapeHtml(btn[1].trim())}</a></p>`;
    }
    const html = escapeHtml(block).replace(/\n/g, "<br>");
    return `<p style="margin:0 0 14px">${html}</p>`;
  });
  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.company)}" style="max-height:40px;max-width:180px">`
    : `<span style="color:#fff;font-size:18px;font-weight:700">${escapeHtml(b.company)}</span>`;
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:${b.logoUrl ? "#fff" : color};padding:18px 28px;border-bottom:4px solid ${color}">${logo}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${blocks.join("\n")}</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;color:#6b7280;font-size:12px">${escapeHtml(b.company)}${b.address ? " · " + escapeHtml(b.address) : ""}<br>This is an automated message from the ${escapeHtml(b.company)} HR portal.</td></tr>
</table></td></tr></table></body></html>`;
}
