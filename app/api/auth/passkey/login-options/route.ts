import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { relyingParty, storeChallenge } from "@/lib/passkeys";

// Discoverable-credential login: the device offers the passkeys it holds for this site,
// so the user does not need to type an email first.
export async function POST() {
  const { rpID } = await relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
  await storeChallenge(options.challenge, "auth");
  return NextResponse.json(options);
}
