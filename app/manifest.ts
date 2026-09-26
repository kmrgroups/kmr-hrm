import type { MetadataRoute } from "next";
import { getTenant } from "@/lib/tenant";
import { p } from "@/lib/base-path";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getTenant().catch(() => null);
  const name = tenant ? `${tenant.name} HR` : "HRM Suite";
  return {
    name,
    short_name: tenant?.name?.slice(0, 12) || "HRM",
    start_url: p("/"),
    scope: p("/"),
    display: "standalone",
    background_color: "#f4f6f9",
    theme_color: tenant?.primary_color || "#1F3A5F",
    icons: [
      { src: p("/api/pwa-icon?s=192"), sizes: "192x192", type: "image/png" },
      { src: p("/api/pwa-icon?s=512"), sizes: "512x512", type: "image/png" },
      { src: p("/api/pwa-icon?s=512&m=1"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
