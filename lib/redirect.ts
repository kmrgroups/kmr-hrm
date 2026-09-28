import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { p } from "@/lib/base-path";

/**
 * Redirect to the address the visitor used (www.kmr-groups.com/it/hrm behind the website's forwarding), never the
 * app's own internal Vercel address — there the sign-in cookie does not exist.
 */
export async function redirectTo(path: string, status = 303) {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return NextResponse.redirect(new URL(p(path), `${proto.split(",")[0]}://${host.split(",")[0]}`), status);
}
