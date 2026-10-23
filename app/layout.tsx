import type { Metadata, Viewport } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import { siteUrl } from "@/lib/site";
import { AppToaster } from "@/components/providers/app-toaster";
import { ThemeScopeSync } from "@/components/marketing/theme-scope-sync";
import { AnchorScroll } from "@/components/layout/anchor-scroll";
import { themeBootstrapScript } from "@/lib/theme-scope";
import { accountBootstrapScript } from "@/lib/account-bootstrap";
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
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
        {/*
          Starts the public header's one account request while the HTML is still
          parsing, so it overlaps the JavaScript download instead of waiting
          behind hydration. See `lib/account-bootstrap.ts`.
        */}
        <script dangerouslySetInnerHTML={{ __html: accountBootstrapScript() }} />
      </head>
      <body className={`${sans.variable} ${display.variable} bg-[var(--background)] text-[var(--foreground)] antialiased`}>
        {/*
          Clerk is mounted only around the customer auth screens (see
          `app/(customer-auth)/customer/auth/layout.tsx`). It used to wrap every
          route, which shipped Clerk's client bundle to the admin workspace, the
          customer dashboard, and the whole marketing site even though none of
          them render a Clerk component. Staff and administrator sign-in is
          first-party.
        */}
        {children}
        {/*
          Applies the current area's theme on navigation. Required because
          `/staff` and `/customer` render no toggle of their own, so the control
          that last wrote `data-theme` is not there to correct it.
        */}
        <ThemeScopeSync />
        {/*
          Keeps `/#section` navigation landing on the section. Mounted at the root
          rather than on the home page so it survives the client-side transition
          into `/` — which is the navigation that was failing.
        */}
        <AnchorScroll />
        <AppToaster />
      </body>
    </html>
  );
}
