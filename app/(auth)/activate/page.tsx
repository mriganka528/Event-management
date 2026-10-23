import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, UserCheck } from "lucide-react";
import { ActivateForm } from "@/components/auth/activate-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth/server";
import { inspectActivationToken } from "@/lib/auth/team";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Activate your account",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  // A signed-in account that owes a password belongs on the reset screen. Both
  // routes are reachable from `mustSetPassword`, and a member arriving from a
  // verified reset code has no activation link to redeem, so sending them here
  // would only show "this link cannot be used".
  const context = await getAuthContext();
  if (token === "" && context.user?.mustSetPassword) redirect("/reset-password");

  const result = token ? await inspectActivationToken(token) : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Activate</p>
          <ThemeToggle />
        </div>

        {!result ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <AlertTriangle className="h-5 w-5 text-[var(--warning-text)]" />
                This link cannot be used
              </CardTitle>
              <CardDescription>No activation token was supplied. Open the link from your invitation email, or request a new one.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Link href="/join-the-team">
                <Button className="w-full">Request a new invitation</Button>
              </Link>
              <Link href="/sign-in">
                <Button variant="outline" className="w-full">Back to sign in</Button>
              </Link>
            </CardContent>
          </Card>
        ) : !result.ok ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <AlertTriangle className="h-5 w-5 text-[var(--warning-text)]" />
                This link cannot be used
              </CardTitle>
              <CardDescription>
                {result.code === "USED"
                  ? "This activation link has already been used. If you set your password, sign in to receive a fresh code. If you did not finish, ask an administrator to send a new invitation."
                  : result.message}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {result.code === "USED" ? (
                <>
                  <Link href="/sign-in">
                    <Button className="w-full">Back to sign in</Button>
                  </Link>
                  <Link href="/join-the-team">
                    <Button variant="outline" className="w-full">Request a new invitation</Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/join-the-team">
                    <Button className="w-full">Request a new invitation</Button>
                  </Link>
                  <Link href="/sign-in">
                    <Button variant="outline" className="w-full">Back to sign in</Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="text-center">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                <UserCheck className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight">Welcome, {result.firstName}</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Choose a password to activate your {result.role.replaceAll("_", " ").toLowerCase()} account.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Set your password</CardTitle>
                <CardDescription>This link can only be used once.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivateForm token={token} email={result.email} />
              </CardContent>
            </Card>

            {result.requiresTwoFactor ? (
              <p className="rounded-[28px] border border-[color:color-mix(in_srgb,var(--warning-text)_28%,transparent)] bg-[var(--warning-soft)] p-5 text-sm text-[var(--warning-text)]">
                As an administrator you will set up a one-time code on the next screen. That is mandatory and cannot be skipped.
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
