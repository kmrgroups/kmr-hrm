import { NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { b64url, relyingParty, takeChallenge } from "@/lib/passkeys";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const challenge = await takeChallenge("reg");
  if (!challenge || challenge.u !== session.user.id) {
    return NextResponse.json({ error: "The request expired. Please try again." }, { status: 400 });
  }
  const body = (await req.json()) as { response: RegistrationResponseJSON; deviceName?: string };
  const { rpID, origin } = await relyingParty();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.c,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!verification.verified) return NextResponse.json({ error: "Could not verify this device." }, { status: 400 });

  const { credential, credentialBackedUp } = verification.registrationInfo;
  const { error } = await createAdminClient().from("passkeys").insert({
    id: credential.id,
    user_id: session.user.id,
    tenant_id: session.tenant.id,
    public_key: b64url.encode(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    device_name: (body.deviceName || "This device").slice(0, 60),
    backed_up: credentialBackedUp,
  });
  if (error) return NextResponse.json({ error: "This device is already registered." }, { status: 400 });
  await logAudit({ tenantId: session.tenant.id, actorId: session.user.id, action: "passkey.added", entity: "passkeys", entityId: credential.id, data: { device: body.deviceName } });
  return NextResponse.json({ ok: true });
}
