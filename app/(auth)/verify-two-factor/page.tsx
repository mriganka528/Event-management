import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { readPendingTwoFactor } from "@/lib/auth/server";
import { safeReturnTo } from "@/lib/access-policy";
import { maxDevices } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Verify your sign-in",
  robots: { index: false, follow: false, nocache: true },
};

const ALLOWED_REPORT = ["/admin", "/staff", "/customer/dashboard", "/customer/bookings/new"] as const;

export default async function VerifyTwoFactorPage({ searchParams }: { searchParams: Promise<{ channel?: string; returnTo?: string }> }) {
  const query = await searchParams;
  // A half-finished sign-in is the only way to reach this page; the cookie is
  // HttpOnly, set after a correct password, and expires in 15 minutes.
  const pending = await readPendingTwoFactor();
  if (!pending) redirect("/sign-in?expired=1");

  const channel = query.channel === "phone" || pending.channel === "PHONE" ? "phone" : "email";
  const returnTo = safeReturnTo(query.returnTo, ALLOWED_REPORT);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Two-factor</p>
          <ThemeToggle />
        </div>

        <div className="text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Check your {channel === "phone" ? "phone" : "email"}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Your password was correct. Confirm the code to finish signing in.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Enter your code</CardTitle>
            <CardDescription>Six digits, valid for ten minutes.</CardDescription>
          </CardHeader>
          <CardContent>
            <TwoFactorForm channel={channel} returnTo={returnTo ?? undefined} />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-[var(--muted)]">
          This account allows {maxDevices()} signed-in devices. If you are signing in somewhere new, a code is required every time.
        </p>

        <div className="flex justify-center">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">Start over</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
