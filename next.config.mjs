/** @type {import('next').NextConfig} */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "") || undefined;

// When served through another site (e.g. www.kmr-groups.com/it/hrm), form submissions arrive
// from that site's address. List it here so Next.js accepts them.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (process.env.APP_PUBLIC_URL) allowedOrigins.push(new URL(process.env.APP_PUBLIC_URL).host);

const nextConfig = {
  basePath,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "5mb", allowedOrigins },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // camera is needed for the onboarding selfie; publickey-credentials for Face ID / passkeys
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
