import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random token for links (onboarding, approvals). 32 bytes = 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Links are stored only as a hash, so a database leak does not expose working links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Readable temporary password: 4 letters + 4 digits + symbol, e.g. "Kpmr-4821!" */
export function tempPassword(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const b = randomBytes(9);
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[b[i] % letters.length];
  let n = "";
  for (let i = 4; i < 8; i++) n += String(b[i] % 10);
  return `${s}-${n}!`;
}

/** Sign a small JSON payload with an expiry, for short-lived cookies (e.g. passkey challenges). */
export function signPayload(payload: object, secret: string, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T = Record<string, unknown>>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data as T;
  } catch {
    return null;
  }
}
