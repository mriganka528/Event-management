import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext, HOME_BY_ROLE } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Step 3 of the reset: choose the new password.
 *
 * The gate is the account's own `mustSetPassword` flag, which the verified reset
 * code set and which every guard in `lib/auth/server` already honours. A session
 * that has not been through the code step lands here with nothing to do, so it is
 * sent back to the start of the flow rather than shown an empty form.
 */
export default async function ResetPasswordPage() {
  const context = await getAuthContext();
  const user = context.user;

  // Fully usable account: there is nothing to reset, so do not show the form.
  if (user && !user.mustSetPassword) redirect(HOME_BY_ROLE[user.role]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Almost done</p>
          <ThemeToggle />
        </div>

        <div className="text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your code was accepted and every device has been signed out. Set the password you will use from now on.
          </p>
        </div>

        {user ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">New password</CardTitle>
              <CardDescription>This is the last step. Nobody else can see it.</CardDescription>
            </CardHeader>
            <CardContent>
              <ResetPasswordForm email={user.email} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Start again</CardTitle>
              <CardDescription>
                This page is only reachable straight after a reset code is verified, and that session is no longer
                present. Request a new code to carry on.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Link href="/forgot-password">
                <Button className="w-full">Request a new code</Button>
              </Link>
              <Link href="/sign-in">
                <Button variant="outline" className="w-full">Back to sign in</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}