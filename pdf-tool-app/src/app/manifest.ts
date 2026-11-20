import type { MetadataRoute } from "next";

/** Lets phones and laptops install LayahTools as an app (opens in its own window, works offline). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LayahTools – PDF tools on your device",
    short_name: "LayahTools",
    description: "Edit, sign, merge, compress and convert PDFs. Files never leave your device.",
    start_url: "/#workspace",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2400c6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
