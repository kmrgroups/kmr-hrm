import "server-only";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { signPayload, verifyPayload } from "@/lib/tokens";
import { p } from "@/lib/base-path";

const COOKIE = "hrm_webauthn";

/** Relying party = the exact host the user is on (custom domains get their own passkeys). */
export async function relyingParty() {
  const h = await headers();
  if (env.publicUrl) {
    // Served through another site: the browser is on that site's domain.
    const u = new URL(env.publicUrl);
    return { rpID: u.hostname, origin: u.origin };
  }
  const host = (h.get("x-forwarded-host") || h.get("host") || "localhost").split(":")[0].toLowerCase();
  const origin = h.get("origin") || `${host === "localhost" ? "http" : "https"}://${h.get("host")}`;
  return { rpID: host, origin };
}

export async function storeChallenge(challenge: string, purpose: "reg" | "auth", userId?: string) {
  const jar = await cookies();
  jar.set(COOKIE, signPayload({ c: challenge, p: purpose, u: userId ?? null }, env.appSecret, 300), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: p("/api/auth/passkey"),
    maxAge: 300,
  });
}

export async function takeChallenge(purpose: "reg" | "auth"): Promise<{ c: string; u: string | null } | null> {
  const jar = await cookies();
  const data = verifyPayload<{ c: string; p: string; u: string | null }>(jar.get(COOKIE)?.value, env.appSecret);
  jar.delete({ name: COOKIE, path: p("/api/auth/passkey") });
  if (!data || data.p !== purpose) return null;
  return { c: data.c, u: data.u };
}

export const b64url = {
  encode: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url"),
  decode: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};
