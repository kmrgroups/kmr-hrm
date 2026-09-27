"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { env } from "@/lib/env";
import { isValidEmail } from "@/lib/validators";
import { homeFor } from "@/lib/auth";
import type { AppUser } from "@/lib/types";

export interface LoginState {
  error?: string;
  info?: string;
  otpSentTo?: string;
}

function safeNext(next: FormDataEntryValue | null): string | null {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : null;
}

/** After Supabase accepts the credentials, make sure the user belongs to this company's portal. */
async function finishLogin(next: string | null): Promise<LoginState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const tenant = await getTenant();
  if (!user || !tenant) return { error: "Sign-in failed. Please try again." };
  const { data: appUser } = await supabase
    .from("app_users")
    .select("id,tenant_id,role,full_name,email,phone,employee_id,must_change_password,active")
    .eq("id", user.id)
    .maybeSingle();
  if (!appUser || !appUser.active || (appUser.tenant_id !== tenant.id && appUser.role !== "platform_admin")) {
    await supabase.auth.signOut();
    return { error: `This account is not registered with ${tenant.name}, or it has been deactivated.` };
  }
  const home = homeFor(appUser as AppUser);
  redirect(appUser.must_change_password ? home : next || home);
}

export async function passwordLogin(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Incorrect email or password." };
  return finishLogin(safeNext(form.get("next")));
}

const CODE_MINUTES = 60;          // Supabase's default code lifetime (Authentication → Email OTP expiration)
const MAX_CODES = 3;              // per email address per 10 minutes

/**
 * Email sign-in code. The code is created by Supabase Auth but sent by the app itself (through Resend,
 * the same service as every other HR message), so it arrives from the company's own address and every
 * attempt appears under Messages sent. Without a Resend key the app falls back to Supabase's own mailer.
 */
export async function sendOtp(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const code = String(form.get("code") || "").replace(/\s/g, "");
  const supabase = await createClient();

  if (code) {
    let { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) ({ error } = await supabase.auth.verifyOtp({ email, token: code, type: "magiclink" }));
    if (error) return { error: "That code is incorrect or has expired. Ask for a new one.", otpSentTo: email };
    return finishLogin(safeNext(form.get("next")));
  }

  if (!email || !isValidEmail(email)) return { error: "Enter your registered email." };
  const sent: LoginState = { otpSentTo: email, info: `If ${email} is registered here, a sign-in code has been sent to it. Check your inbox and spam folder.` };
  const tenant = await getTenant();
  if (!tenant) return { error: "No company is set up for this web address." };
  const db = createAdminClient();

  // Only people with a login at this company get a code; the reply is the same either way.
  const { data: user } = await db.from("app_users").select("id,full_name,active,tenant_id,role").eq("email", email)
    .or(`tenant_id.eq.${tenant.id},role.eq.platform_admin`).maybeSingle();
  if (!user || !user.active) return sent;

  const { count } = await db.from("notifications").select("id", { count: "exact", head: true })
    .eq("event", "login_code").eq("recipient", email).gte("created_at", new Date(Date.now() - 10 * 6e4).toISOString());
  if ((count ?? 0) >= MAX_CODES) return { error: "Too many codes requested. Please wait 10 minutes, or sign in with your password.", otpSentTo: email };

  if (!env.resendKey) {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) return { error: /rate|seconds/i.test(error.message) ? "Please wait a minute before asking for another code." : "Could not send the code right now. Please try again in a minute." };
    return sent;
  }

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const otp = link?.properties?.email_otp;
  if (linkErr || !otp) {
    console.error("[login] generateLink failed", linkErr?.message);
    return { error: "Could not create a sign-in code right now. Please try again in a minute." };
  }
  const results = await notify({
    tenant, event: "login_code", to: { name: user.full_name, email }, channels: ["email"],
    vars: { otp, minutes: String(CODE_MINUTES) }, related: { type: "app_user", id: user.id },
  });
  if (!results.some((r) => r.status === "sent")) {
    return { error: "The code email could not be sent. Please sign in with your password, or ask HR to check Messages sent." };
  }
  return sent;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
