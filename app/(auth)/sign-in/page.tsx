import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext, isSignedIn, HOME_BY_ROLE } from "@/lib/auth/server";
import { safeReturnTo } from "@/lib/access-policy";
import { maxDevices } from "@/lib/auth/session";
import { isPhoneOtpEnabled } from "@/lib/auth/sms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false, nocache: true },
};

const ALLOWED_REPORT = ["/admin", "/staff", "/customer/dashboard", "/customer/bookings/new"] as const;

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; registered?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo, ALLOWED_REPORT);

  // Someone who is already signed in has no business on this page.
  if (await isSignedIn()) {
    const context = await getAuthContext();
    redirect(returnTo ?? HOME_BY_ROLE[context.user?.role ?? "CUSTOMER"]);
  }

  const limit = maxDevices();
  const phoneAvailable = isPhoneOtpEnabled();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Sign in</p>
          <ThemeToggle />
        </div>

        <div className="text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Staff sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {query.registered ? "Your account is ready. Sign in to continue." : "Sign in with the email and password for your account."}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your credentials</CardTitle>
            <CardDescription>Administrators are asked for a one-time code after their password.</CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm returnTo={returnTo ?? undefined} />
          </CardContent>
        </Card>

        <ul className="grid gap-2 rounded-[28px] border border-[var(--line)] bg-[var(--card-elevated)] p-5 text-sm text-[var(--muted-strong)]">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            Administrator and super admin accounts must use a one-time code sent to their email or phone.
          </li>
          <li className="flex items-start gap-2">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            An account can be signed in on {limit} devices at a time. A further device is refused until one is signed out.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            Every sign-in, code attempt, and access decision is written to the security log.
          </li>
        </ul>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/customer/auth/sign-in">
            <Button variant="outline" size="sm">Customer sign in</Button>
          </Link>
          <Link href="/join-the-team">
            <Button variant="ghost" size="sm">Join the team</Button>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm">Back to home</Button>
          </Link>
        </div>

        <p className="text-center text-xs text-[var(--muted)]">
          Customers sign in with Google or their email address. This page is for staff and administrators, who
          always use a password and a one-time code.
        </p>

        {!phoneAvailable ? (
          <p className="text-center text-xs text-[var(--muted)]">
            Phone codes are not enabled on this deployment, so second factors are delivered by email.
          </p>
        ) : null}
      </div>
    </main>
  );
}
