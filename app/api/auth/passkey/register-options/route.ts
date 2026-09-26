import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { relyingParty, storeChallenge } from "@/lib/passkeys";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const { rpID } = await relyingParty();
  const { data: existing } = await createAdminClient().from("passkeys").select("id,transports").eq("user_id", session.user.id);

  const options = await generateRegistrationOptions({
    rpName: `${session.tenant.name} HR`,
    rpID,
    userName: session.user.email,
    userDisplayName: session.user.full_name,
    userID: new Uint8Array(Buffer.from(session.user.id)),
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((p) => ({ id: p.id, transports: p.transports ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    preferredAuthenticatorType: "localDevice",
  });
  await storeChallenge(options.challenge, "reg", session.user.id);
  return NextResponse.json(options);
}
