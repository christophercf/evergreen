import type { MetadataRoute } from "next";

// PWA manifest — lets the app be installed to a phone home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Evergreen — 31810 Evergreen Rd",
    short_name: "Evergreen",
    description: "Manage the 31810 Evergreen Rd renovation: scope, schedule, costs, draws, and trades.",
    start_url: "/",
    display: "standalone",
    background_color: "#2c241c",
    theme_color: "#3a2f25",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
