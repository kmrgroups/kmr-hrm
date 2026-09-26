import { ImageResponse } from "next/og";
import { getTenant } from "@/lib/tenant";

// App icon generated from the company's initials and brand colour.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const size = Math.min(512, Math.max(48, Number(url.searchParams.get("s")) || 192));
  const maskable = url.searchParams.get("m") === "1";
  const tenant = await getTenant().catch(() => null);
  const initials = (tenant?.name || "HR")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const bg = tenant?.primary_color && /^#[0-9a-f]{6}$/i.test(tenant.primary_color) ? tenant.primary_color : "#1F3A5F";
  const accent = tenant?.accent_color && /^#[0-9a-f]{6}$/i.test(tenant.accent_color) ? tenant.accent_color : "#E07A1F";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: bg, color: "#fff", fontSize: size * (maskable ? 0.3 : 0.4), fontWeight: 800,
          borderRadius: maskable ? 0 : size * 0.2, borderBottom: `${Math.round(size * 0.06)}px solid ${accent}`,
        }}
      >
        {initials}
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
