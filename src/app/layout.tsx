import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BrowserSessionReset } from "@/components/auth/BrowserSessionReset";
import { isIsolatedStaging } from "../../supabase/functions/_shared/environment";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#1a73e8",
};

export const metadata: Metadata = {
  title: "On Par Facilities",
  description:
    "Report and track maintenance issues across On Par Entertainment departments.",
  applicationName: "On Par Facilities",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "On Par Facilities",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-[100dvh] flex-col">
        {isIsolatedStaging(process.env) ? (
          <aside aria-label="Test environment" className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950">
            Test environment — use test accounts only.
          </aside>
        ) : null}
        <BrowserSessionReset />
        {children}
      </body>
    </html>
  );
}
