"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
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

export async function sendOtp(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const code = String(form.get("code") || "").trim();
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) return { error: "That code is incorrect or has expired.", otpSentTo: email };
    return finishLogin(safeNext(form.get("next")));
  }

  if (!email) return { error: "Enter your registered email." };
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  // Same message whether or not the account exists, so the form cannot be used to discover accounts.
  if (error && !/not found|signups not allowed/i.test(error.message)) {
    return { error: "Could not send the code right now. Please try again in a minute." };
  }
  return { otpSentTo: email, info: `If ${email} is registered, a 6-digit code has been sent to it.` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
