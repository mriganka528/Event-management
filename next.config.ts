import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Cloudflare Turnstile, the CAPTCHA provider Clerk uses for bot protection on
 * `<SignIn/>` and `<SignUp/>`.
 *
 * It is a separate origin from Clerk and serves its own script, iframe, and API
 * calls. Without all three allowances Clerk renders its widget shell, the
 * challenge never initialises, and the component reports:
 *
 *   The CAPTCHA failed to load. This may be due to an unsupported browser or a
 *   browser extension.
 *
 * That message blames the visitor's browser, but the actual cause was this
 * policy — nothing about extensions was involved. Added as one explicit origin
 * rather than a wildcard so the exception stays as narrow as the single feature
 * that needs it.
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.razorpay.com",
  "img-src 'self' data: blob: https://res.cloudinary.com https://img.clerk.com https://*.razorpay.com " + TURNSTILE_ORIGIN,
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://*.clerk.com https://*.clerk.accounts.dev",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://*.clerk.com https://*.clerk.accounts.dev ${TURNSTILE_ORIGIN}${isProduction ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self' https://api.razorpay.com https://*.razorpay.com wss://*.razorpay.com https://*.clerk.com https://*.clerk.accounts.dev " + TURNSTILE_ORIGIN,
  "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.clerk.com https://*.clerk.accounts.dev " + TURNSTILE_ORIGIN,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  experimental: {
    /*
     * Static generation is bounded on purpose.
     *
     * Every worker is its own process with its own Prisma client, and each
     * client holds a five-connection pool (`lib/prisma.ts`). On a twelve-core
     * machine that is eleven workers opening fifty-five connections against
     * Neon at once, which overruns the pooler and fails the build with:
     *
     *   Timed out fetching a new connection from the connection pool.
     *   (Current connection pool timeout: 10, connection limit: 5)
     *
     * The prerendered pages are a handful of marketing pages, so the build is
     * not the place to spend twelve cores. Two workers keep the connection
     * count inside what the database hands out, and the build still finishes
     * in a fraction of the time.
     */
    cpus: 2,
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    const headers = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      { key: "Cross-Origin-Resource-Policy", value: "same-site" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    ];
    if (isProduction) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
    const privateHeaders = [
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
    ];
    return [
      { source: "/:path*", headers },
      { source: "/admin", headers: privateHeaders },
      { source: "/admin/:path*", headers: privateHeaders },
      { source: "/staff", headers: privateHeaders },
      { source: "/staff/:path*", headers: privateHeaders },
      { source: "/customer/dashboard", headers: privateHeaders },
      { source: "/customer/dashboard/:path*", headers: privateHeaders },
      { source: "/customer/bookings/:path*", headers: privateHeaders },
      { source: "/customer/invoices/:path*", headers: privateHeaders },
      { source: "/customer/auth", headers: privateHeaders },
      { source: "/customer/auth/:path*", headers: privateHeaders },
      { source: "/customer/access", headers: privateHeaders },
      { source: "/customer/track", headers: privateHeaders },
      { source: "/api/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
