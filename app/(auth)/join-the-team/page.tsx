import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Users } from "lucide-react";
import { JoinTeamForm } from "@/components/auth/join-team-form";
import { requestStartedAt } from "@/lib/request-clock";
import { ThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join the team",
  description: "Request staff or administrator access. A super admin reviews every request before anyone is added.",
  robots: { index: true, follow: true },
};

export default function JoinTheTeamPage() {
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-7">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
            <ArrowLeft className="h-4 w-4" />Back to home
          </Link>
          <ThemeToggle />
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Join the team</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Request staff or admin access.</h1>
          <p className="mt-3 text-[var(--muted-strong)]">
            You do not need an account to apply. Send your details below and a super admin will be notified. You will only get access if they approve the
            request, and you will receive an activation link by email when they do.
          </p>
        </div>

        <ul className="grid gap-2 rounded-[28px] border border-[var(--line)] bg-[var(--card-elevated)] p-5 text-sm text-[var(--muted-strong)] sm:grid-cols-3">
          <li className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-dark)]" />One decision, made by a super admin.</li>
          <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />Nothing is granted automatically.</li>
          <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" />Every request is recorded in the audit log.</li>
        </ul>

        {/* Stamped here, in the server render, and handed down. The form is a
            client component, so reading the clock inside it would produce a
            different number on hydration than the one in this markup. */}
        <JoinTeamForm renderedAt={requestStartedAt()} />

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sign-in">
            <Button variant="outline" size="sm">Already have an account? Sign in</Button>
          </Link>
          <Link href="/customer/auth/sign-up">
            <Button variant="ghost" size="sm">Create a customer account</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
