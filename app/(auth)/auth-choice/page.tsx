import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefcaseBusiness, UserRound } from "lucide-react";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HOME_BY_ROLE, getAuthContext, isSignedIn } from "@/lib/auth/server";
import { safeReturnTo } from "@/lib/access-policy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Choose how to sign in",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where people land when they ask to "sign in" without saying which kind of
 * account they have.
 *
 * The two flows share nothing: customers authenticate with the identity
 * provider (Google or email), while staff and team members authenticate
 * first-party with a password and a one-time code. Sending everyone to a single
 * form either blocks customers who have no password or strands staff on a
 * provider that refuses to federate their address (see `lib/auth/clerk.ts`), so
 * the choice is asked here instead of being guessed.
 */

const RETURN_TARGETS = ["/admin", "/staff", "/customer/dashboard", "/customer/bookings/new"] as const;

// Note: the `/admin` entry above is a route, not copy. It is the post-sign-in
// landing page for an administrator and never appears in the rendered text.

export default async function AuthChoicePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo, RETURN_TARGETS);

  // Someone who is already signed in has no business choosing.
  if (await isSignedIn()) {
    const context = await getAuthContext();
    redirect(returnTo ?? HOME_BY_ROLE[context.user?.role ?? "CUSTOMER"]);
  }

  const customerHref = returnTo
    ? `/customer/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    : "/customer/auth/sign-in";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl space-y-8">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Account access</p>
          <ThemeToggle />
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">How are you signing in?</h1>
          <p className="mx-auto mt-2 max-w-xl text-[var(--muted)]">
            Customers and staff use two separate sign-in methods. Pick the one that matches your account.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-[var(--line)] bg-[var(--card)]">
            <CardContent className="space-y-4 p-6">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                <UserRound className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-2xl font-semibold text-[var(--foreground)]">I&apos;m a customer</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Signing in to track a booking, view invoices, or manage your event details.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Link href={customerHref} className="w-full">
                  <Button className="w-full">Customer sign in</Button>
                </Link>
                <Link href={returnTo ? `/customer/auth/sign-up?returnTo=${encodeURIComponent(returnTo)}` : "/customer/auth/sign-up"} className="w-full">
                  <Button variant="outline" className="w-full">Create a customer account</Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[var(--line)] bg-[var(--card)]">
            <CardContent className="space-y-4 p-6">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                <BriefcaseBusiness className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-2xl font-semibold text-[var(--foreground)]">I&apos;m part of the team</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Signing in with the email address and password issued to you by your manager.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Link href={returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in"} className="w-full">
                  <Button variant="secondary" className="w-full">Staff sign in</Button>
                </Link>
                <Link href="/join-the-team" className="w-full">
                  <Button variant="outline" className="w-full">Request team access</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/customer/bookings/new">
            <Button variant="ghost" size="sm">Book an event without an account</Button>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm">Back to home</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}