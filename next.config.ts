import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.razorpay.com",
  "img-src 'self' data: blob: https://res.cloudinary.com https://img.clerk.com https://*.razorpay.com",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://*.clerk.com https://*.clerk.accounts.dev",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://*.clerk.com https://*.clerk.accounts.dev${isProduction ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self' https://api.razorpay.com https://*.razorpay.com wss://*.razorpay.com https://*.clerk.com https://*.clerk.accounts.dev",
  "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.clerk.com https://*.clerk.accounts.dev",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
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
      { source: "/customer/auth", headers: privateHeaders },
      { source: "/customer/auth/:path*", headers: privateHeaders },
      { source: "/customer/access", headers: privateHeaders },
      { source: "/customer/track", headers: privateHeaders },
      { source: "/api/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
