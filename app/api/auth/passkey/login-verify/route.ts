import { NextResponse } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_COOKIE, hostTenant, tenantById } from "@/lib/tenant";
import { licenceFor } from "@/lib/licence";
import { homeFor } from "@/lib/auth";
import { b64url, relyingParty, takeChallenge } from "@/lib/passkeys";
import type { AppUser } from "@/lib/types";

export async function POST(req: Request) {
  const fail = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
  const challenge = await takeChallenge("auth");
  if (!challenge) return fail("The request expired. Please try again.");

  const body = (await req.json()) as { response: AuthenticationResponseJSON; next?: string };
  const admin = createAdminClient();
  const { data: pk } = await admin.from("passkeys").select("*").eq("id", body.response?.id ?? "").maybeSingle();
  const own = await hostTenant();
  if (!pk || (own && pk.tenant_id !== own.id)) {
    return fail("This Face ID / fingerprint is not registered here. Sign in with your password and turn it on from My account.");
  }

  const { rpID, origin } = await relyingParty();
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.c,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: pk.id, publicKey: b64url.decode(pk.public_key), counter: Number(pk.counter), transports: pk.transports ?? undefined },
      requireUserVerification: true,
    });
  } catch (e) {
    return fail((e as Error).message);
  }
  if (!result.verified) return fail("Verification failed.");

  await admin.from("passkeys")
    .update({ counter: result.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", pk.id);

  const { data: appUser } = await admin
    .from("app_users")
    .select("id,tenant_id,role,full_name,email,phone,employee_id,must_change_password,active")
    .eq("id", pk.user_id)
    .maybeSingle();
  if (!appUser?.active) return fail("This account is deactivated.", 403);
  const tenant = await tenantById(appUser.tenant_id);
  if (!tenant) return fail("Your company's HRM account is not active.", 403);
  const licence = await licenceFor(tenant.id);
  if (!licence.ok && appUser.role !== "platform_admin") return fail(`${licence.message} Please contact KMR Group of Companies.`, 403);

  // Turn the verified passkey into a normal Supabase session:
  // mint a one-time magic-link token server-side and redeem it immediately.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: appUser.email });
  if (linkErr || !link?.properties?.hashed_token) return fail("Could not start the session.", 500);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (error) return fail("Could not start the session.", 500);

  const next = body.next && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : null;
  const home = homeFor(appUser as AppUser);
  const res = NextResponse.json({ redirect: appUser.must_change_password ? home : next || home });
  res.cookies.set(COMPANY_COOKIE, tenant.slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: true, httpOnly: true });
  return res;
}
