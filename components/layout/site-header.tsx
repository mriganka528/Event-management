import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { PublicHeaderMenu } from "@/components/layout/public-header-menu";
import { PublicAccountProvider, PublicAccountStatus } from "@/components/layout/public-account-status";

export type PublicNavItem = { href: string; label: string };

/**
 * Default public navigation. Exported so a page can pass a different set if it
 * needs to, without every page re-declaring the same list.
 */
export const PUBLIC_NAV: readonly PublicNavItem[] = [
  { href: "/#categories", label: "Categories" },
  { href: "/packages", label: "Packages" },
  { href: "/services", label: "Services" },
  { href: "/#gallery", label: "Gallery" },
  { href: "/contact", label: "Contact" },
];

/**
 * Public site chrome.
 *
 * Intentionally free of any `cookies()`/`headers()` read so the marketing pages
 * it wraps stay statically generated with their short revalidate window — the
 * landing page is the primary SEO surface and giving up ISR for a header chip
 * would be a bad trade. Reading the session here instead makes every route that
 * renders this header dynamic.
 *
 * The signed-in state is therefore resolved in the browser by
 * {@link PublicAccountStatus}, and the signed-out controls point at
 * `/auth-choice` rather than at either sign-in form: customers have no password
 * for the staff form, and the provider refuses to federate a staff address, so
 * guessing which form to send someone to blocks one of the two groups.
 */
export function SiteHeader({
  businessName = "Event Management",
  nav,
}: {
  businessName?: string;
  nav?: readonly PublicNavItem[];
}) {
  const navItems = nav ?? PUBLIC_NAV;

  return (
    <PublicAccountProvider>
      <header className="container-shell sticky top-3 z-40 pt-3 sm:top-4 sm:pt-4">
        <div className="glass-panel flex items-center justify-between gap-3 rounded-3xl border border-[var(--line)] px-3 py-2.5 shadow-sm sm:rounded-full sm:px-5 sm:py-3">
          <Link href="/" className="min-w-0 shrink-0 text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">
            <span className="block max-w-[9rem] truncate sm:max-w-none">{businessName || "Event Management"}</span>
          </Link>

          <nav className="hidden items-center gap-5 text-sm text-[var(--muted)] lg:flex xl:gap-6">
            {navItems.map((item) => (
              <Link key={item.href} className="transition hover:text-[var(--foreground)]" href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/customer/bookings/new"
              className="inline-flex h-10 items-center gap-1 rounded-full bg-amber-500 px-3 text-xs font-semibold text-stone-950 transition hover:bg-amber-400 sm:px-4 sm:text-sm"
            >
              Book
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

            {/* Below `lg` the account control moves into the menu so the bar does
                not overflow on a phone. */}
            <div className="hidden lg:block">
              <PublicAccountStatus />
            </div>

            <ThemeToggle />
            <PublicHeaderMenu nav={navItems} />
          </div>
        </div>
      </header>
    </PublicAccountProvider>
  );
}