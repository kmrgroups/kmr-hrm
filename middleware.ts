import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

// Pages that need a signed-in user. Everything else (login, onboarding links,
// QR verification, public assets) is reachable without a session.
const PROTECTED = ["/app", "/me", "/account", "/help"];


/** Absolute address on the host the visitor used (www.kmr-groups.com behind the website's forwarding),
 *  never the app's own internal Vercel address — middleware redirects must be absolute. */
function publicUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return new URL(`${request.nextUrl.basePath}${path}`, `${proto.split(",")[0]}://${host.split(",")[0]}`);
}

export async function middleware(request: NextRequest) {
  // never trust a user id sent by the browser
  request.headers.delete("x-kmr-uid"); request.headers.delete("x-kmr-mw");
  const path0 = request.nextUrl.pathname;
  // public screens and APIs do not need a sign-in check here (saves a round trip to Supabase)
  if (!PROTECTED.some((p) => path0 === p || path0.startsWith(p + "/"))) return NextResponse.next({ request });
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refreshes the session cookie when needed. Do not remove.
  const { data: { user } } = await supabase.auth.getUser();
  // hand the verified user to the page (lib/verified-user.ts) so it does not ask Supabase again
  request.headers.set("x-kmr-uid", user?.id ?? "-");
  request.headers.set("x-kmr-mw", process.env.APP_SECRET || "");   // server-only stamp: proves the middleware set it
  const pass = NextResponse.next({ request });
  response.cookies.getAll().forEach((c) => pass.cookies.set(c));
  response = pass;

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    // relative Location: stay on www.kmr-groups.com (see lib/redirect.ts)
    return NextResponse.redirect(publicUrl(request, `/login?next=${encodeURIComponent(path)}`), 307);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|api/cron|api/internal|api/pwa-icon|api/attendance/punches|iclock|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
