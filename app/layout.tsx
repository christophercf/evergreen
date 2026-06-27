import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "./ui/app-frame";

export const metadata: Metadata = {
  title: "Evergreen — 31810 Evergreen Rd Restoration",
  description:
    "A platform to manage the 31810 Evergreen Rd renovation: scope, building costs, financing, and trade coordination — replacing the working spreadsheets.",
};

export const viewport: Viewport = {
  themeColor: "#3a2f25",
  width: "device-width",
  initialScale: 1,
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
