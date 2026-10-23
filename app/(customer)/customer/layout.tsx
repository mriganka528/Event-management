import Link from "next/link";
import { CalendarDays, PlusCircle } from "lucide-react";
import { getBusinessSettings } from "@/lib/settings";
import { AccountMenu, type AccountMenuLink } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { BusinessLogo } from "@/components/layout/business-logo";
import { WorkspaceHeader } from "@/components/layout/workspace-header";
import { formatRoleLabel } from "@/lib/role-label";
import { getAuthContext } from "@/lib/auth/server";
import { CustomerNotificationListener } from "@/components/customer/notification-listener";
import { prisma } from "@/lib/prisma";
import { toNotificationView } from "@/lib/notification-links";

export const dynamic = "force-dynamic";

/** Shortcuts in the account menu. `icon` is a name, not a component, so this
 *  stays serializable when the server layout renders the client menu. */
const CUSTOMER_ACCOUNT_LINKS: readonly AccountMenuLink[] = [
  { href: "/customer/dashboard", label: "My dashboard", description: "Bookings, payments, and next steps", icon: "dashboard" },
  { href: "/packages", label: "Browse packages", description: "Find a ready-made celebration", icon: "package" },
  { href: "/contact", label: "Talk to the team", description: "Ask about dates or a custom plan", icon: "help" },
];

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
      {/*
        The same floating, glass-panel bar as the public site: the header is
        the container-shell itself, so it keeps the page gutter and stays 12px
        off the top edge when it sticks. The bar inside it is the pill, which
        means the mobile menu panel opens from the pill rather than from a
        full-width strip.
      */}
      <header className="container-shell sticky top-3 z-40 pt-3 sm:top-4 sm:pt-4">
        <div className="glass-panel relative rounded-3xl border border-[var(--line)] px-3 py-2.5 shadow-sm sm:rounded-full sm:px-5 sm:py-3">
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
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-amber-500 px-3 text-sm font-medium text-stone-950 shadow-sm shadow-amber-500/25 transition hover:bg-amber-400 sm:px-4"
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
              signedIn.user ? (
                <AccountMenu
                  name={[signedIn.user.firstName, signedIn.user.lastName].filter(Boolean).join(" ")}
                  roleLabel={formatRoleLabel(signedIn.user.role)}
                  links={CUSTOMER_ACCOUNT_LINKS}
                />
              ) : (
                // Not `/sign-in`: that is the first-party staff password form,
                // which a customer has no credentials for. The chooser asks first.
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
      {signedIn.user ? <CustomerNotificationListener initialItems={notificationItems} /> : null}
      <footer className="border-t border-[var(--line)] py-8 text-center text-sm text-[var(--muted)]">
        <CalendarDays className="mr-2 inline h-4 w-4" />
        {businessName} · Events planned beautifully
      </footer>
    </div>
  );
}
