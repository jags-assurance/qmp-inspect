import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/domain/service-worker-register";
import { RouteProgressBar } from "@/components/domain/route-progress-bar";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, htmlAttributesFor } from "@/lib/i18n/direction";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Used for document/record identifiers (ITP numbers, checklist codes, NCR refs) — see .doc-id
// in globals.css. Also the print register's typeface for generated controlled documents.
const monoUi = IBM_Plex_Mono({
  variable: "--font-mono-ui",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "JAGS Assurance", template: "%s | QMP Inspect" },
  description: "QMP Inspect — quality & inspection management platform",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "QMP Inspect",
  },
};

export const viewport: Viewport = {
  themeColor: "#6B1E2C",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // G-02: <html lang dir> follows the locale the user chose (cookie set by the account menu).
  // English / LTR is the default and is unchanged when no choice has been made.
  const { lang, dir } = htmlAttributesFor((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={lang} dir={dir} className={`${inter.variable} ${monoUi.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <RouteProgressBar />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
