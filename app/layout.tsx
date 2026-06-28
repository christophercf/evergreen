import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "./ui/app-frame";

export const metadata: Metadata = {
  title: "Evergreen AI — AI-Assisted Renovation Project Management",
  description:
    "Evergreen AI — an end-to-end, AI-assisted renovation project management tool for builders and their clients. Active project: 31810 Evergreen Rd.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Evergreen AI" },
  icons: {
    icon: "/icons/favicon-64.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#3a2f25",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
