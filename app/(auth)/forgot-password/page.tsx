import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Public recovery screen for staff and administrators.
 *
 * No account is required to reach it, so it must not leak whether an address is
 * registered: the form answers the same way in both cases.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Account recovery</p>
          <ThemeToggle />
        </div>

        <div className="text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Forgotten password</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Enter the address you sign in with. A 6-digit code is sent to it, and you choose the new password here.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Send a reset code</CardTitle>
            <CardDescription>For staff and administrators. Customers reset their password with their sign-in provider.</CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>

        <ul className="grid gap-2 rounded-[28px] border border-[var(--line)] bg-[var(--card-elevated)] p-5 text-sm text-[var(--muted-strong)]">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            The code expires in 10 minutes and can only be used once.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />
            Entering the code signs out every device, including any session an attacker might be holding.
          </li>
        </ul>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-in">
            <Button variant="outline" size="sm">Back to sign in</Button>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm">Back to home</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}