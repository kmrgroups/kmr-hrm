import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getTenant } from "@/lib/tenant";
import { ServiceWorker } from "@/components/ServiceWorker";
import { p } from "@/lib/base-path";
import { logoUrl } from "@/lib/tenant";
import { PoweredBy } from "@/components/PoweredBy";
import { NavProgress } from "@/components/NavProgress";
import { Suspense } from "react";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant().catch(() => null);
  const name = tenant ? `${tenant.name} HR` : "HRM Suite";
  return {
    title: { default: name, template: `%s · ${name}` },
    description: "Employee onboarding, attendance, payroll and HR self-service",
    manifest: p("/manifest.webmanifest"),
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    // The company logo from Settings is the browser-tab icon; without a logo, an icon with the company's initials.
    icons: (() => {
      const logo = tenant ? logoUrl(tenant) : null;
      return logo
        ? { icon: [{ url: logo }], shortcut: [{ url: logo }], apple: [{ url: logo }] }
        : { icon: [{ url: p("/api/pwa-icon?s=64"), type: "image/png" }], shortcut: [{ url: p("/api/pwa-icon?s=64") }], apple: [{ url: p("/api/pwa-icon?s=180") }] };
    })(),
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const tenant = await getTenant().catch(() => null);
  return { themeColor: tenant?.primary_color || "#1F3A5F", width: "device-width", initialScale: 1 };
}

function safeColor(c: string | undefined, fallback: string) {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant().catch(() => null);
  const style = {
    "--brand": safeColor(tenant?.primary_color, "#1F3A5F"),
    "--accent": safeColor(tenant?.accent_color, "#E07A1F"),
  } as React.CSSProperties;
  return (
    <html lang="en">
      <body style={style}>
        <Suspense fallback={null}><NavProgress /></Suspense>
        {children}
        <PoweredBy />
        <ServiceWorker />
      </body>
    </html>
  );
}
