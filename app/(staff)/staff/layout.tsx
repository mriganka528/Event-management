import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { AccountMenu, type AccountMenuLink } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { BusinessLogo } from "@/components/layout/business-logo";
import { WorkspaceHeader } from "@/components/layout/workspace-header";
import { formatRoleLabel } from "@/lib/role-label";
import { getAuthContext } from "@/lib/auth/server";
import { getBusinessSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Staff workspace", template: "%s | Staff workspace" }, robots: { index: false, follow: false, nocache: true } };

/** Shortcuts in the account menu, kept as serializable data for the client menu. */
const STAFF_ACCOUNT_LINKS: readonly AccountMenuLink[] = [
  { href: "/staff", label: "My shifts", description: "Your event-day schedule", icon: "calendar" },
  { href: "/", label: "Public website", description: "Packages, services, and contact", icon: "home" },
];

/**
 * Chrome only. Authorization lives in the individual pages so an invited member
 * who has not activated yet can still reach `/staff/pending`.
 */
export default async function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getAuthContext();
  const settings = await getBusinessSettings();
  const businessName = settings.businessName || "Staff workspace";

  return (
    <div className="min-h-screen">
      {/* Matches the public site's floating header: the sticky element keeps
          the page gutter, and the glass pill inside it is the visible bar. */}
      <header className="container-shell sticky top-3 z-40 pt-3 sm:top-4 sm:pt-4">
        <div className="glass-panel relative rounded-3xl border border-[var(--line)] px-3 py-2.5 shadow-sm sm:rounded-full sm:px-5 sm:py-3">
          <WorkspaceHeader
            brand={
              <Link href="/staff" className="min-w-0" aria-label={`${businessName} staff workspace`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  {/* The business logo where there is one, so a staff member sees
                      the same mark as a customer does. */}
                  <BusinessLogo businessName={businessName} logoUrl={settings.logoUrl} />
                  <span className="min-w-0 truncate text-base font-semibold text-[var(--foreground)] sm:text-lg">
                    {businessName}
                  </span>
                </span>
              </Link>
            }
            primary={
              /*
                A jump to the shifts list, not a link to the page the reader
                is already on. It was a plain `href="/staff"`, and the staff
                dashboard *is* `/staff`, so pressing it did nothing at all.

                A plain anchor rather than a router link, so the browser
                handles the fragment itself: the same-document navigation
                scrolls to the section without re-running the page, and the
                fragment survives a redirect from `/staff/pending`.
              */
              <a
                href="/staff#my-shifts"
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] sm:px-4"
              >
                <CalendarDays className="h-4 w-4" />
                <span className="hidden sm:inline">My shifts</span>
                <span className="sr-only sm:hidden">My shifts</span>
              </a>
            }
            utility={
              // Scoped to the admin area, which the staff workspace shares; independent of
              // the customer and public preferences. It stays in the bar at every
              // width: it is one icon on a phone.
              <ThemeToggle />
            }
            menu={
              context.user ? (
                <AccountMenu
                  name={[context.user.firstName, context.user.lastName].filter(Boolean).join(" ")}
                  roleLabel={formatRoleLabel(context.user.role)}
                  links={STAFF_ACCOUNT_LINKS}
                />
              ) : (
                <Link
                  href="/auth-choice"
                  className="inline-flex h-10 w-full items-center justify-center rounded-full border border-[var(--line)] px-4 text-sm font-medium transition hover:bg-[var(--surface-muted)] sm:w-auto"
                >
                  Sign in
                </Link>
              )
            }
          />
        </div>
      </header>
      <main className="container-shell py-8 md:py-12">{children}</main>
    </div>
  );
}
