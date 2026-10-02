"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/staff", label: "Staff view", icon: UserSquare2 },
  { href: "/admin/bookings", label: "Bookings", icon: SquareChartGantt },
  { href: "/admin/events", label: "Events", icon: CalendarDays },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/inventory", label: "Inventory", icon: Package2 },
  { href: "/admin/packages", label: "Packages", icon: ShoppingBag },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/staff", label: "Staff", icon: UserSquare2 },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/invoices", label: "Invoices", icon: Receipt },
  { href: "/admin/reports", label: "Reports", icon: FileText },
  { href: "/admin/notifications", label: "Notifications", icon: Bell },
  { href: "/admin/admins", label: "Admins", icon: Shield },
  { href: "/admin/security", label: "Security", icon: ShieldCheck },
  { href: "/admin/settings/credentials", label: "My credentials", icon: KeyRound },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

function isActiveRoute(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin" || pathname === href;
  }

  if (pathname !== href && !pathname.startsWith(`${href}/`)) return false;

  // `/admin/settings/credentials` sits under `/admin/settings`, so a plain
  // prefix match would light up both entries. The most specific entry wins.
  return !navigation.some((entry) => entry.href !== href && pathname.startsWith(`${entry.href}/`));
}

function SidebarContent({
  pathname,
  businessName,
  account,
  onNavigate,
}: {
  pathname: string;
  businessName: string;
  account: { name: string; roleLabel: string };
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-[30px] border border-[var(--sidebar-line)] bg-[image:var(--sidebar-bg)] p-5 text-[var(--sidebar-fg)] shadow-[var(--sidebar-shadow)] transition-[background-image,color,border-color,box-shadow] duration-300 ease-out motion-reduce:transition-none">
      <div className="border-b border-[var(--sidebar-line)] pb-5">
        <Link href="/admin" onClick={onNavigate} className="block">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.3em] text-[var(--sidebar-accent)]">
            {businessName}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Admin Panel</h2>
          <p className="mt-2 text-sm text-[var(--sidebar-muted)]">
            Manage bookings, operations, and your full event workflow.
          </p>
        </Link>
      </div>

      <nav className="mt-5 flex-1 space-y-2 overflow-y-auto pr-1">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = isActiveRoute(pathname, href);

          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
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

export function AdminSidebar({ businessName, account }: { businessName: string; account: { name: string; roleLabel: string } }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <header className="sticky top-3 z-30 mx-2 flex items-center justify-between rounded-[26px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_88%,transparent)] px-4 py-3 shadow-[0_18px_45px_rgba(53,41,26,0.14)] backdrop-blur-lg lg:hidden">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.28em] text-[var(--brand-dark)]">
            {businessName}
          </p>
          <p className="mt-1 text-base font-semibold text-[var(--foreground)]">Admin Panel</p>
        </div>
        <button
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
          <SidebarContent pathname={pathname} businessName={businessName} account={account} onNavigate={() => setIsOpen(false)} />
        </div>
      </div>

      <aside className="hidden lg:block lg:w-[300px] lg:self-stretch xl:w-[320px]">
        <div className="sticky top-0 h-screen py-4">
          <SidebarContent pathname={pathname} businessName={businessName} account={account} />
        </div>
      </aside>
    </>
  );
}
