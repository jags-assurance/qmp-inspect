import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
  title: "JAGS Assurance",
  description: "QMP Inspect — quality & inspection management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${monoUi.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
