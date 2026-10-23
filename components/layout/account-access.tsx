"use client";

import Link from "next/link";
import { LayoutDashboard, LogIn } from "lucide-react";
import { SignOutForm } from "@/components/auth/sign-out-form";
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
    // The customer workspace used to be an almost invisible white chip with a
    // single initial in it; people who had just signed in could not find their
    // dashboard. The destination is now a solid brand button with a dashboard
    // glyph, labelled in words ("My dashboard" / "Admin panel") on every width
    // where there is room, and still icon-led on phones.
    const isCustomer = roleLabel.toLowerCase().includes("customer");
    const destination = isCustomer ? "My dashboard" : roleLabel.toLowerCase().includes("staff") ? "Staff workspace" : "Admin panel";
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={workspaceHref}
          className="group flex min-w-0 items-center gap-2.5 rounded-full border border-[var(--brand)] bg-[var(--brand-soft)] py-1.5 pl-1.5 pr-3 transition hover:bg-[var(--brand)] hover:text-stone-950"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-stone-950" aria-hidden>
            <LayoutDashboard className="h-4 w-4" />
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-xs font-bold">{destination}</span>
            <span className="block max-w-[10rem] truncate text-[11px] text-[var(--muted)] group-hover:text-stone-800">{signedInName}</span>
          </span>
          <span className="sr-only">Signed in as {roleLabel}: {signedInName}. Open {destination}.</span>
        </Link>
        <SignOutForm
          variant="ghost"
          size="sm"
          className="px-2.5"
          iconOnlyOnMobile
        />
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