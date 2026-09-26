// ─── Add to the KMR Group site's next.config.js (Next.js 14) ───────────────────
// Sends www.kmr-groups.com/it/hrm/* to the separate HRM deployment.
// Visitors only ever see www.kmr-groups.com. Replace HRM_URL with the HRM project's
// Vercel address (Vercel → HRM project → Domains, e.g. https://kmr-hrm.vercel.app).

const HRM_URL = "https://kmr-hrm.vercel.app";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ...keep everything already in the KMR config...

  async rewrites() {
    return {
      // "beforeFiles" so these win over any KMR page or catch-all route
      beforeFiles: [
        { source: "/it/hrm", destination: `${HRM_URL}/it/hrm` },
        { source: "/it/hrm/:path*", destination: `${HRM_URL}/it/hrm/:path*` },
      ],
    };
  },

  async redirects() {
    return [
      // the old-style address still works
      { source: "/it/hrm.html", destination: "/it/hrm", permanent: true },
    ];
  },
};

module.exports = nextConfig;

// If the KMR config already has rewrites() returning an array, add the two HRM
// entries at the TOP of that array instead.
//
// If the KMR site has a middleware.ts, make sure it ignores /it/hrm, e.g. add to its matcher:
//   matcher: ["/((?!it/hrm|_next/static|_next/image|favicon.ico).*)"]
