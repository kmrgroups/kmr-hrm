import { NextResponse } from "next/server";
import { p } from "@/lib/base-path";

/**
 * Redirect with a RELATIVE address. The HRM runs behind www.kmr-groups.com/it/hrm (the website forwards to the
 * app's own Vercel address); an absolute redirect built from the request URL would send the browser to that
 * internal address, where the sign-in cookie does not exist. A relative Location keeps people on kmr-groups.com.
 */
export function redirectTo(path: string, status = 303) {
  return new NextResponse(null, { status, headers: { Location: p(path) } });
}
