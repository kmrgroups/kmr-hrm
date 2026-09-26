"use client";
import { p } from "@/lib/base-path";
import { useEffect } from "react";

/** Registers the service worker so the portal can be installed as an app on phones, tablets and desktops. */
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register(p("/sw.js"), { scope: p("/") }).catch(() => {});
    }
  }, []);
  return null;
}
