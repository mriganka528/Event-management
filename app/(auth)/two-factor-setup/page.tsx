import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { TwoFactorSetupForm } from "@/components/auth/two-factor-setup-form";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { isPhoneOtpEnabled } from "@/lib/auth/sms";
import { getAuthContext, readPendingTwoFactor } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Set up two-factor authentication",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TwoFactorSetupPage() {
  // Pre-fill a phone the member already has, so the common case is one click.
  const pending = await readPendingTwoFactor();
  const context = await getAuthContext();
  const userId = context.user?.id ?? pending?.userId ?? null;

  const account = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, phone: true } })
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Two-factor</p>
          <ThemeToggle />
        </div>

        <div className="text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Protect your account</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {account?.firstName ? `${account.firstName}, ` : ""}administrator accounts must confirm a one-time code. No admin page is served until this is done.
          </p>
        </div>

        <TwoFactorSetupForm phoneAvailable={isPhoneOtpEnabled()} defaultPhone={account?.phone ?? null} />

        <p className="text-center text-xs text-[var(--muted)]">
          Codes are valid for ten minutes and can only be used once. If you lose access to both your email and phone, a super admin can reset your account.
        </p>

        <div className="flex justify-center">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">Back to sign in</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
