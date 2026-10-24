"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  CreditCard,
  FileText,
  KeyRound,
  LayoutDashboard,
  Menu,
  Package2,
  Receipt,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SquareChartGantt,
  Users,
  UserSquare2,
  Wrench,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { AccountMenu } from "@/components/auth/account-menu";
import { filterNavigation, isActiveRoute as matchActiveRoute } from "@/lib/admin-navigation";
import { cn } from "@/lib/utils";

/**
 * The sidebar links.
 *
 * `keywords` are words the link answers to but does not show. They exist for the
 * search above the list: the label is what the operator reads, the keywords are
 * what they type. "Stock" is how somebody reaches Inventory, and "money" is how
 * they reach Payments.
 */
const navigation = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "overview", "homepage"] },
  { href: "/staff", label: "Staff view", icon: UserSquare2, keywords: ["field", "team", "workspace"] },
  { href: "/admin/bookings", label: "Bookings", icon: SquareChartGantt, keywords: ["orders", "quotes", "requests"] },
  { href: "/admin/events", label: "Events", icon: CalendarDays, keywords: ["functions", "weddings"] },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, keywords: ["schedule", "dates", "diary"] },
  { href: "/admin/inventory", label: "Inventory", icon: Package2, keywords: ["stock", "equipment", "items", "capacity"] },
  { href: "/admin/packages", label: "Packages", icon: ShoppingBag, keywords: ["bundles", "combos", "offers"] },
  { href: "/admin/services", label: "Services", icon: Wrench, keywords: ["catalog", "pricing", "items sold"] },
  { href: "/admin/staff", label: "Staff", icon: UserSquare2, keywords: ["team", "employees", "roles"] },
  { href: "/admin/customers", label: "Customers", icon: Users, keywords: ["clients", "contacts", "people"] },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, keywords: ["money", "razorpay", "upi", "refunds"] },
  { href: "/admin/invoices", label: "Invoices", icon: Receipt, keywords: ["receipts", "billing", "tax"] },
  { href: "/admin/reports", label: "Reports", icon: FileText, keywords: ["analytics", "export", "data"] },
  { href: "/admin/notifications", label: "Notifications", icon: Bell, keywords: ["alerts", "inbox", "reminders"] },
  { href: "/admin/admins", label: "Admins", icon: Shield, keywords: ["administrators", "permissions", "roles"] },
  { href: "/admin/security", label: "Security", icon: ShieldCheck, keywords: ["password", "sessions", "devices", "audit"] },
  { href: "/admin/settings/credentials", label: "My credentials", icon: KeyRound, keywords: ["password", "login", "account", "otp"] },
  { href: "/admin/settings", label: "Settings", icon: Settings, keywords: ["preferences", "configuration", "tax", "business"] },
] as const;


/**
 * Trailing slashes and a trailing index segment must never change which entry is
 * highlighted, so both sides are normalised before they are compared. See
 * `lib/admin-navigation.ts`, which owns the rule and its tests.
 */
function isActiveRoute(pathname: string, href: string) {
  return matchActiveRoute(pathname, href, navigation);
}

function SidebarContent({
  pathname,
  businessName,
  logoUrl,
  account,
  onNavigate,
}: {
  pathname: string;
  businessName: string;
  logoUrl?: string | null;
  account: { name: string; roleLabel: string };
  onNavigate?: () => void;
}) {
  /*
   * Per instance, and that is deliberate: the drawer and the fixed sidebar are
   * both mounted at once, so a shared query would leave text in a field the
   * operator cannot see, filtering a list they are not looking at.
   */
  const [query, setQuery] = useState("");
  const visible = filterNavigation(query, navigation);
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full flex-col rounded-[30px] border border-[var(--sidebar-line)] bg-[image:var(--sidebar-bg)] p-5 text-[var(--sidebar-fg)] shadow-[var(--sidebar-shadow)] transition-[background-image,color,border-color,box-shadow] duration-300 ease-out motion-reduce:transition-none">
      <div className="border-b border-[var(--sidebar-line)] pb-5">
        <Link href="/admin" onClick={onNavigate} className="flex items-center gap-3">
          {/* The business logo, where there is one. The name stays either
              way, so a business without artwork still reads clearly. */}
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={businessName}
              width={40}
              height={40}
              sizes="40px"
              className="h-10 w-10 shrink-0 rounded-xl bg-white/90 object-contain p-1"
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.3em] text-[var(--sidebar-accent)]">
              {businessName}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Admin Panel</h2>
          </div>
        </Link>
        <p className="mt-2 text-sm text-[var(--sidebar-muted)]">
          Manage bookings, operations, and your full event workflow.
        </p>
      </div>

      {/*
        No `id` on the field, and the name is on the input itself rather than a
        `<label for>`: both copies of this sidebar are mounted at once, so any id
        here would appear twice on the page and the label would point at the
        invisible one.
      */}
      <form role="search" className="mt-4" onSubmit={(event) => event.preventDefault()}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sidebar-muted)]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Search pages…"
            aria-label="Search sidebar pages"
            autoComplete="off"
            className="h-11 w-full rounded-2xl border border-[var(--sidebar-line)] bg-[var(--sidebar-hover)] pl-10 pr-10 text-sm text-[var(--sidebar-fg)] outline-none transition placeholder:text-[var(--sidebar-muted)] focus:border-[var(--sidebar-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--sidebar-accent)_25%,transparent)] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the page search"
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--sidebar-muted)] transition hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </form>

      <nav className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <p role="status" className="rounded-2xl border border-[var(--sidebar-line)] px-4 py-3 text-sm text-[var(--sidebar-muted)]">
            No page matches “{query.trim()}”.
          </p>
        ) : (
          <>
            {/* Announced rather than only seen: the list changing under a
                keyboard is silent otherwise. */}
            <p aria-live="polite" className="sr-only">
              {searching ? `${visible.length} of ${navigation.length} pages match` : ""}
            </p>
            {visible.map(({ href, label, icon: Icon }) => {
              const active = isActiveRoute(pathname, href);

              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
                    active
                      ? "bg-[image:var(--sidebar-active-bg)] text-[var(--sidebar-active-fg)] shadow-[0_14px_30px_rgba(211,138,22,0.22)]"
                      : "text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-[background-color] duration-200 motion-reduce:transition-none",
                      active ? "bg-black/10" : "bg-[var(--sidebar-hover)] group-hover:bg-[var(--sidebar-hover)]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="mt-5 space-y-4 border-t border-[var(--sidebar-line)] pt-5">
        <div className="rounded-[24px] bg-[var(--sidebar-hover)] p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--sidebar-muted)]">Status</p>
          <p className="mt-2 text-lg font-semibold">Operations workspace</p>
          <p className="mt-1 text-sm text-[var(--sidebar-muted)]">Monitor bookings, stock, and event days here.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ThemeToggle />
          <AccountMenu compact name={account.name} roleLabel={account.roleLabel} />
        </div>
      </div>
    </div>
  );
}

export function AdminSidebar({ businessName, logoUrl, account }: { businessName: string; logoUrl?: string | null; account: { name: string; roleLabel: string } }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  /*
   * Tapping anywhere outside the drawer dismisses it, not only the backdrop and
   * the close button. The toggle itself is excluded: pressing the hamburger
   * while open must toggle the drawer rather than close it on pointerdown and
   * reopen it on click.
   */
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (toggleRef.current?.contains(event.target) || drawerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  return (
    <>
      <header className="sticky top-3 z-30 mx-2 flex items-center justify-between rounded-[26px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_88%,transparent)] px-4 py-3 shadow-[0_18px_45px_rgba(53,41,26,0.14)] backdrop-blur-lg lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={businessName}
              width={36}
              height={36}
              sizes="36px"
              className="h-9 w-9 shrink-0 rounded-xl bg-white object-contain p-1"
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.28em] text-[var(--brand-dark)]">
              {businessName}
            </p>
            <p className="mt-1 text-base font-semibold text-[var(--foreground)]">Admin Panel</p>
          </div>
        </div>
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--card)] text-[var(--foreground)]"
          aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isOpen}
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      <div
        ref={drawerRef}
        className={cn(
          "fixed inset-0 z-40 bg-black/45 transition-opacity duration-300 lg:hidden",
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          className="absolute inset-0"
          onClick={() => setIsOpen(false)}
          aria-label="Close navigation overlay"
        />
        <div
          className={cn(
            "relative h-full w-[min(88vw,360px)] p-3 transition-transform duration-300 ease-out",
            isOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <SidebarContent pathname={pathname} businessName={businessName} logoUrl={logoUrl} account={account} onNavigate={() => setIsOpen(false)} />
        </div>
      </div>

      <aside className="hidden lg:block lg:w-[300px] lg:self-stretch xl:w-[320px]">
        <div className="sticky top-0 h-screen py-4">
          <SidebarContent pathname={pathname} businessName={businessName} logoUrl={logoUrl} account={account} />
        </div>
      </aside>
    </>
  );
}
