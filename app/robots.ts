import type { MetadataRoute } from "next";
import { absoluteUrl, siteOrigin } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/customer/bookings/new"],
      // Every screen that can expose an account, a decision, or business data.
      // The public "join the team" form is intentionally not listed: it holds
      // no data and is meant to be discoverable.
      disallow: [
        "/admin",
        "/admin/",
        "/staff",
        "/staff/",
        "/customer/access",
        "/customer/dashboard",
        "/customer/dashboard/",
        "/customer/auth",
        "/customer/bookings/",
        "/customer/track",
        "/api/",
        "/activate",
        "/verify-two-factor",
        "/two-factor-setup",
        "/two-factor-required",
        "/access-pending",
        "/access-denied",
        "/sign-in",
        "/register",
      ],
    }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteOrigin,
  };
}
