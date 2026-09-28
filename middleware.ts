import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

// Pages that need a signed-in user. Everything else (login, onboarding links,
// QR verification, public assets) is reachable without a session.
const PROTECTED = ["/app", "/me", "/account", "/help"];

export async function middleware(request: NextRequest) {
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

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    // relative Location: stay on www.kmr-groups.com (see lib/redirect.ts)
    return new NextResponse(null, { status: 307, headers: { Location: `${request.nextUrl.basePath}/login?next=${encodeURIComponent(path)}` } });
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|api/cron|api/pwa-icon|api/attendance/punches|iclock|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
