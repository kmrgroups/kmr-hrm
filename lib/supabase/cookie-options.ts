import { COOKIE_PATH } from "@/lib/base-path";

/**
 * The HRM keeps its own login cookie, scoped to its own path. When it runs under
 * another site (www.kmr-groups.com/it/hrm) this keeps it separate from that site's
 * cookies, even if both use the same Supabase project.
 */
export const authCookieOptions = {
  name: "hrm-auth",
  path: COOKIE_PATH,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
