import type { Metadata } from "next";
import Link from "next/link";
import { TentTree } from "lucide-react";
import { AccountMenu } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { formatRoleLabel } from "@/lib/role-label";
import { getAuthContext } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff workspace", robots: { index: false, follow: false, nocache: true } };

/**
 * Chrome only. Authorization lives in the individual pages so an invited member
 * who has not activated yet can still reach `/staff/pending`.
 */
export default async function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getAuthContext();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--card)]">
        {/* `flex-wrap` because the header now carries a theme control as well as
            the account menu, which no longer fit on one line on a phone. */}
        <div className="container-shell flex flex-wrap items-center justify-between gap-3 py-4">
          <Link href="/staff" className="flex items-center gap-2 font-semibold">
            <span className="rounded-2xl bg-[var(--brand-soft)] p-2 text-[var(--brand-dark)]"><TentTree className="h-5 w-5" /></span>
            Staff workspace
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {context.user ? (
              <AccountMenu
                compact
                name={[context.user.firstName, context.user.lastName].filter(Boolean).join(" ")}
                roleLabel={formatRoleLabel(context.user.role)}
              />
            ) : (
              <Link href="/auth-choice" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium transition hover:bg-[var(--surface-muted)]">
                Sign in
              </Link>
            )}
            {/* Scoped to the staff area; independent of the customer and admin
                preferences. */}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="container-shell py-8 md:py-12">{children}</main>
    </div>
  );
}
