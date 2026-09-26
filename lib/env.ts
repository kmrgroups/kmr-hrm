// Central access to environment variables, with clear errors when something is missing.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  get supabaseUrl() { return required("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return required("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get serviceRoleKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get appSecret() {
    const s = required("APP_SECRET");
    if (s.length < 32) throw new Error("APP_SECRET must be at least 32 characters.");
    return s;
  },
  get rootDomain() { return (process.env.APP_ROOT_DOMAIN || "").toLowerCase(); },
  /** Full public address of the app when it is served through another site, e.g. https://www.kmr-groups.com/it/hrm */
  get publicUrl() { return (process.env.APP_PUBLIC_URL || "").replace(/\/+$/, ""); },
  get defaultTenantSlug() { return process.env.DEFAULT_TENANT_SLUG || ""; },
  get cronSecret() { return process.env.CRON_SECRET || ""; },
  get resendKey() { return process.env.RESEND_API_KEY || ""; },
  get emailFrom() { return process.env.EMAIL_FROM || ""; },
  get waToken() { return process.env.WHATSAPP_TOKEN || ""; },
  get waPhoneId() { return process.env.WHATSAPP_PHONE_NUMBER_ID || ""; },
  get waVersion() { return process.env.WHATSAPP_API_VERSION || "v21.0"; },
  get waMode(): "template" | "text" { return process.env.WHATSAPP_MODE === "text" ? "text" : "template"; },
};
