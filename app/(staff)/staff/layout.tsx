import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { AccountMenu } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { BusinessLogo } from "@/components/layout/business-logo";
import { WorkspaceHeader } from "@/components/layout/workspace-header";
import { formatRoleLabel } from "@/lib/role-label";
import { getAuthContext } from "@/lib/auth/server";
import { getBusinessSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Staff workspace", template: "%s | Staff workspace" }, robots: { index: false, follow: false, nocache: true } };

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
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--card)]">
        <div className="container-shell relative py-3">
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
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-2">
                {context.user ? (
                  <AccountMenu
                    compact
                    name={[context.user.firstName, context.user.lastName].filter(Boolean).join(" ")}
                    roleLabel={formatRoleLabel(context.user.role)}
                  />
                ) : (
                  <Link
                    href="/auth-choice"
                    className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--line)] px-4 text-sm font-medium transition hover:bg-[var(--surface-muted)]"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            }
          />
        </div>
      </header>
      <main className="container-shell py-8 md:py-12">{children}</main>
    </div>
  );
}
