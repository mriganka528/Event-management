"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import { signOutAction } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";

export type AccountState = {
  name: string | null;
  roleLabel: string | null;
  workspaceHref: string | null;
};

/**
 * Sign-in state for the public header.
 *
 * Customers and staff authenticate through two unrelated providers, so the
 * signed-out control never points straight at a form: it leads to
 * `/auth-choice`, which asks which kind of account the visitor holds and offers
 * signing in *and* creating an account. Linking "Sign in" directly at the staff
 * password form is what sent customers to a screen they had no credentials for.
 *
 * When someone is signed in the header states the account type outright — a
 * customer who lands on the marketing site can tell at a glance that the chip
 * says "Customer", not guess from a dashboard icon.
 */
export function AccountAccess({ name: signedInName, roleLabel, workspaceHref }: AccountState) {
  if (signedInName && roleLabel && workspaceHref) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={workspaceHref}
          className="flex min-w-0 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1.5 pl-1.5 pr-3 transition hover:bg-[var(--surface-muted)]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand-dark)]" aria-hidden>
            {(signedInName.trim()[0] ?? "?").toUpperCase()}
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            {/* Explicitly labelled as customer / staff rather than just the
                role, because that distinction is what the visitor is here to
                confirm. */}
            <span className="block truncate text-xs font-semibold capitalize text-[var(--foreground)]">{roleLabel}</span>
            <span className="block max-w-[10rem] truncate text-[11px] text-[var(--muted)]">{signedInName}</span>
          </span>
          <span className="sr-only">Signed in as {roleLabel}: {signedInName}. Open your workspace.</span>
        </Link>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm" className="px-3" title="Sign out">
            <LogIn className="h-4 w-4 rotate-180" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </Button>
        </form>
      </div>
    );
  }

  // One button, not two. Registration lives on the same screen as sign-in —
  // `/auth-choice` offers customer sign-in, customer registration, staff
  // sign-in, and a team-access request — so a separate "Sign up" here duplicated
  // a path that is already one click away and crowded out the theme toggle on
  // narrow screens.
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Link href="/auth-choice">
        <Button variant="outline" size="sm" className="px-3 sm:px-4">
          <LogIn className="h-4 w-4" />
          <span>Sign in</span>
        </Button>
      </Link>
    </div>
  );
}