import Link from "next/link";
import { CalendarDays, PlusCircle } from "lucide-react";
import { getBusinessSettings } from "@/lib/settings";
import { AccountMenu } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { BusinessLogo } from "@/components/layout/business-logo";
import { WorkspaceHeader } from "@/components/layout/workspace-header";
import { formatRoleLabel } from "@/lib/role-label";
import { getAuthContext } from "@/lib/auth/server";
import { CustomerNotificationListener } from "@/components/customer/notification-listener";
import { prisma } from "@/lib/prisma";
import { toNotificationView } from "@/lib/notification-links";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = await getBusinessSettings();
  const businessName = settings.businessName;
  const logoUrl = settings.logoUrl;
  const signedIn = await getAuthContext();
  /*
   * The customer's newest notifications, so the live listener knows which ones
   * it has already announced and does not greet them with a chime for
   * something that happened before the page loaded.
   */
  const notifications = signedIn.user
    ? await prisma.notification
        .findMany({
          where: { userId: signedIn.user.id, audience: "CUSTOMER" },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
        .catch(() => [])
    : [];
  const notificationItems = notifications.map((notification) => toNotificationView(notification, "CUSTOMER"));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_88%,transparent)] backdrop-blur">
        <div className="container-shell relative py-3">
          <WorkspaceHeader
            brand={
              <Link href="/" className="min-w-0" aria-label={`${businessName} home`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  {/*
                    The business logo, when there is one. The name is still
                    rendered either way, so an upload adds to the header rather
                    than replacing it, and a business without artwork is not
                    left with a gap.
                  */}
                  <BusinessLogo businessName={businessName} logoUrl={logoUrl} />
                  <span className="min-w-0 truncate text-base font-semibold text-[var(--foreground)] sm:text-lg">
                    {businessName}
                  </span>
                </span>
              </Link>
            }
            primary={
              // The one thing a customer came here to do, so it stays in the
              // bar at every width.
              <Link
                href="/customer/bookings/new"
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-amber-500 px-3 text-sm font-medium text-stone-950 transition hover:bg-amber-400 sm:px-4"
              >
                <PlusCircle className="h-4 w-4" />
                <span className="hidden sm:inline">New booking</span>
                <span className="sr-only sm:hidden">New booking</span>
              </Link>
            }
            utility={
              /*
                Scoped to the customer area, so choosing dark here leaves the
                admin panel and the public site on their own preferences. Without
                this control a customer could only change theme from the marketing
                site, which changed it everywhere.

                It stays in the bar at every width: it is one icon on a phone,
                and it is the control people reach for at night.
              */
              <ThemeToggle />
            }
            menu={
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-2">
                {signedIn.user ? (
                  <AccountMenu
                    compact
                    name={[signedIn.user.firstName, signedIn.user.lastName].filter(Boolean).join(" ")}
                    roleLabel={formatRoleLabel(signedIn.user.role)}
                  />
                ) : (
                  // Not `/sign-in`: that is the first-party staff password form,
                  // which a customer has no credentials for. The chooser asks first.
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
      {signedIn.user ? <CustomerNotificationListener initialItems={notificationItems} /> : null}
      <footer className="border-t border-[var(--line)] py-8 text-center text-sm text-[var(--muted)]">
        <CalendarDays className="mr-2 inline h-4 w-4" />
        {businessName} · Events planned beautifully
      </footer>
    </div>
  );
}
