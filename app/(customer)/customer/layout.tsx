import Link from "next/link";
import { CalendarDays, PlusCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { AccountMenu } from "@/components/auth/account-menu";
import { formatRoleLabel } from "@/lib/role-label";
import { getAuthContext } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = await prisma.businessSetting.findUnique({ where: { id: "default" }, select: { businessName: true } }).catch(() => null);
  const businessName = settings?.businessName || "Event Management";
  const signedIn = await getAuthContext();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_88%,transparent)] backdrop-blur">
        <div className="container-shell flex flex-wrap items-center justify-between gap-4 py-4">
          <Link href="/" className="text-lg font-semibold text-[var(--foreground)]">{businessName}</Link>
          <nav className="flex w-full flex-wrap items-center gap-2 text-sm sm:w-auto sm:justify-end">
            <Link href="/customer/bookings/new" className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 font-medium text-stone-950 transition hover:bg-amber-400">
              <PlusCircle className="h-4 w-4" />New booking
            </Link>
            {signedIn.user ? (
              <AccountMenu
                compact
                name={[signedIn.user.firstName, signedIn.user.lastName].filter(Boolean).join(" ")}
                roleLabel={formatRoleLabel(signedIn.user.role)}
              />
            ) : (
              <Link href="/sign-in" className="rounded-full border border-[var(--line)] px-4 py-2 font-medium transition hover:bg-[var(--surface-muted)]">Sign in</Link>
            )}
          </nav>
        </div>
      </header>
      <main className="container-shell py-8 md:py-12">{children}</main>
      <footer className="border-t border-[var(--line)] py-8 text-center text-sm text-[var(--muted)]">
        <CalendarDays className="mr-2 inline h-4 w-4" />
        {businessName} · Events planned beautifully
      </footer>
    </div>
  );
}
