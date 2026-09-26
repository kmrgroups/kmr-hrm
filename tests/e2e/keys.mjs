// Prints anon + service_role JWTs for the local stack (HS256, same secret as Auth + PostgREST).
import { createHmac } from "node:crypto";
const secret = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload) => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
console.log(`ANON=${sign({ role: "anon", iss: "supabase", exp })}`);
console.log(`SERVICE=${sign({ role: "service_role", iss: "supabase", exp })}`);
