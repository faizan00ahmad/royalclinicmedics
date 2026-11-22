import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Royal Medics Clinic", template: "%s | Royal Medics Clinic" },
  description: "GP clinic in Dublin. Book your appointment online in minutes.",
  openGraph: { type: "website", siteName: "Royal Medics Clinic", locale: "en_IE" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IE">
      <body className="font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
