import type { Metadata, Viewport } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { siteUrl } from "@/lib/site";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AppToaster } from "@/components/providers/app-toaster";
import "./globals.css";

const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const display = Playfair_Display({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: "Event Management", template: "%s | Event Management" },
  description: "Plan, manage, and deliver memorable events with a clear quote, secure booking, and dependable operations.",
  applicationName: "Event Management",
  keywords: ["event management", "event planning", "event booking", "event services", "event quote"],
  authors: [{ name: "Event Management" }],
  creator: "Event Management",
  referrer: "same-origin",
  openGraph: {
    type: "website",
    siteName: "Event Management",
    title: "Event Management",
    description: "Plan, manage, and deliver memorable events.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Event Management",
    description: "Plan, manage, and deliver memorable events.",
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    yandex: process.env.YANDEX_SITE_VERIFICATION,
    yahoo: process.env.YAHOO_SITE_VERIFICATION,
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d38a16",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(() => { try { const saved = localStorage.getItem('theme'); const theme = saved === 'dark' || saved === 'light' ? saved : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; } catch (_) {} })()` }} />
      </head>
      <body className={`${sans.variable} ${display.variable} bg-[var(--background)] text-[var(--foreground)] antialiased`}>
        {/*
          Clerk is mounted here for every route, but only customers ever use it.
          Staff and administrator sign-in is first-party and never passes through
          this provider; see `lib/auth/clerk.ts` for how a Clerk identity is
          exchanged for the ordinary local session.
        */}
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
        <AppToaster />
      </body>
    </html>
  );
}
